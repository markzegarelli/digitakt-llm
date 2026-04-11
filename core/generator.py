# core/generator.py
from __future__ import annotations

import functools
import json
import threading
import anthropic
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.midi_utils import CC_MAP

@functools.lru_cache(maxsize=3)
def _build_system_prompt(steps: int = 16) -> str:
    return (
        "You are an expert drum pattern generator specializing in techno and electronic music production. "
        "You understand groove, hypnotic repetition, tension, and the specific conventions of techno subgenres.\n\n"
        "SUBGENRE BPM RANGES — choose a BPM from the matching range based on the user's request:\n"
        "  detroit techno:          130–138\n"
        "  minimal techno:          130–136\n"
        "  acid techno:             138–145\n"
        "  hypnotic / trance techno: 140–148\n"
        "  industrial techno:       140–150\n"
        "  dark techno / hard techno: 142–155\n"
        "  schranz:                 150–162\n"
        "  generic / unspecified:   133–140\n\n"
        "GROOVE RULES:\n"
        "  - Kick: four-on-the-floor (steps 1,5,9,13) is the techno foundation; vary velocity 90–127 for feel\n"
        "  - Snare/clap: anchor on beats 2 and 4 (steps 5 and 13); ghost notes on steps 3,7,11,15 add groove\n"
        "  - Hihat: vary velocity across steps (range 40–100) — never use uniform flat values\n"
        "  - Open hat: off-beat placements (step 9 is classic) or syncopated 3-against-4 patterns\n"
        "  - Tom/cymbal/bell: use sparingly for fills, accents, or hypnotic motifs — silence is valid\n"
        "  - Techno thrives on space and repetition; not every track needs hits every bar\n"
        "  - Use the full velocity range 0–127, not just 0 and 100\n\n"
        f"Generate {steps}-step drum patterns as strict JSON. Each step is an integer 0–127 (velocity), 0 = silent.\n\n"
        "OPTIONAL CC ADJUSTMENTS:\n"
        "When a request adjusts sound parameters or velocity, include an optional \"cc\" key with only the\n"
        "tracks and params that should change. Valid params: tune, filter, resonance, attack, decay, volume,\n"
        "reverb, delay, velocity. All values 0–127. velocity scales the track's overall strike intensity.\n\n"
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
        '  "cc": {"<track>": {"<param>": <0-127>, ...}, ...}  (optional)\n'
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
        "IMPORTANT: Output ONLY the JSON object. No text before, no text after, no markdown fences."
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
    "At the end of each 16-step loop, global CC values are restored automatically."
)


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

        return "\n".join(parts)

    def _build_user_prompt(self, prompt: str, variation: bool) -> str:
        state_ctx = self._build_state_context()

        if variation and self.state.last_prompt and self.state.current_pattern:
            active = {
                k: v for k, v in self.state.current_pattern.items()
                if not isinstance(v, list) or any(s > 0 for s in v)
            }
            return (
                f"Current state:\n{state_ctx}\n\n"
                f"Previous prompt: {self.state.last_prompt}\n"
                f"Previous pattern (active tracks): {json.dumps(active)}\n\n"
                f"Apply this variation: {prompt}"
            )

        if state_ctx:
            return f"Current state:\n{state_ctx}\n\n{prompt}"
        return prompt

    def _parse_pattern(self, text: str, steps: int = 16) -> tuple[dict, int | None, dict] | None:
        try:
            data = json.loads(text.strip())
        except (json.JSONDecodeError, ValueError):
            return None
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

        return pattern, bpm, cc_changes

    def _call_api(self, user_prompt: str, retry: bool = False) -> str:
        content = user_prompt
        if retry:
            content += "\n\nRemember: output ONLY the JSON object, no other text."
        response = self._client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1024,
            system=[{
                "type": "text",
                "text": _build_system_prompt(self.state.pattern_length),
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": content}],
        )
        return response.content[0].text

    def _run(self, prompt: str, variation: bool = False) -> None:
        self.bus.emit("generation_started", {"prompt": prompt})
        user_prompt = self._build_user_prompt(prompt, variation)

        try:
            text = self._call_api(user_prompt)
            result = self._parse_pattern(text, steps=self.state.pattern_length)

            if result is None:
                text = self._call_api(user_prompt, retry=True)
                result = self._parse_pattern(text, steps=self.state.pattern_length)

            if result is None:
                self.bus.emit(
                    "generation_failed",
                    {"prompt": prompt, "error": "Invalid JSON after retry"},
                )
                return

            pattern, bpm, cc_changes = result
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

            # Store in conversation history for cross-mode continuity
            self._add_to_history("user", f"[beat generation] {prompt}")
            self._add_to_history("assistant", f"[generated pattern at {bpm or self.state.bpm} BPM]")

            self.bus.emit("generation_complete", {"pattern": pattern, "prompt": prompt, "bpm": bpm, "cc_changes": cc_changes})

        except Exception as exc:
            self.bus.emit(
                "generation_failed", {"prompt": prompt, "error": str(exc)}
            )

    def _add_to_history(self, role: str, content: str) -> None:
        """Add a message to the shared conversation history."""
        self.conversation_history.append({"role": role, "content": content})
        # Keep history bounded
        if len(self.conversation_history) > _CONVERSATION_HISTORY_MAX * 2:
            self.conversation_history = self.conversation_history[-_CONVERSATION_HISTORY_MAX * 2:]

    def answer_question(self, question: str) -> str:
        """Answer a question about the tool. Returns plain text.
        Maintains conversation history shared with beat generation."""
        # Include recent conversation context
        messages = list(self.conversation_history[-_CONVERSATION_HISTORY_MAX:])
        messages.append({"role": "user", "content": question})

        response = self._client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            system=_HELP_SYSTEM_PROMPT,
            messages=messages,
        )
        answer = response.content[0].text.strip()

        self._add_to_history("user", question)
        self._add_to_history("assistant", answer)

        return answer
