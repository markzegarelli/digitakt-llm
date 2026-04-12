# core/fill_fsm.py
from __future__ import annotations

from enum import Enum, auto


class _FillState(Enum):
    IDLE = auto()
    ACTIVE = auto()


class FillFSM:
    """Pure state machine for one-shot fill patterns.

    Transitions:
      IDLE  → queue() → IDLE (pending)
      IDLE  → advance(current) [if fill queued] → ACTIVE, returns (fill, "fill_started")
      ACTIVE → advance(fill)                     → IDLE,   returns (original, "fill_ended")
      IDLE  → advance(current) [no fill queued]  → IDLE,   returns (current, None)
    """

    def __init__(self) -> None:
        self._state = _FillState.IDLE
        self._queued: dict | None = None
        self._pre_fill: dict | None = None

    @property
    def is_active(self) -> bool:
        return self._state == _FillState.ACTIVE

    def queue(self, pattern: dict) -> None:
        """Queue a fill pattern to begin on the next advance() call."""
        self._queued = pattern

    def advance(self, current_pattern: dict) -> tuple[dict, str | None]:
        """Called once per bar boundary.

        Returns (next_pattern, event_name_or_None).
        """
        if self._state == _FillState.ACTIVE:
            # End fill: restore pre-fill pattern
            restored = self._pre_fill
            self._pre_fill = None
            self._state = _FillState.IDLE
            return restored, "fill_ended"

        if self._queued is not None:
            # Begin fill
            self._pre_fill = current_pattern
            fill = self._queued
            self._queued = None
            self._state = _FillState.ACTIVE
            return fill, "fill_started"

        return current_pattern, None
