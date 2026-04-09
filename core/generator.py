# core/generator.py
from __future__ import annotations

import json
import threading
import anthropic
from core.state import AppState, TRACK_NAMES
from core.events import EventBus

_SYSTEM_PROMPT = (
    "You are an expert drum pattern generator for electronic music production. "
    "You deeply understand groove, genre conventions, rhythm feel, and dynamics. "
    "Generate 16-step drum patterns as strict JSON. Each step is an integer 0–127 "
    "(velocity), 0 = silent.\n\n"
    "Respond ONLY with valid JSON in this exact format — no explanation, no markdown:\n"
    '{\n'
    '  "kick":    [16 integers 0-127],\n'
    '  "snare":   [16 integers 0-127],\n'
    '  "tom":     [16 integers 0-127],\n'
    '  "clap":    [16 integers 0-127],\n'
    '  "bell":    [16 integers 0-127],\n'
    '  "hihat":   [16 integers 0-127],\n'
    '  "openhat": [16 integers 0-127],\n'
    '  "cymbal":  [16 integers 0-127]\n'
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

    def _parse_pattern(self, text: str) -> dict | None:
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
        return data

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
            pattern = self._parse_pattern(text)

            if pattern is None:
                text = self._call_api(user_prompt, strict=True)
                pattern = self._parse_pattern(text)

            if pattern is None:
                self.bus.emit(
                    "generation_failed",
                    {"prompt": prompt, "error": "Invalid JSON after retry"},
                )
                return

            self.state.update_pattern(pattern, prompt)
            self.state.pending_pattern = pattern
            self.bus.emit("generation_complete", {"pattern": pattern, "prompt": prompt})

        except Exception as exc:
            self.bus.emit(
                "generation_failed", {"prompt": prompt, "error": str(exc)}
            )
