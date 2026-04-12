# tests/test_mutator.py
"""Tests for issue #21: PatternMutator unifying all pattern mutation paths."""
from __future__ import annotations

from unittest.mock import MagicMock, patch
from core.state import AppState, TRACK_NAMES
from core.events import EventBus


def _make_mutator(pattern_length: int = 16):
    state = AppState()
    state.current_pattern = {k: [0] * pattern_length for k in TRACK_NAMES}
    state.pattern_length = pattern_length
    bus = EventBus()
    player = MagicMock()
    player.queue_pattern = MagicMock()

    from core.mutator import PatternMutator
    mutator = PatternMutator(state, player, bus)
    return mutator, state, player, bus


# ---------------------------------------------------------------------------
# PatternMutator importable
# ---------------------------------------------------------------------------

def test_pattern_mutator_importable():
    from core.mutator import PatternMutator
    assert PatternMutator is not None


# ---------------------------------------------------------------------------
# apply() — mode="queue" (default)
# ---------------------------------------------------------------------------

def test_mutator_apply_updates_current_pattern():
    mutator, state, player, bus = _make_mutator()
    mutator.apply(lambda p: {**p, "kick": [1] * 16})
    assert state.current_pattern["kick"] == [1] * 16


def test_mutator_apply_queues_pattern_on_player():
    mutator, state, player, bus = _make_mutator()
    mutator.apply(lambda p: {**p, "snare": [5] * 16})
    player.queue_pattern.assert_called_once()
    queued = player.queue_pattern.call_args[0][0]
    assert queued["snare"] == [5] * 16


def test_mutator_apply_queues_pattern_exactly_once():
    """No double-write: queue_pattern called once, not twice."""
    mutator, state, player, bus = _make_mutator()
    mutator.apply(lambda p: p)
    assert player.queue_pattern.call_count == 1


def test_mutator_apply_emits_event_when_provided():
    mutator, state, player, bus = _make_mutator()
    events = []
    bus.subscribe("prob_changed", events.append)
    mutator.apply(lambda p: p, event="prob_changed", payload={"track": "kick", "step": 1, "value": 50})
    assert len(events) == 1
    assert events[0] == {"track": "kick", "step": 1, "value": 50}


def test_mutator_apply_no_event_when_not_provided():
    mutator, state, player, bus = _make_mutator()
    events = []
    bus.subscribe("prob_changed", events.append)
    mutator.apply(lambda p: p)
    assert events == []


# ---------------------------------------------------------------------------
# apply() — mode="immediate"
# ---------------------------------------------------------------------------

def test_mutator_apply_immediate_updates_pattern_without_queue():
    mutator, state, player, bus = _make_mutator()
    mutator.apply(lambda p: {**p, "kick": [7] * 16}, mode="immediate")
    assert state.current_pattern["kick"] == [7] * 16
    player.queue_pattern.assert_not_called()


# ---------------------------------------------------------------------------
# apply() — mode="none"
# ---------------------------------------------------------------------------

def test_mutator_apply_none_mode_updates_without_queue():
    mutator, state, player, bus = _make_mutator()
    mutator.apply(lambda p: {**p, "tom": [3] * 16}, mode="none")
    assert state.current_pattern["tom"] == [3] * 16
    player.queue_pattern.assert_not_called()


# ---------------------------------------------------------------------------
# Mutation function receives current_pattern as input (read under lock)
# ---------------------------------------------------------------------------

def test_mutator_fn_receives_current_pattern():
    mutator, state, player, bus = _make_mutator()
    state.current_pattern = {k: [42] * 16 for k in TRACK_NAMES}
    received = []
    def capture(p):
        received.append(dict(p))
        return p
    mutator.apply(capture)
    assert received[0]["kick"] == [42] * 16


# ---------------------------------------------------------------------------
# apply() returns the new pattern
# ---------------------------------------------------------------------------

def test_mutator_apply_returns_new_pattern():
    mutator, state, player, bus = _make_mutator()
    new_pat = {k: [9] * 16 for k in TRACK_NAMES}
    result = mutator.apply(lambda p: new_pat)
    assert result == new_pat


# ---------------------------------------------------------------------------
# apply() with 8-step and 32-step patterns
# ---------------------------------------------------------------------------

def test_mutator_apply_8_step_pattern():
    mutator, state, player, bus = _make_mutator(pattern_length=8)
    mutator.apply(lambda p: {**p, "kick": [1] * 8})
    assert state.current_pattern["kick"] == [1] * 8
    player.queue_pattern.assert_called_once()


def test_mutator_apply_32_step_pattern():
    mutator, state, player, bus = _make_mutator(pattern_length=32)
    mutator.apply(lambda p: {**p, "snare": [2] * 32})
    assert state.current_pattern["snare"] == [2] * 32
    player.queue_pattern.assert_called_once()
