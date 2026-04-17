# core/state.py
from __future__ import annotations

import asyncio
import copy
import threading
import time
from dataclasses import dataclass, field

from core.midi_utils import CC_DEFAULTS as _DEFAULT_CC_PARAMS
from core.fill_fsm import FillFSM

TRACK_NAMES = ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]

# Default per-step gate (% of step duration before note_off). 100 = full step (no explicit off).
DEFAULT_GATE_PCT = 50

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



@dataclass
class AppState:
    current_pattern: dict = field(default_factory=dict)
    pending_pattern: dict | None = None
    chain: list[str] = field(default_factory=list)
    chain_patterns: list[dict] = field(default_factory=list, repr=False)
    chain_index: int = -1
    chain_auto: bool = False
    chain_queued_index: int | None = None
    chain_queued_pattern: dict | None = field(default=None, repr=False)
    chain_armed: bool = False
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
    track_pitch: dict = field(default_factory=lambda: {
        track: 60 for track in TRACK_NAMES
    })
    pattern_length: int = 16
    fill_pattern: dict | None = None
    pending_mutes: dict[str, bool] = field(default_factory=dict)
    _fill_active: bool = field(default=False, init=False, repr=False)
    _pre_fill_pattern: dict | None = field(default=None, init=False, repr=False)
    _lock: threading.Lock = field(
        default_factory=threading.Lock, init=False, repr=False
    )
    _fill_fsm: FillFSM = field(
        default_factory=FillFSM, init=False, repr=False
    )

    def queue_fill(self, pattern: dict) -> None:
        with self._lock:
            self.fill_pattern = pattern  # legacy field kept for compat
            self._fill_fsm.queue(pattern)

    def update_cc(self, track: str, param: str, value: int) -> None:
        with self._lock:
            self.track_cc[track][param] = value

    def update_velocity(self, track: str, value: int) -> None:
        with self._lock:
            self.track_velocity[track] = value

    def update_mute(self, track: str, muted: bool) -> None:
        with self._lock:
            self.track_muted[track] = muted

    def queue_mute(self, track: str, muted: bool) -> None:
        """Queue a mute change to be applied at the next bar boundary."""
        with self._lock:
            self.pending_mutes[track] = muted

    def apply_pending_mutes(self) -> dict[str, bool] | None:
        """Apply queued mute changes. Returns the changes dict or None."""
        with self._lock:
            if not self.pending_mutes:
                return None
            changes = dict(self.pending_mutes)
            for track, muted in changes.items():
                self.track_muted[track] = muted
            self.pending_mutes.clear()
            return changes

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

    # ── Named write methods (thread-safe setters) ─────────────────────────

    def set_bpm(self, bpm: float) -> None:
        with self._lock:
            self.bpm = bpm

    def set_playing(self, playing: bool) -> None:
        with self._lock:
            self.is_playing = playing

    def set_pattern_length(self, steps: int) -> None:
        with self._lock:
            self.pattern_length = steps

    def set_last_prompt(self, prompt: str | None) -> None:
        with self._lock:
            self.last_prompt = prompt

    def is_fill_active(self) -> bool:
        with self._lock:
            return self._fill_active

    def normalize_pattern_length(self, pattern: dict, steps: int | None = None) -> dict:
        """Resize all step-indexed pattern structures to match the target length."""
        target_steps = self.pattern_length if steps is None else steps
        result = copy.deepcopy(pattern)

        for track in TRACK_NAMES:
            cur = list(result.get(track, []))
            if len(cur) < target_steps:
                cur.extend([0] * (target_steps - len(cur)))
            else:
                cur = cur[:target_steps]
            result[track] = cur

        if "prob" in result and isinstance(result["prob"], dict):
            result["prob"] = {
                track: (list(vals) + [100] * max(0, target_steps - len(vals)))[:target_steps]
                for track, vals in result["prob"].items()
                if isinstance(vals, list)
            }

        if "gate" in result and isinstance(result["gate"], dict):
            result["gate"] = {
                track: (list(vals) + [DEFAULT_GATE_PCT] * max(0, target_steps - len(vals)))[:target_steps]
                for track, vals in result["gate"].items()
                if isinstance(vals, list)
            }

        if "cond" in result and isinstance(result["cond"], dict):
            result["cond"] = {
                track: (list(vals) + [None] * max(0, target_steps - len(vals)))[:target_steps]
                for track, vals in result["cond"].items()
                if isinstance(vals, list)
            }

        if "step_cc" in result and isinstance(result["step_cc"], dict):
            new_step_cc: dict[str, dict[str, list]] = {}
            for track, param_map in result["step_cc"].items():
                if not isinstance(param_map, dict):
                    continue
                new_step_cc[track] = {}
                for param, vals in param_map.items():
                    if not isinstance(vals, list):
                        continue
                    new_step_cc[track][param] = (
                        list(vals) + [None] * max(0, target_steps - len(vals))
                    )[:target_steps]
            result["step_cc"] = new_step_cc

        return result

    def update_pitch(self, track: str, value: int) -> None:
        with self._lock:
            self.track_pitch[track] = value

    def queue_pattern(self, pattern: dict) -> None:
        with self._lock:
            self.pending_pattern = pattern

    def replace_current_pattern(self, pattern: dict) -> None:
        """Set the live pattern and clear pending swap (e.g. GET /patterns/{name} while stopped)."""
        with self._lock:
            self.current_pattern = pattern
            self.pending_pattern = None

    def reset(self, pattern: dict, bpm: float, prompt: str | None) -> None:
        """Atomic bulk reset (used by /new)."""
        with self._lock:
            self.pending_pattern = copy.deepcopy(pattern)
            self.bpm = bpm
            self.last_prompt = prompt
            for track in TRACK_NAMES:
                self.track_muted[track] = False
                self.track_cc[track] = dict(_DEFAULT_CC_PARAMS)
                self.track_velocity[track] = 127
            self.pending_mutes.clear()
            self._fill_fsm = FillFSM()
            self.chain.clear()
            self.chain_patterns.clear()
            self.chain_index = -1
            self.chain_auto = False
            self.chain_queued_index = None
            self.chain_queued_pattern = None
            self.chain_armed = False

    # ── Chain helpers ───────────────────────────────────────────────────────

    def set_chain(self, names: list[str], patterns: list[dict], auto: bool = False) -> None:
        with self._lock:
            self.chain = list(names)
            self.chain_patterns = [copy.deepcopy(p) for p in patterns]
            self.chain_auto = auto
            self.chain_index = -1
            self.chain_queued_index = None
            self.chain_queued_pattern = None
            self.chain_armed = False

    def clear_chain(self) -> None:
        with self._lock:
            self.chain.clear()
            self.chain_patterns.clear()
            self.chain_index = -1
            self.chain_auto = False
            self.chain_queued_index = None
            self.chain_queued_pattern = None
            self.chain_armed = False

    def queue_next_chain_candidate(self) -> int | None:
        with self._lock:
            if not self.chain_patterns:
                return None
            anchor = self.chain_queued_index if self.chain_queued_index is not None else self.chain_index
            next_index = 0 if anchor < 0 else (anchor + 1) % len(self.chain_patterns)
            self.chain_queued_index = next_index
            self.chain_queued_pattern = copy.deepcopy(self.chain_patterns[next_index])
            return next_index

    def arm_chain_candidate(self) -> int | None:
        with self._lock:
            if not self.chain_patterns:
                return None
            if self.chain_queued_index is None:
                anchor = self.chain_index
                next_index = 0 if anchor < 0 else (anchor + 1) % len(self.chain_patterns)
                self.chain_queued_index = next_index
                self.chain_queued_pattern = copy.deepcopy(self.chain_patterns[next_index])
            if self.chain_queued_pattern is None:
                return None
            self.pending_pattern = copy.deepcopy(self.chain_queued_pattern)
            self.chain_armed = True
            return self.chain_queued_index

    def _prepare_auto_chain(self) -> dict | None:
        if not self.chain_auto or not self.chain_patterns or self.pending_pattern is not None:
            return None
        next_index = 0 if self.chain_index < 0 else (self.chain_index + 1) % len(self.chain_patterns)
        self.chain_queued_index = next_index
        self.chain_queued_pattern = copy.deepcopy(self.chain_patterns[next_index])
        self.pending_pattern = copy.deepcopy(self.chain_queued_pattern)
        self.chain_armed = True
        return {
            "chain": list(self.chain),
            "chain_index": self.chain_index,
            "chain_queued_index": self.chain_queued_index,
            "chain_auto": self.chain_auto,
        }

    def _finalize_chain_advance_if_needed(self) -> dict | None:
        if not self.chain_armed or self.chain_queued_index is None:
            return None
        self.chain_index = self.chain_queued_index
        self.chain_queued_index = None
        self.chain_queued_pattern = None
        self.chain_armed = False
        return {
            "chain": list(self.chain),
            "chain_index": self.chain_index,
            "chain_queued_index": self.chain_queued_index,
            "chain_auto": self.chain_auto,
            "chain_armed": self.chain_armed,
        }

    # ── Bar-boundary logic (called only by the player loop) ───────────────

    def apply_bar_boundary(self) -> dict:
        """Apply all bar-boundary effects and return a side-effects dict.

        Returns:
            {
                "mute_changes":    dict | None,
                "pattern_changed": bool,
                "fill_event":      "fill_started" | "fill_ended" | None,
                "chain_armed":     dict | None,
                "chain_advanced":  dict | None,
                "current_pattern": dict,
            }
        """
        with self._lock:
            mute_changes: dict[str, bool] | None = None
            if self.pending_mutes:
                mute_changes = dict(self.pending_mutes)
                for track, muted in mute_changes.items():
                    self.track_muted[track] = muted
                self.pending_mutes.clear()

            chain_armed = self._prepare_auto_chain()

            pattern_changed = False
            if self.pending_pattern is not None:
                self.current_pattern = self.pending_pattern
                self.pending_pattern = None
                pattern_changed = True

            if pattern_changed:
                chain_advanced = self._finalize_chain_advance_if_needed()
            else:
                chain_advanced = None

            # FillFSM is advanced only by the player loop at bar boundaries.
            next_pattern, fill_event = self._fill_fsm.advance(self.current_pattern)
            if fill_event is not None:
                self.current_pattern = next_pattern
                if fill_event == "fill_started":
                    self.fill_pattern = None
                    self._fill_active = True
                elif fill_event == "fill_ended":
                    self._fill_active = False
                    self._pre_fill_pattern = None

            return {
                "mute_changes": mute_changes,
                "pattern_changed": pattern_changed,
                "fill_event": fill_event,
                "chain_armed": chain_armed,
                "chain_advanced": chain_advanced,
                "current_pattern": self.current_pattern,
            }
