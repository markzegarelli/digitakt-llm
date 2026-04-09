# core/generator.py
from __future__ import annotations

import json
import threading
import anthropic
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.midi_utils import CC_MAP

_SYSTEM_PROMPT = (
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
    "Generate 16-step drum patterns as strict JSON. Each step is an integer 0–127 (velocity), 0 = silent.\n\n"
    "OPTIONAL CC ADJUSTMENTS:\n"
    "When a request adjusts sound parameters or velocity, include an optional \"cc\" key with only the\n"
    "tracks and params that should change. Valid params: tune, filter, resonance, attack, decay, volume,\n"
    "reverb, delay, velocity. All values 0–127. velocity scales the track's overall strike intensity.\n\n"
    "Respond ONLY with valid JSON in this exact format — no explanation, no markdown:\n"
    '{\n'
    '  "bpm":     <integer from subgenre range>,\n'
    '  "kick":    [16 integers 0-127],\n'
    '  "snare":   [16 integers 0-127],\n'
    '  "tom":     [16 integers 0-127],\n'
    '  "clap":    [16 integers 0-127],\n'
    '  "bell":    [16 integers 0-127],\n'
    '  "hihat":   [16 integers 0-127],\n'
    '  "openhat": [16 integers 0-127],\n'
    '  "cymbal":  [16 integers 0-127],\n'
    '  "cc": {"<track>": {"<param>": <0-127>, ...}, ...}  (optional)\n'
    "}"
)

_STRICT_SUFFIX = (
    "\n\nIMPORTANT: Output ONLY the JSON object. "
    "No text before, no text after, no markdown fences."
)


class Generator:
    def __init__(self, state: AppState, bus: EventBus) -> None:
        self.state = state
        self.bus = bus
        self._client = anthropic.Anthropic()

    def generate(self, prompt: str, variation: bool = False) -> None:
        thread = threading.Thread(
            target=self._run, args=(prompt, variation), daemon=True
        )
        thread.start()

    def _build_user_prompt(self, prompt: str, variation: bool) -> str:
        if variation and self.state.last_prompt and self.state.current_pattern:
            return (
                f"Previous prompt: {self.state.last_prompt}\n"
                f"Previous pattern: {json.dumps(self.state.current_pattern)}\n\n"
                f"Apply this variation: {prompt}"
            )
        return prompt

    def _parse_pattern(self, text: str) -> tuple[dict, int | None, dict] | None:
        try:
            data = json.loads(text.strip())
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        if not all(k in data for k in TRACK_NAMES):
            return None
        if not all(len(data[k]) == 16 for k in TRACK_NAMES):
            return None
        if not all(
            isinstance(v, int) and 0 <= v <= 127
            for k in TRACK_NAMES
            for v in data[k]
        ):
            return None
        raw_bpm = data.get("bpm")
        bpm = int(raw_bpm) if isinstance(raw_bpm, (int, float)) and 20 <= raw_bpm <= 400 else None
        pattern = {k: data[k] for k in TRACK_NAMES}

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

    def _call_api(self, user_prompt: str, strict: bool = False) -> str:
        content = user_prompt + (_STRICT_SUFFIX if strict else "")
        response = self._client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1024,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        return response.content[0].text

    def _run(self, prompt: str, variation: bool = False) -> None:
        self.bus.emit("generation_started", {"prompt": prompt})
        user_prompt = self._build_user_prompt(prompt, variation)

        try:
            text = self._call_api(user_prompt)
            result = self._parse_pattern(text)

            if result is None:
                text = self._call_api(user_prompt, strict=True)
                result = self._parse_pattern(text)

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

            self.bus.emit("generation_complete", {"pattern": pattern, "prompt": prompt, "bpm": bpm, "cc_changes": cc_changes})

        except Exception as exc:
            self.bus.emit(
                "generation_failed", {"prompt": prompt, "error": str(exc)}
            )
