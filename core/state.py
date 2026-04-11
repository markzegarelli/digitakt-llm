# core/state.py
from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass, field

TRACK_NAMES = ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]

DEFAULT_PATTERN: dict = {
    "kick":    [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
    "snare":   [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
    "tom":     [0] * 16,
    "clap":    [0] * 16,
    "bell":    [0] * 16,
    "hihat":   [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
    "openhat": [0] * 16,
    "cymbal":  [0] * 16,
}

EMPTY_PATTERN: dict = {track: [0] * 16 for track in ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]}

_HISTORY_MAX = 20


_DEFAULT_CC_PARAMS: dict[str, int] = {
    "tune": 64, "filter": 127, "resonance": 0,
    "attack": 0, "hold": 0, "decay": 64, "volume": 100,
    "reverb": 0, "delay": 0,
}


@dataclass
class AppState:
    current_pattern: dict = field(default_factory=dict)
    pending_pattern: dict | None = None
    bpm: float = 120.0
    is_playing: bool = False
    midi_port_name: str | None = None
    last_prompt: str | None = None
    pattern_history: list = field(default_factory=list)
    event_loop: asyncio.AbstractEventLoop | None = None
    track_cc: dict = field(default_factory=lambda: {
        track: dict(_DEFAULT_CC_PARAMS) for track in TRACK_NAMES
    })
    track_muted: dict = field(default_factory=lambda: {
        track: False for track in TRACK_NAMES
    })
    track_velocity: dict = field(default_factory=lambda: {
        track: 127 for track in TRACK_NAMES
    })
    pattern_length: int = 16
    fill_pattern: dict | None = None
    _fill_active: bool = field(default=False, init=False, repr=False)
    _pre_fill_pattern: dict | None = field(default=None, init=False, repr=False)
    _lock: threading.Lock = field(
        default_factory=threading.Lock, init=False, repr=False
    )

    def queue_fill(self, pattern: dict) -> None:
        with self._lock:
            self.fill_pattern = pattern

    def update_cc(self, track: str, param: str, value: int) -> None:
        with self._lock:
            self.track_cc[track][param] = value

    def update_velocity(self, track: str, value: int) -> None:
        with self._lock:
            self.track_velocity[track] = value

    def update_mute(self, track: str, muted: bool) -> None:
        with self._lock:
            self.track_muted[track] = muted

    def undo_pattern(self) -> dict | None:
        """Pop the most recent history entry and queue it as pending. Returns the pattern or None."""
        with self._lock:
            if not self.pattern_history:
                return None
            popped = self.pattern_history.pop()
            entry = self.pattern_history[-1] if self.pattern_history else popped
            self.pending_pattern = entry["pattern"]
            self.last_prompt = entry.get("prompt")
            return entry["pattern"]

    def update_pattern(self, pattern: dict, prompt: str | None = None) -> None:
        with self._lock:
            self.current_pattern = pattern
            if prompt:
                self.last_prompt = prompt
                self.pattern_history.append({
                    "prompt": prompt,
                    "pattern": pattern,
                    "timestamp": time.time(),
                })
                if len(self.pattern_history) > _HISTORY_MAX:
                    self.pattern_history.pop(0)
