# core/injectable_profiles.py
"""User-message context injected before beat-generation prompts (not the cached system prompt).

Profiles are recallable by stable id + phrase aliases (genre moods, drum-machine sonic targets).
See ARCHITECTURE.md for how to add entries.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

ProfileCategory = Literal["genre", "drum_machine"]


@dataclass(frozen=True)
class InjectableProfile:
    """One injectable block: match any alias (word-boundary, case-insensitive) to prepend ``body``."""

    id: str
    category: ProfileCategory
    aliases: tuple[str, ...]
    body: str


_AMBIENT_BODY = (
    "AMBIENT MODE CONTEXT (use instead of standard drum conventions):\n"
    "This is an ambient / drone / downtempo request. The 8 fixed track slots are\n"
    "named after drums (kick/snare/tom/clap/bell/hihat/openhat/cymbal) but should\n"
    "be REPURPOSED as atmospheric voices. Do not program a typical beat.\n\n"
    "PATTERN CONVENTIONS:\n"
    "  - BPM 70–110 (pick from ambient range).\n"
    "  - Extremely sparse triggers: often 1–2 hits per bar per voice; some voices\n"
    "    may be silent across the entire loop (that is correct, not a mistake).\n"
    "  - Avoid four-on-the-floor, avoid hi-hat 16th grids — no rhythmic beat.\n"
    "  - Use \"prob\" aggressively on 10–40 for most active steps so the loop\n"
    "    evolves slowly across bars rather than repeating verbatim.\n"
    "  - \"swing\" should be 0 unless the request explicitly asks for groove.\n"
    "  - Velocities soft: mostly 40–90. Occasional 100+ for a swell peak.\n\n"
    "TRACK ROLE REMAPPING — treat each track as an ambient voice:\n"
    "  - kick    → sub drone / filtered low pulse (≤1 hit per bar, very long tail)\n"
    "  - snare   → reverse cymbal swell / noise riser\n"
    "  - tom     → tonal pad or mallet (long attack, long decay)\n"
    "  - clap    → granular texture burst / air / breath sample\n"
    "  - bell    → FM bell / chime / music-box ping with long reverb tail\n"
    "  - hihat   → high shimmer / grain cloud / tape flutter\n"
    "  - openhat → wash / tape hiss bed / field-recording wind\n"
    "  - cymbal  → crash with very long reverb, used once as a rare marker\n\n"
    "CC GUIDANCE TUNED FOR AMBIENT (emit a \"cc\" block reflecting these):\n"
    "  attack 40–100, decay 100–127, reverb 60–100, delay 30–70,\n"
    "  filter 40–90 (for slow movement), resonance 0–25, volume 90–110.\n"
    "  Kick/sub voice may keep attack low (0–15) but decay 100+ for sustain.\n\n"
    "REQUIRED producer_notes FORMAT for ambient:\n"
    "producer_notes MUST begin with a TRACK SAMPLES: section listing every one\n"
    "of the 8 tracks on its own line as:\n"
    "  - <track>: <concise sample description>\n"
    "Then follow with 2–4 short sentences of arrangement guidance (evolution,\n"
    "register, how the voices interlock over time). Plain text, no markdown.\n"
    "Example opening:\n"
    "TRACK SAMPLES:\n"
    "- kick: filtered sub-drone, one pulse per bar, slow decay\n"
    "- snare: reverse cymbal swell on the back half of the bar\n"
    "- tom: soft mallet pad, long attack, rooted on A2\n"
    "- clap: granular breath texture, very low velocity\n"
    "- bell: FM chime with 3-second reverb, sparse taps\n"
    "- hihat: high shimmer cloud, probability 20\n"
    "- openhat: tape hiss wash, constant low-velocity bed\n"
    "- cymbal: crash with 6-second tail, fires once across the loop\n"
)

_LINNDRUM_BODY = (
    "LINNDRUM (LM-2) MACHINE CONTEXT — emulate this sonic profile with samples + CC + velocity:\n"
    "Overall: dry, punchy, upfront; no room wash. Short 8-bit-style samples — crisp with slight "
    "crunch. Tight grid, confident 80s commercial feel (Prince / MJ-era pop, early hip-hop sampling).\n\n"
    "Per-voice targets on Digitakt tracks:\n"
    "  - kick: rounded low thump ~60–80Hz sense, fast decay vs acoustic; small attack click, not "
    "overly clicky. CC: attack 0–8, decay 35–55 for punch, tune ~55–68, filter 85–115, reverb 0–15, "
    "delay 0–15.\n"
    "  - snare: bright crack, fast attack, papery/cardboard, medium-short decay; strong 4–6k snap, "
    "minimal body thump. CC: decay 25–45, filter 90–127 (bright), resonance low 0–20, reverb 0–20.\n"
    "  - hihat: metallic, slightly lo-fi; tight bright closed character. CC: decay 20–40, tune "
    "72–82, filter 70–105.\n"
    "  - openhat: distinct \"tsss\", abbreviated decay, less splashy than acoustic. CC: decay "
    "40–70, filter 80–115; contrast level vs closed hat.\n"
    "  - clap: layered processed clap, bright and forward (not one hand). CC: attack 0–12, decay "
    "30–50, filter 85–115.\n"
    "  - tom: tuned melodic toms, noticeable pitch drop through decay (\"tom bend\"). CC: tune per "
    "tom role, decay 55–90, filter 75–105, slight envelope movement.\n"
    "  - bell: map cabasa/tambourine-like rattles here when needed — textured, articulate. CC: "
    "decay 25–55, filter 80–110.\n"
    "  - cymbal: short crash splash if used — keep dry vs ambient music. CC: decay 35–60, reverb low.\n\n"
    "Technical: ~28kHz-era sense → slight HF rolloff above ~12k (pull filter from fully wide on "
    "bright tracks); 8-bit grit → subtle harmonic feel via moderate resonance or filtered highs, "
    "not fuzz. Original fixed velocity → keep hits very consistent (narrow velocity bands per "
    "track, ghosts only where musically obvious); minimal per-step tune wobble. No analog noise "
    "bed unless requested.\n"
)

_CR78_BODY = (
    "ROLAND CR-78 MACHINE CONTEXT — emulate this sonic profile with samples + CC + velocity:\n"
    "Overall: warm, soft-edged, organic early drum box; analog breathiness, tape-ish softness, "
    "less upfront than LinnDrum. Sits under pads/bass — intimate, slightly fragile, dreamy retro "
    "(Phil Collins breakdown era, Blondie, early Moroder).\n\n"
    "Per-voice targets on Digitakt tracks:\n"
    "  - kick: softer round attack, thud not punch, warm but not deep sub. CC: attack 2–15, "
    "decay 45–75, tune 58–72, filter 70–95, reverb 5–25.\n"
    "  - snare: thin, tissy, noise-forward (brush-like), sits back — not Linn crack. CC: filter "
    "75–100 (not ultra-bright), decay 35–55, reverb 10–30.\n"
    "  - hihat: analog-synth burst, short, slightly buzzy closed metal. CC: decay 15–35, filter "
    "65–95, tune 68–80.\n"
    "  - openhat: washy fuzzy sustain, very recognizable CR character. CC: decay 55–90, reverb "
    "15–40, filter 75–105.\n"
    "  - clap: soft diffuse handclaps, almost muffled/carpeted. CC: filter 60–85, decay 25–45, "
    "velocity moderate-low band.\n"
    "  - tom: warm rounded low-mids, mild pitch, less dramatic tom-bend than Linn. CC: decay 50–80, "
    "tune 60–75, filter 72–95.\n"
    "  - bell: map CR cowbell — bright, hollow, plasticky nasal resonance. CC: tune 75–90, "
    "decay 30–50, resonance 15–40 for nasal peak, filter 80–110.\n"
    "  - cymbal: washy lo-fi shimmer, long splashy decay, synthetic (beloved character). CC: "
    "decay 70–110, reverb 25–55, filter 70–100.\n\n"
    "Latin/shaker textures (maracas/guiro): map to hihat/tom interplay — shaker-like motion with "
    "short decay and light swing when the groove asks.\n\n"
    "Technical: hybrid analog/ROM primitive fidelity; allow subtle noise floor on sustained "
    "voices (slight hat/cymbal noise) via low-level velocity + light filter movement — not digital "
    "silence. Fixed velocity heritage → narrow velocity ranges, gentle ghosts only.\n"
)

_PROFILE_TUPLE: tuple[InjectableProfile, ...] = (
    InjectableProfile(
        id="ambient",
        category="genre",
        aliases=(
            "dark ambient",
            "deep listening",
            "ambient",
            "drone",
            "downtempo",
            "soundscape",
        ),
        body=_AMBIENT_BODY,
    ),
    InjectableProfile(
        id="linndrum",
        category="drum_machine",
        aliases=(
            "linndrum",
            "linn drum",
            "linn lm-2",
            "lm-2",
            "lm2",
            "lm 2",
        ),
        body=_LINNDRUM_BODY,
    ),
    InjectableProfile(
        id="cr78",
        category="drum_machine",
        aliases=(
            "roland cr-78",
            "roland cr78",
            "compurhythm 78",
            "cr-78",
            "cr78",
        ),
        body=_CR78_BODY,
    ),
)

PROFILES_BY_ID: dict[str, InjectableProfile] = {p.id: p for p in _PROFILE_TUPLE}

NEGATION_WORDS: frozenset[str] = frozenset({"no", "not", "without", "non"})


def validate_injectable_profile_registry(profiles: dict[str, InjectableProfile]) -> None:
    seen_alias: dict[str, str] = {}
    for key, p in profiles.items():
        if p.id != key:
            raise ValueError(f"Profile dict key {key!r} must equal profile.id {p.id!r}")
        if not p.aliases:
            raise ValueError(f"Profile {p.id!r} has no aliases")
        for alias in p.aliases:
            lowered = alias.lower()
            if lowered in seen_alias:
                raise ValueError(
                    f"Duplicate injectable alias {alias!r}: profiles {seen_alias[lowered]!r} and {p.id!r}"
                )
            seen_alias[lowered] = p.id


validate_injectable_profile_registry(PROFILES_BY_ID)


def _is_negated_match(prompt_lowered: str, start: int) -> bool:
    """True when the alias at ``start`` is locally negated (e.g. 'not ambient', 'non-ambient')."""
    if start > 0 and prompt_lowered[start - 1] == "-":
        prefix = prompt_lowered[max(0, start - 4) : start]
        if prefix == "non-":
            return True

    window = prompt_lowered[max(0, start - 40) : start]
    tokens = re.findall(r"[a-z]+", window)
    if not tokens:
        return False

    for token in tokens[-4:]:
        if token in NEGATION_WORDS:
            return True
    return False


def _detect_profile_in_category(prompt: str, category: ProfileCategory) -> str | None:
    """Earliest non-negated alias wins; ties at same index favor longer phrase."""
    lowered = prompt.lower()
    matches: list[tuple[int, int, str]] = []

    for p in PROFILES_BY_ID.values():
        if p.category != category:
            continue
        for alias in p.aliases:
            for m in re.finditer(r"\b" + re.escape(alias) + r"\b", lowered):
                if _is_negated_match(lowered, m.start()):
                    continue
                matches.append((m.start(), m.end(), p.id))

    if not matches:
        return None

    matches.sort(key=lambda t: (t[0], -(t[1] - t[0])))
    return matches[0][2]


def detect_genre_profile(prompt: str) -> str | None:
    """Return profile id when prompt matches a genre injectable (e.g. ambient)."""
    return _detect_profile_in_category(prompt, "genre")


def detect_drum_machine_profile(prompt: str) -> str | None:
    """Return profile id when prompt matches a drum-machine injectable (e.g. linndrum, cr78)."""
    return _detect_profile_in_category(prompt, "drum_machine")


def build_injectable_context_prefix(prompt: str) -> str:
    """Genre block first, then drum-machine block; each block ends with a newline for concatenation."""
    parts: list[str] = []
    gid = detect_genre_profile(prompt)
    if gid:
        parts.append(PROFILES_BY_ID[gid].body)
    mid = detect_drum_machine_profile(prompt)
    if mid:
        parts.append(PROFILES_BY_ID[mid].body)
    if not parts:
        return ""
    return "\n".join(parts) + "\n"
