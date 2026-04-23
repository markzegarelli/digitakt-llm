# core/mutator.py
from __future__ import annotations

from typing import Callable, Literal

from core.events import EventBus
from core.state import AppState, TRACK_NAMES
from core.euclidean import normalize_euclid_in_pattern


class PatternMutator:
    """Single write path for all pattern mutations.

    apply() guarantees:
    - fn() receives the current pattern (read once)
    - result written back to state.current_pattern
    - player.queue_pattern() called exactly once (mode="queue")
    - optional event emitted via bus
    """

    def __init__(self, state: AppState, player, bus: EventBus) -> None:
        self._state = state
        self._player = player
        self._bus = bus

    def apply(
        self,
        fn: Callable[[dict], dict],
        *,
        event: str | None = None,
        payload: dict | None = None,
        mode: Literal["queue", "immediate", "none"] = "queue",
    ) -> dict:
        new_pattern = fn(self._state.current_pattern)
        self._state.current_pattern = new_pattern
        normalize_euclid_in_pattern(
            self._state.current_pattern,
            self._state.pattern_length,
            tuple(TRACK_NAMES),
        )
        if mode == "queue":
            self._player.queue_pattern(new_pattern)
        if event is not None:
            self._bus.emit(event, payload or {})
        return new_pattern
