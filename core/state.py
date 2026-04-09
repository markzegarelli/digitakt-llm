# core/state.py
import asyncio
import threading
import time
from dataclasses import dataclass, field

TRACK_NAMES = ["kick", "snare", "hihat", "clap", "perc1", "perc2", "perc3", "perc4"]

DEFAULT_PATTERN: dict = {
    "kick":  [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
    "snare": [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
    "hihat": [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
    "clap":  [0] * 16,
    "perc1": [0] * 16,
    "perc2": [0] * 16,
    "perc3": [0] * 16,
    "perc4": [0] * 16,
}

_HISTORY_MAX = 20


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
    _lock: threading.Lock = field(
        default_factory=threading.Lock, init=False, repr=False
    )

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
