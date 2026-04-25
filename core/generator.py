# core/generator.py
from __future__ import annotations

import copy
import functools
import json
import re
import threading
import time
import anthropic
from core.euclidean import SEQ_MODE_EUCLIDEAN, SEQ_MODE_STANDARD, clamp_euclid_triplet
from core.state import AppState, DEFAULT_GATE_PCT, TRACK_NAMES
from core.events import EventBus
from core.logging_config import get_logger
from core.midi_utils import CC_MAP
from core.tracing import tracer
from core.injectable_profiles import build_injectable_context_prefix
from core.lfo import sanitize_lfo_in_pattern

logger = get_logger("generator")

_PRODUCER_NOTES_MAX_LEN = 1200

# Opus output budget: TTFT is not meaningfully improved by lowering max_tokens; a low ceiling
# truncates JSON (especially 32-step + prob + cc + producer_notes). Scale with pattern length.
def _opus_max_output_tokens(steps: int) -> int:
    """Minimum 2048; add headroom for longer grids and optional prob/cc/notes."""
    return max(2048, 400 + steps * 90)


def _serialize_pattern_for_llm(pattern: dict, steps: int) -> str:
    """JSON snapshot for variation prompts: 8 tracks + prob/gate/cond/step_cc/swing when present."""
    st = AppState()
    st.pattern_length = steps
    norm = st.normalize_pattern_length(copy.deepcopy(pattern))
    blob: dict = {t: norm[t] for t in TRACK_NAMES}
    for key in ("prob", "gate", "cond", "note", "step_cc"):
        v = norm.get(key)
        if isinstance(v, dict) and v:
            blob[key] = v
    sw = norm.get("swing", 0)
    if isinstance(sw, (int, float)) and sw != 0:
        blob["swing"] = int(sw)
    return json.dumps(blob, separators=(",", ":"), default=str)


def _parse_ask_response(raw: str) -> tuple[str, bool]:
    """Split assistant reply body from trailing IMPLEMENTABLE: YES|NO. Fail closed to NO."""
    raw_stripped = raw.rstrip()
    lines = raw_stripped.split("\n")
    implementable = False
    if lines:
        last = lines[-1].strip()
        m = re.match(r"(?i)^IMPLEMENTABLE:\s*(YES|NO)\s*$", last)
        if m:
            implementable = m.group(1).upper() == "YES"
            lines = lines[:-1]
    answer = "\n".join(lines).strip()
    return answer, implementable


def _coerce_pattern_dict(
    data: dict, steps: int
) -> tuple[dict, int | None, dict, str | None] | None:
    """Validate a pattern object (from JSON text or tool_use input). Returns pattern slice + extras."""
    if not isinstance(data, dict):
        return None
    if not all(k in data for k in TRACK_NAMES):
        return None
    if not all(len(data[k]) == steps for k in TRACK_NAMES):
        return None
    if not all(
        isinstance(v, int) and 0 <= v <= 127
        for k in TRACK_NAMES
        for v in data[k]
    ):
        return None
    producer_notes: str | None = None
    if "producer_notes" in data:
        pn = data["producer_notes"]
        if not isinstance(pn, str):
            return None
        producer_notes = _normalize_producer_notes(pn)
    if "prob" in data:
        prob = data["prob"]
        if not isinstance(prob, dict):
            return None
        for track, values in prob.items():
            if track not in TRACK_NAMES:
                return None
            if not isinstance(values, list) or len(values) != steps:
                return None
            if not all(isinstance(v, int) and 0 <= v <= 100 for v in values):
                return None
    if "swing" in data:
        swing = data["swing"]
        if not isinstance(swing, (int, float)) or not (0 <= swing <= 100):
            return None

    raw_bpm = data.get("bpm")
    bpm = int(raw_bpm) if isinstance(raw_bpm, (int, float)) and 20 <= raw_bpm <= 400 else None
    pattern = {k: data[k] for k in TRACK_NAMES}
    if "prob" in data:
        pattern["prob"] = data["prob"]
    if "swing" in data:
        pattern["swing"] = data["swing"]

    cc_changes: dict = {}
    raw_cc = data.get("cc", {})
    if isinstance(raw_cc, dict):
        valid_params = set(CC_MAP.keys()) | {"velocity"}
        for track, params in raw_cc.items():
            if track not in TRACK_NAMES or not isinstance(params, dict):
                continue
            for param, value in params.items():
                if param not in valid_params:
                    continue
                if not isinstance(value, int) or not (0 <= value <= 127):
                    continue
                cc_changes.setdefault(track, {})[param] = value

    sm = data.get("seq_mode")
    if sm == SEQ_MODE_EUCLIDEAN:
        pattern["seq_mode"] = SEQ_MODE_EUCLIDEAN
    elif sm == SEQ_MODE_STANDARD:
        pattern["seq_mode"] = SEQ_MODE_STANDARD

    raw_eu = data.get("euclid")
    if isinstance(raw_eu, dict) and raw_eu:
        merged_eu: dict[str, dict[str, int]] = {}
        for t in TRACK_NAMES:
            row = raw_eu.get(t)
            if not isinstance(row, dict):
                continue
            try:
                k_i = int(row["k"])
                n_i = int(row["n"])
                r_i = int(row["r"])
            except (KeyError, TypeError, ValueError):
                continue
            k_i, n_i, r_i = clamp_euclid_triplet(k_i, n_i, r_i)
            merged_eu[t] = {"k": k_i, "n": n_i, "r": r_i}
        if merged_eu:
            pattern["euclid"] = merged_eu

    raw_lfo = data.get("lfo")
    if isinstance(raw_lfo, dict) and raw_lfo:
        pattern["lfo"] = copy.deepcopy(raw_lfo)
        sanitize_lfo_in_pattern(pattern, steps)

    return pattern, bpm, cc_changes, producer_notes


def _emit_pattern_tool_schema(steps: int) -> dict:
    """JSON Schema for Anthropic tool: full pattern payload."""
    step_arr = {
        "type": "array",
        "minItems": steps,
        "maxItems": steps,
        "items": {"type": "integer", "minimum": 0, "maximum": 127},
    }
    track_props = {t: step_arr for t in TRACK_NAMES}
    euclid_row = {
        "type": "object",
        "properties": {
            "k": {"type": "integer", "minimum": 0, "maximum": 16},
            "n": {"type": "integer", "minimum": 1, "maximum": 16},
            "r": {"type": "integer", "minimum": 0, "maximum": 15},
        },
        "required": ["k", "n", "r"],
    }
    euclid_props = {t: euclid_row for t in TRACK_NAMES}
    lfo_def_schema = {
        "type": "object",
        "properties": {
            "shape": {
                "type": "string",
                "enum": ["sine", "square", "triangle", "ramp", "saw"],
            },
            "depth": {"type": "integer", "minimum": 0, "maximum": 100},
            "phase": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "rate": {
                "type": "object",
                "properties": {
                    "num": {"type": "integer", "minimum": 1, "maximum": 256},
                    "den": {"type": "integer", "minimum": 1, "maximum": 256},
                },
                "required": ["num", "den"],
            },
        },
        "required": ["shape", "depth", "rate"],
    }
    return {
        "name": "emit_pattern",
        "description": (
            "Submit the complete drum pattern as structured data. "
            "Include all eight tracks; use optional prob/swing/cc/lfo/producer_notes when relevant. "
            "When the user wants Euclidean (Bjorklund) ring gating, set seq_mode to euclidean and "
            "include euclid per track (k pulses, n ring length 1–16, r rotation 0…n−1)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "bpm": {"type": "integer", "minimum": 20, "maximum": 400},
                **track_props,
                "seq_mode": {"type": "string", "enum": [SEQ_MODE_STANDARD, SEQ_MODE_EUCLIDEAN]},
                "euclid": {"type": "object", "properties": euclid_props},
                "prob": {"type": "object", "additionalProperties": step_arr},
                "swing": {"type": "integer", "minimum": 0, "maximum": 100},
                "cc": {"type": "object", "additionalProperties": {"type": "object"}},
                "lfo": {
                    "type": "object",
                    "additionalProperties": lfo_def_schema,
                    "description": (
                        "Tempo-synced LFOs; keys are route targets "
                        "(cc:<track>:<param>, trig:<track>:prob|vel|gate|note, pitch:<track>:main)."
                    ),
                },
                "producer_notes": {"type": "string", "maxLength": _PRODUCER_NOTES_MAX_LEN},
            },
            "required": list(TRACK_NAMES),
        },
    }

_TRACK_ALIASES: dict[str, list[str]] = {
    "kick":    ["kick", "bass drum", "bassdrum", "bd"],
    "snare":   ["snare", "snare drum", "sd"],
    "hihat":   ["hihat", "hi-hat", "hi hat", "hat", "hats", "closed hat", "ch"],
    "openhat": ["open hat", "openhat", "open hi-hat", "open hihat"],
    "clap":    ["clap", "cl"],
    "tom":     ["tom", "toms", "lt"],
    "bell":    ["bell", "cowbell", "bl"],
    "cymbal":  ["cymbal", "cymbals", "crash", "cy"],
}


def _detect_target_tracks(prompt: str) -> set[str]:
    """Return canonical track names mentioned (directly or by alias) in prompt."""
    lowered = prompt.lower()
    matches: list[tuple[int, int, str]] = []
    found: set[str] = set()

    for track, aliases in _TRACK_ALIASES.items():
        for alias in aliases:
            for m in re.finditer(r"\b" + re.escape(alias) + r"\b", lowered):
                matches.append((m.start(), m.end(), track))

    # Prefer longer alias matches first and avoid overlapping spans.
    # This prevents "open hihat" from matching both openhat and hihat.
    occupied: list[tuple[int, int]] = []
    for start, end, track in sorted(matches, key=lambda m: (-(m[1] - m[0]), m[0])):
        if any(not (end <= span_start or start >= span_end) for span_start, span_end in occupied):
            continue
        occupied.append((start, end))
        found.add(track)

    return found


def _normalize_producer_notes(raw: str) -> str | None:
    """Strip control chars and cap length; return None if empty after normalize."""
    cleaned: list[str] = []
    for ch in raw.strip():
        o = ord(ch)
        if ch in "\n\r\t" or o >= 32:
            cleaned.append(ch)
        else:
            cleaned.append(" ")
    text = "".join(cleaned).strip()
    if len(text) > _PRODUCER_NOTES_MAX_LEN:
        text = text[:_PRODUCER_NOTES_MAX_LEN].rstrip()
    return text if text else None


def _compute_generation_summary(
    prompt: str, pattern: dict, latency_ms: int, producer_notes: str | None = None
) -> dict:
    """Return compact generation telemetry for the TUI."""
    abbreviations = {
        "kick": "BD",
        "snare": "SD",
        "tom": "LT",
        "clap": "CL",
        "bell": "BL",
        "hihat": "CH",
        "openhat": "OH",
        "cymbal": "CY",
    }
    parts: list[str] = []
    for track in TRACK_NAMES:
        steps = pattern.get(track, [])
        active = sum(1 for v in steps if isinstance(v, int) and v > 0)
        if active > 0:
            parts.append(f"{abbreviations.get(track, track[:2].upper())}x{active}")
    summary: dict = {
        "prompt": prompt,
        "track_summary": "  ".join(parts) if parts else "empty",
        "latency_ms": latency_ms,
    }
    if producer_notes:
        summary["producer_notes"] = producer_notes
    return summary


# Optional cache-friendly conditional style appendix (e.g. 808/909-only blurbs) is intentionally
# deferred: dynamic system fragments reduce Anthropic prompt-cache hit rate. See LLM prompting plan.
@functools.lru_cache(maxsize=3)
def _build_system_prompt(steps: int = 16) -> str:
    return (
        "You are an expert drum pattern generator specializing in techno and electronic music production. "
        "You understand groove, hypnotic repetition, tension, and the specific conventions of techno subgenres.\n\n"
        "SUBGENRE BPM RANGES — choose a BPM from the matching range based on the user's request:\n"
        "  detroit techno:           130–138\n"
        "  minimal techno:           130–136\n"
        "  dub techno:               120–130\n"
        "  acid techno:              138–145\n"
        "  hypnotic / trance techno: 140–148\n"
        "  industrial techno:        140–150\n"
        "  dark techno / hard techno: 142–155\n"
        "  schranz:                  150–162\n"
        "  breakbeat / breaks:       125–140\n"
        "  electro:                  125–135\n"
        "  house / deep house:       120–128\n"
        "  tech house:               124–130\n"
        "  jungle / drum & bass:     160–180\n"
        "  ambient / downtempo:      70–110\n"
        "  EBM / darkwave:           110–130\n"
        "  generic / unspecified:    133–140\n"
        "  If the user asks for minimal hypnotic techno specifically: prefer 130–138 BPM unless they want peak-time energy (then use hypnotic/trance techno range).\n\n"
        "GENRE-SPECIFIC PATTERN CONVENTIONS:\n"
        "  - Dub techno: sparse, delayed elements, heavy reverb feel, minimal kick patterns\n"
        "  - Breakbeat: broken kick patterns (NOT four-on-the-floor), syncopated snare\n"
        "  - DnB/jungle: double-time feel, rapid hi-hats, breakbeat-style kick/snare\n"
        "  - House: four-on-the-floor kick, off-beat hi-hat (steps 3,7,11,15), clap on 5,13\n"
        "  - EBM: driving 8th-note kick patterns, heavy snare, minimal hi-hat\n"
        "  - Electro: TR-808 style, booming kicks, crisp claps, cowbell-heavy\n"
        "  - Minimal / hypnotic techno: sparse kicks (four-on-the-floor or near it), long evolving loops, subtle velocity drift, hi-hat/metallic cells that imply polyrhythm on the 16-step grid (e.g. 3- or 5-step repeating accents, offset open hats, odd-step percussion), optional prob on ghosts/hats for organic variation; tom/bell/cymbal as rare markers not constant fills; straight or light swing depending on sub-style\n\n"
        "GROOVE RULES:\n"
        "  - Kick: four-on-the-floor (steps 1,5,9,13) is the techno foundation; vary velocity 90–127 for feel\n"
        "  - Snare/clap: anchor on beats 2 and 4 (steps 5 and 13); ghost notes on steps 3,7,11,15 add groove\n"
        "  - Hihat: vary velocity across steps (range 40–100) — never use uniform flat values\n"
        "  - Open hat: off-beat placements (step 9 is classic) or syncopated 3-against-4 patterns\n"
        "  - Tom/cymbal/bell: use sparingly for fills, accents, or hypnotic motifs — silence is valid\n"
        "  - Techno thrives on space and repetition; not every track needs hits every bar\n"
        "  - Use the full velocity range 0–127, not just 0 and 100\n\n"
        "EUCLIDEAN (BJORKLUND) RHYTHMS — this app can gate steps per track with evenly spaced pulses on a ring:\n"
        "  - Parameters: k = number of pulses, n = ring length (1–16 steps), r = rotation (0…n−1, shifts where pulses fall).\n"
        "  - Good fits: hypnotic / minimal / trance techno (hats, openhat, bell, tom, cymbal as cyclic tension against a steady kick); "
        "experimental or IDM accents; long-phase feel when peripheral voices use a different n than the main grid.\n"
        "  - Use sparingly or not at all: club four-on-the-floor where every kick downbeat must hit; dense DnB/jungle grids unless the user wants deliberate unevenness; "
        "ambient/drone — if Euclidean is requested, keep kick/snare anchored when needed and use rings mainly on hats/perc/shimmer.\n"
        "  - In Euclidean sequencing mode, velocity rows still set timbre and ghosts; the ring only gates whether a step may fire.\n"
        "  - When the user explicitly asks for Euclidean / Bjorklund / ring / (k,n,r) patterns: you MUST set emit_pattern's optional "
        "\"seq_mode\" to \"euclidean\" and include \"euclid\" with concrete {k,n,r} for each track that should use a ring (omit tracks that stay straight grid). "
        "Still recommend triplets in producer_notes for readability. The TUI can also switch with /mode euclidean, but the pattern should carry seq_mode/euclid when they asked.\n\n"
        f"Generate {steps}-step drum patterns as strict JSON. Each step is an integer 0–127 (velocity), 0 = silent.\n\n"
        "DIGITAKT SOUND DESIGN GUIDANCE:\n"
        "Each track maps to a Digitakt audio track with one-shot sample playback. The CC parameters\n"
        "shape the sound in real time:\n"
        "  - tune (CC 16): sample pitch. 64=default. Lower values = pitched down (deeper, darker).\n"
        "    For kicks: 50–60 = deep sub kick. For hihats: 70–80 = brighter/shorter.\n"
        "  - filter (CC 74): lowpass cutoff. 0=fully closed (muffled), 127=wide open (bright).\n"
        "    Kicks usually 80–127. Hihats/cymbals 60–127 for character. Snare 70–110.\n"
        "  - resonance (CC 75): filter resonance. 0=none, high values add ringing/acid character.\n"
        "    Keep low (0–30) for clean sounds. 50+ for acid or resonant stabs.\n"
        "  - attack (CC 78): amp envelope attack. 0=instant hit. Higher = slower fade-in.\n"
        "    Kicks/snares should be 0–10. Pads/swells 40–80.\n"
        "  - decay (CC 80): amp envelope decay. Controls how long the sound rings.\n"
        "    Short kicks: 30–50. Long tails: 80–110. Hihats: 20–50.\n"
        "  - reverb (CC 83): send amount. 0=dry, 127=full reverb. Use 10–40 for space, 60+ for wash.\n"
        "  - delay (CC 82): send amount. Creates rhythmic echoes. 10–30 subtle, 50+ pronounced.\n"
        "  - volume (CC 7): track level. Usually 90–110. Use to balance the mix.\n\n"
        "CLASSIC MACHINE CHARACTER (samples on Digitakt — emulate with CC + velocity, not analog modeling):\n"
        "  TR-808: kicks = long sub-heavy tail, soft attack, pitch-droopy weight; use attack 0–5, decay longer for weight (often 70–110), tune lower (50–62), filter moderate-high to keep body (85–115), resonance low (0–25). Snare/clap roomier/softer than 909; hats smoother/duller — filter lower, decay moderate. Ghost kicks via low velocity, not always shorter decay.\n"
        "  TR-909: kicks = short punchy transient, strong mid knock, tighter low end; attack 0–5, decay shorter for punch (35–55) or longer for rumble/tuned-kick tail (75–100). Rumble 909 kick: lower tune (52–60), longer decay, filter not fully bright (70–100) or click dominates, subtle delay/reverb (10–35) for tail glue, velocity ghosts for pump. 909 snare = bright noisy body; 808 snare = more tonal thud + noise. 909 hats = metallic, sharp open/closed contrast; 808 hats = rounder/smoother — tune/filter accordingly.\n\n"
        "OPTIONAL CC ADJUSTMENTS:\n"
        "When a request adjusts sound parameters or velocity, include an optional \"cc\" key with only the\n"
        "tracks and params that should change. Valid params: tune, filter, resonance, attack, decay, volume,\n"
        "reverb, delay, velocity. All values 0–127. velocity scales the track's overall strike intensity.\n\n"
        "OPTIONAL TEMPO-SYNCED LFO (lfo) — use emit_pattern's structured \"lfo\" object (not producer_notes alone):\n"
        "- Keys are route targets: cc:<track>:<param> (e.g. cc:clap:filter), trig:<track>:prob|vel|gate|note, pitch:<track>:main.\n"
        "- Each value: {\"shape\":\"sine\"|\"square\"|\"triangle\"|\"ramp\"|\"saw\", \"depth\":0–100, \"phase\":0–1, \"rate\":{\"num\":N,\"den\":D}}.\n"
        "- rate is a reduced fraction (coprime N,D ≥ 1) vs one pattern length: one full LFO cycle spans (D/N) patterns when N<D, "
        "or a fraction of one pattern when N≥D (e.g. N=1,D=2 → half a cycle per pattern).\n"
        "- Example (half-cycle sine on clap filter, 50% depth): "
        "\"lfo\":{\"cc:clap:filter\":{\"shape\":\"sine\",\"depth\":50,\"phase\":0,\"rate\":{\"num\":1,\"den\":2}}}\n\n"
        "Respond ONLY with valid JSON in this exact format — no explanation, no markdown:\n"
        "{\n"
        '  "bpm":     <integer from subgenre range>,\n'
        f'  "kick":    [{steps} integers 0-127],\n'
        f'  "snare":   [{steps} integers 0-127],\n'
        f'  "tom":     [{steps} integers 0-127],\n'
        f'  "clap":    [{steps} integers 0-127],\n'
        f'  "bell":    [{steps} integers 0-127],\n'
        f'  "hihat":   [{steps} integers 0-127],\n'
        f'  "openhat": [{steps} integers 0-127],\n'
        f'  "cymbal":  [{steps} integers 0-127],\n'
        '  "seq_mode": "standard" | "euclidean"  (optional; set euclidean when the user wants Bjorklund ring gating)\n'
        '  "euclid": {"<track>": {"k": <pulses>, "n": <1-16>, "r": <rotation>}, ...}  (optional; per-track ring; use with seq_mode euclidean)\n'
        '  "cc": {"<track>": {"<param>": <0-127>, ...}, ...}  (optional)\n'
        '  "lfo": {"cc:clap:filter": {"shape":"sine","depth":50,"phase":0,"rate":{"num":1,"den":2}}, ...}  (optional)\n'
        '  "producer_notes": "<plain text, no markdown; optional>"  (optional)\n'
        "}"
        "\n\nOPTIONAL: Per-step probability (prob):\n"
        f"- Add a \"prob\" key containing a dict of track → {steps}-element list of integers (0–100).\n"
        "- 100 = always trigger. 75 = fires 75% of the time. 0 = never fires.\n"
        "- Omit tracks that should always fire. Omit \"prob\" entirely for fully deterministic patterns.\n"
        "- Use prob to: add ghost note uncertainty (snare ghost notes at 50–75%), randomize hi-hat repetitions, make fills feel organic. Do NOT apply prob to kick on downbeats.\n"
        f"- Example: \"prob\": {{\"snare\": [100,100,50,100,100,100,75,100,100,100,50,100,100,100,75,100]}}\n"
        "\n"
        "OPTIONAL: Swing (swing):\n"
        "- Add a \"swing\" key with a single integer 0–100.\n"
        "- 0 = perfectly quantized (no swing). 25 = light shuffle. 50 = strong triplet shuffle.\n"
        "- Swing delays the even 16th-note positions (the \"and\" of each beat).\n"
        "- Use swing for: shuffle techno (20–35), house groove (30–45), funk/break feel (40–55).\n"
        "- Omit \"swing\" for straight, mechanical patterns (industrial, hard techno).\n\n"
        "OPTIONAL: Euclidean sequencing (seq_mode, euclid) — use emit_pattern fields, not text alone:\n"
        "- If the user wants Euclidean / Bjorklund / evenly spaced pulses on a ring: set \"seq_mode\" to \"euclidean\".\n"
        "- Add \"euclid\" with per-track objects {\"k\", \"n\", \"r\"} for tracks that use a ring (k pulses, n ring length 1–16, r rotation). "
        "Omitted tracks get k=0 until edited. Kick/snare can stay on a full grid with high k=n if you need every step eligible.\n\n"
        "OPTIONAL: producer_notes (string, plain text, no markdown, max ~1200 chars):\n"
        "- When the prompt implies genre world-building or accompaniment (e.g. hypnotic techno, modular, bassline, melody, pads, hooks), include producer_notes with 4–8 short sentences of Eurorack/modular guidance: clock/mults, voice roles, register vs kick/sub, sequence length vs this drum loop, minimal counter-melody, filter movement. Do not imply this software controls modular hardware.\n"
        "- When polyrhythm, hypnotic cycles, or uneven peripheral percussion fit the request, add 1–3 concrete Euclidean (k,n,r) suggestions per named track; if the user asked for Euclidean sequencing, emit seq_mode/euclid in emit_pattern (not producer_notes alone).\n"
        "- For simple drum-only tweaks (e.g. denser hats, more kick), omit producer_notes to save tokens.\n\n"
        "TARGETED UPDATES:\n"
        "When the user prompt contains a TARGETED UPDATE block:\n"
        "- Copy the PRESERVE tracks verbatim, step-for-step, from the previous pattern\n"
        "- Only generate new content for the MODIFY tracks\n"
        "- CC changes still apply to any track mentioned in the request\n\n"
        "IMPORTANT: Call the emit_pattern tool with the full pattern as its arguments. "
        "If tools cannot be used, output ONLY the JSON object — no text before or after, no markdown fences."
    )

_HELP_SYSTEM_PROMPT = (
    "You are a helpful assistant for the digitakt-llm drum sequencer CLI tool. "
    "Answer questions concisely and directly — 3–6 lines max, plain text, no markdown. "
    "Assume the user is at a terminal and cannot scroll.\n\n"
    "COMMANDS:\n"
    "  play / stop                          — start or stop MIDI playback\n"
    "  bpm <n>                              — set tempo (20–400 BPM)\n"
    "  swing <n>                            — set swing 0–100 (50 = strong triplet shuffle)\n"
    "  prob <track> <step> <0-100>          — step probability (100=always, 0=never)\n"
    "  vel <track> <step> <0-127>           — step velocity\n"
    "  cc <track> <param> <0-127>           — set track CC globally\n"
    "  cc-step <track> <param> <step> <0-127>  — per-step CC override (-1 to clear)\n"
    "  random <track|all> <velocity|prob> [lo-hi]  — randomize\n"
    "  randbeat                             — generate a random techno beat\n"
    "  save <name> / load <name>            — persist patterns\n"
    "  help                                 — show command reference\n"
    "  ask <question>                       — ask a question about the tool\n"
    "  <bare text>                          — send to Claude to generate a drum pattern\n\n"
    "TRACKS: kick, snare, tom, clap, bell, hihat, openhat, cymbal\n\n"
    "CC PARAMS (Digitakt MIDI CC):\n"
    "  tune (CC 16)       — pitch/tune of the sample\n"
    "  filter (CC 74)     — filter cutoff frequency\n"
    "  resonance (CC 75)  — filter resonance / Q\n"
    "  attack (CC 78)     — amp envelope attack time\n"
    "  decay (CC 80)      — amp envelope decay time\n"
    "  volume (CC 7)      — track output volume\n"
    "  reverb (CC 83)     — reverb send amount\n"
    "  delay (CC 82)      — delay send amount\n\n"
    "SWING: delays the even 16th-note positions (the 'ands' of each beat). "
    "0 = straight/mechanical. 25 = light shuffle. 50 = strong triplet feel. 100 = maximum.\n\n"
    "PROB: per-step probability 0–100 that a step fires. 100 = always, 50 = half the time, 0 = never.\n\n"
    "VELOCITY: 0–127 intensity of each hit. 0 = silent. Per-step velocity is scaled by the track's global velocity.\n\n"
    "PER-STEP CC: use cc-step to set CC values that apply only on a specific step. "
    "At the end of each 16-step loop, global CC values are restored automatically.\n\n"
    "SOUND / ARRANGEMENT: TR-808 is long subby kicks and rounder hats; TR-909 is punchy kicks, bright snare, metallic hats — "
    "beat mode encodes these as Digitakt CC + velocity. For modular/Eurorack bass and melody ideas with a beat, use beat mode: "
    "the JSON may include producer_notes (shown in the UI after generation). This tool only drives Digitakt drums via MIDI.\n\n"
    "After your answer, add exactly one final line (no blank lines after it):\n"
    "IMPLEMENTABLE: YES   — only if you described a specific playable drum groove/rhythm/pattern.\n"
    "IMPLEMENTABLE: NO    — for tool help, general chat, or non-rhythm answers.\n"
    "Do not add commentary after the IMPLEMENTABLE line."
)

_CLASSIFY_SYSTEM_PROMPT = (
    "You classify whether a response describes something implementable as a drum pattern. "
    "Respond with ONLY 'YES' or 'NO'. "
    "Say YES if the response describes a specific beat, rhythm, groove, pattern, or sequence "
    "that could be programmed into a drum machine. "
    "Say NO for general information, explanations, or tool usage instructions."
)


def _strip_markdown(text: str) -> str:
    """Strip common markdown formatting for plain-terminal display."""
    # Bold: **text** or __text__
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)
    # Italic: *text* or _text_ (apply after bold to avoid partial matches)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'_(.+?)_', r'\1', text)
    # Inline code: `text`
    text = re.sub(r'`(.+?)`', r'\1', text)
    # Headings: ## text → TEXT:
    text = re.sub(r'^#{1,6}\s+(.+)$', lambda m: m.group(1).upper() + ":", text, flags=re.MULTILINE)
    # Horizontal rules
    text = re.sub(r'^[-=]{3,}$', '', text, flags=re.MULTILINE)
    return text.strip()


_CONVERSATION_HISTORY_MAX = 10


class Generator:
    def __init__(self, state: AppState, bus: EventBus) -> None:
        self.state = state
        self.bus = bus
        self._client = anthropic.Anthropic()
        self.conversation_history: list[dict[str, str]] = []

    def generate(self, prompt: str, variation: bool = False) -> None:
        thread = threading.Thread(
            target=self._run, args=(prompt, variation), daemon=True
        )
        thread.start()

    def _build_state_context(self) -> str:
        """Build a summary of current playback state for the model."""
        parts: list[str] = []

        # Muted tracks
        muted = [t for t in TRACK_NAMES if self.state.track_muted.get(t, False)]
        if muted:
            parts.append(f"Muted tracks: {', '.join(muted)}")

        # Non-default CC values
        cc_overrides: list[str] = []
        defaults = {"tune": 64, "filter": 127, "resonance": 0, "attack": 0,
                    "decay": 64, "volume": 100, "reverb": 0, "delay": 0}
        for track in TRACK_NAMES:
            cc = self.state.track_cc.get(track, {})
            for param, default_val in defaults.items():
                val = cc.get(param, default_val)
                if val != default_val:
                    cc_overrides.append(f"{track}.{param}={val}")
        if cc_overrides:
            parts.append(f"CC overrides: {', '.join(cc_overrides[:20])}")

        # Non-default velocities
        vel_overrides = [
            f"{t}={v}" for t in TRACK_NAMES
            for v in [self.state.track_velocity.get(t, 127)]
            if v != 127
        ]
        if vel_overrides:
            parts.append(f"Track velocities: {', '.join(vel_overrides)}")

        # BPM and pattern length
        parts.append(f"BPM: {self.state.bpm}")
        if self.state.pattern_length != 16:
            parts.append(f"Pattern length: {self.state.pattern_length} steps")

        # Swing
        swing = self.state.current_pattern.get("swing", 0)
        if swing:
            parts.append(f"Swing: {swing}")

        # MIDI note pitch per track (chromatic), default 60
        pitch_ov = [
            f"{t}={p}" for t in TRACK_NAMES
            if (p := self.state.track_pitch.get(t, 60)) != 60
        ]
        if pitch_ov:
            parts.append(f"Track MIDI pitch: {', '.join(pitch_ov)}")

        pat = self.state.current_pattern
        steps = self.state.pattern_length
        prob = pat.get("prob") if isinstance(pat.get("prob"), dict) else None
        if prob:
            bits: list[str] = []
            for t in TRACK_NAMES:
                vals = prob.get(t)
                if not isinstance(vals, list) or len(vals) != steps:
                    continue
                n_var = sum(1 for v in vals if isinstance(v, int) and v < 100)
                if n_var:
                    lo = min(v for v in vals if isinstance(v, int))
                    hi = max(v for v in vals if isinstance(v, int))
                    bits.append(f"{t}:{n_var} steps<100% min={lo} max={hi}")
            if bits:
                parts.append("Prob summary: " + "; ".join(bits[:8]))

        gate = pat.get("gate") if isinstance(pat.get("gate"), dict) else None
        if gate:
            gbits: list[str] = []
            for t in TRACK_NAMES:
                vals = gate.get(t)
                if not isinstance(vals, list) or len(vals) != steps:
                    continue
                n_non = sum(
                    1 for v in vals
                    if isinstance(v, int) and v != DEFAULT_GATE_PCT
                )
                if n_non:
                    gbits.append(f"{t}:{n_non}≠{DEFAULT_GATE_PCT}%")
            if gbits:
                parts.append("Gate summary: " + "; ".join(gbits[:8]))

        cond = pat.get("cond") if isinstance(pat.get("cond"), dict) else None
        if cond:
            cbits: list[str] = []
            for t in TRACK_NAMES:
                vals = cond.get(t)
                if not isinstance(vals, list) or len(vals) != steps:
                    continue
                n_set = sum(1 for v in vals if v is not None and v != "")
                if n_set:
                    kinds: dict[str, int] = {}
                    for v in vals:
                        if v is None or v == "":
                            continue
                        s = str(v)
                        kinds[s] = kinds.get(s, 0) + 1
                    desc = ",".join(f"{k}:{c}" for k, c in sorted(kinds.items())[:4])
                    cbits.append(f"{t}:{n_set}({desc})")
            if cbits:
                parts.append("Conditional trigs: " + "; ".join(cbits[:8]))

        if self.state.chain:
            names = " → ".join(self.state.chain[:12])
            if len(self.state.chain) > 12:
                names += " …"
            parts.append(
                f"Pattern chain: {names} (auto={self.state.chain_auto}, "
                f"index={self.state.chain_index})"
            )

        return "\n".join(parts)

    def _build_user_prompt(self, prompt: str, variation: bool) -> str:
        state_ctx = self._build_state_context()
        context_prefix = build_injectable_context_prefix(prompt)

        if variation and self.state.last_prompt and self.state.current_pattern:
            steps = self.state.pattern_length
            pattern_json = _serialize_pattern_for_llm(self.state.current_pattern, steps)
            target_tracks = _detect_target_tracks(prompt)
            if target_tracks:
                preserve = [t for t in TRACK_NAMES if t not in target_tracks]
                modify = [t for t in TRACK_NAMES if t in target_tracks]
                constraint = (
                    f"TARGETED UPDATE — only modify the listed tracks:\n"
                    f"  MODIFY: {', '.join(modify)}\n"
                    f"  PRESERVE EXACTLY (copy steps verbatim from previous pattern): {', '.join(preserve)}\n\n"
                )
            else:
                constraint = ""
            return (
                f"{context_prefix}"
                f"{constraint}"
                f"Current state:\n{state_ctx}\n\n"
                f"Previous prompt: {self.state.last_prompt}\n"
                f"Previous pattern: {pattern_json}\n\n"
                f"Apply this variation: {prompt}"
            )

        if state_ctx:
            return f"{context_prefix}Current state:\n{state_ctx}\n\n{prompt}"
        if context_prefix:
            return f"{context_prefix}{prompt}"
        return prompt

    def _parse_pattern(
        self, text: str, steps: int = 16
    ) -> tuple[dict, int | None, dict, str | None] | None:
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[-1]   # drop opening ```json line
            stripped = stripped.rsplit("```", 1)[0]  # drop closing ```
            stripped = stripped.strip()
        try:
            data = json.loads(stripped)
        except (json.JSONDecodeError, ValueError):
            return None
        return _coerce_pattern_dict(data, steps)

    def _call_api(self, user_prompt: str, retry: bool = False) -> tuple[str, dict | None]:
        """Returns (raw_text, tool_input). Prefer tool_input when set."""
        steps = self.state.pattern_length
        content = user_prompt
        if retry:
            content += (
                "\n\nRemember: call emit_pattern with the full pattern, or output ONLY the JSON object. "
                "All 8 tracks are required: kick, snare, tom, clap, bell, hihat, openhat, cymbal."
            )
        tool_def = _emit_pattern_tool_schema(steps)
        max_out = _opus_max_output_tokens(steps)
        with tracer.span("generate" if not retry else "generate_retry", prompt=content) as span:
            response = self._client.messages.create(
                model="claude-opus-4-6",
                max_tokens=max_out,
                system=[{
                    "type": "text",
                    "text": _build_system_prompt(steps),
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{"role": "user", "content": content}],
                tools=[tool_def],
                tool_choice={"type": "tool", "name": "emit_pattern"},
            )
            raw_text = ""
            tool_input: dict | None = None
            for block in response.content:
                btype = getattr(block, "type", None)
                if btype == "tool_use" and getattr(block, "name", None) == "emit_pattern":
                    inp = getattr(block, "input", None)
                    if isinstance(inp, dict):
                        tool_input = inp
                elif hasattr(block, "text"):
                    raw_text += block.text
            trace_payload = json.dumps(tool_input, default=str) if tool_input else raw_text
            span.set_response(trace_payload[:8000] if trace_payload else "")
            span.set_status("ok")
        logger.info(
            "API call completed",
            extra={"latency_ms": span.latency_ms, "status": "ok", "prompt": content[:200]},
        )
        return raw_text, tool_input

    def _run(self, prompt: str, variation: bool = False) -> None:
        self.bus.emit("generation_started", {"prompt": prompt})
        user_prompt = self._build_user_prompt(prompt, variation)
        logger.info("Generation started", extra={"prompt": prompt})
        t0 = time.monotonic()

        try:
            text, tool_input = self._call_api(user_prompt)
            steps = self.state.pattern_length
            if tool_input is not None:
                result = _coerce_pattern_dict(tool_input, steps)
            else:
                result = self._parse_pattern(text, steps=steps)

            if result is None:
                # Log the invalid JSON response (truncated for safety)
                logger.warning(
                    "Invalid JSON from model, retrying",
                    extra={
                        "prompt": prompt,
                        "raw_response": (text[:500] if text else json.dumps(tool_input)[:500]),
                        "error_type": "json_parse_failed",
                    },
                )
                text, tool_input = self._call_api(user_prompt, retry=True)
                if tool_input is not None:
                    result = _coerce_pattern_dict(tool_input, steps)
                else:
                    result = self._parse_pattern(text, steps=steps)

            if result is None:
                logger.error(
                    "Invalid JSON after retry — generation failed",
                    extra={
                        "prompt": prompt,
                        "raw_response": (text[:500] if text else json.dumps(tool_input)[:500]),
                        "error_type": "json_parse_failed_after_retry",
                    },
                )
                self.bus.emit(
                    "generation_failed",
                    {"prompt": prompt, "error": "Invalid JSON after retry"},
                )
                return

            pattern, bpm, cc_changes, producer_notes = result
            # If emit_pattern omits seq_mode / euclid, preserve them from the live pattern so a
            # generation does not silently revert the user's sequencing mode or wipe ring settings.
            existing = self.state.current_pattern or {}
            if "seq_mode" not in pattern and isinstance(existing.get("seq_mode"), str):
                pattern["seq_mode"] = existing["seq_mode"]
            if "euclid" not in pattern and isinstance(existing.get("euclid"), dict):
                pattern["euclid"] = copy.deepcopy(existing["euclid"])
            if "lfo" not in pattern and isinstance(existing.get("lfo"), dict):
                pattern["lfo"] = copy.deepcopy(existing["lfo"])
            self.state.update_pattern(pattern, prompt)
            self.state.pending_pattern = pattern

            for track, params in cc_changes.items():
                for param, value in params.items():
                    if param == "velocity":
                        self.state.update_velocity(track, value)
                        self.bus.emit("velocity_changed", {"track": track, "value": value})
                    else:
                        self.state.update_cc(track, param, value)
                        self.bus.emit("cc_changed", {"track": track, "param": param, "value": value})

            logger.info("Generation complete", extra={"prompt": prompt, "status": "ok"})
            # Store in conversation history for cross-mode continuity
            self._add_to_history("user", f"[beat generation] {prompt}")
            self._add_to_history("assistant", f"[generated pattern at {bpm or self.state.bpm} BPM]")
            latency_ms = int((time.monotonic() - t0) * 1000)
            summary = _compute_generation_summary(
                prompt, pattern, latency_ms, producer_notes
            )
            self.bus.emit(
                "generation_complete",
                {
                    "pattern": pattern,
                    "prompt": prompt,
                    "bpm": bpm,
                    "cc_changes": cc_changes,
                    "summary": summary,
                    "producer_notes": producer_notes,
                },
            )

        except Exception as exc:
            logger.error(
                "Generation crashed",
                extra={"prompt": prompt, "error_type": type(exc).__name__},
                exc_info=True,
            )
            self.bus.emit(
                "generation_failed", {"prompt": prompt, "error": str(exc)}
            )

    def _add_to_history(self, role: str, content: str) -> None:
        """Add a message to the shared conversation history."""
        self.conversation_history.append({"role": role, "content": content})
        # Keep history bounded
        if len(self.conversation_history) > _CONVERSATION_HISTORY_MAX * 2:
            self.conversation_history = self.conversation_history[-_CONVERSATION_HISTORY_MAX * 2:]

    def _ask_llm_raw(self, question: str) -> str:
        """Single Haiku completion for /ask (plain text + IMPLEMENTABLE line)."""
        messages = list(self.conversation_history[-_CONVERSATION_HISTORY_MAX:])
        messages.append({"role": "user", "content": question})
        response = self._client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=320,
            system=_HELP_SYSTEM_PROMPT,
            messages=messages,
        )
        parts: list[str] = []
        for block in response.content:
            if hasattr(block, "text"):
                parts.append(block.text)
        return "".join(parts).strip()

    def answer_question(self, question: str) -> str:
        """Answer a question about the tool. Returns plain text."""
        return self.answer_question_with_classify(question)[0]

    def classify_as_implementable(self, answer: str) -> bool:
        """Lightweight classifier: does this answer describe a programmable drum pattern?
        Fails closed — returns False on any exception."""
        try:
            response = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=5,
                system=_CLASSIFY_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": answer}],
            )
            text = response.content[0].text.strip().upper()
            return text.startswith("YES")
        except Exception:
            return False

    def answer_question_with_classify(self, question: str) -> tuple[str, bool]:
        """Answer a question; implementability from trailing IMPLEMENTABLE line (one API call)."""
        raw = self._ask_llm_raw(question)
        answer, is_implementable = _parse_ask_response(_strip_markdown(raw))
        self._add_to_history("user", question)
        self._add_to_history("assistant", answer)
        return answer, is_implementable
