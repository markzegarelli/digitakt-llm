# tests/test_fill_fsm.py
"""Tests for issue #20: FillFSM extracted from player.py."""
from __future__ import annotations

import pytest
from core.state import TRACK_NAMES


def make_pattern(val: int = 0) -> dict:
    return {track: [val] * 16 for track in TRACK_NAMES}


# ---------------------------------------------------------------------------
# FillFSM import and initial state
# ---------------------------------------------------------------------------

def test_fill_fsm_importable():
    from core.fill_fsm import FillFSM
    fsm = FillFSM()
    assert fsm is not None


def test_fill_fsm_initially_idle():
    from core.fill_fsm import FillFSM
    fsm = FillFSM()
    assert fsm.is_active is False


def test_fill_fsm_no_fill_queued_initially():
    from core.fill_fsm import FillFSM
    fsm = FillFSM()
    # advance with no fill queued → same pattern back, no fill event
    current = make_pattern(1)
    result_pattern, event = fsm.advance(current)
    assert result_pattern == current
    assert event is None


# ---------------------------------------------------------------------------
# queue() → fill starts on next advance
# ---------------------------------------------------------------------------

def test_fill_fsm_queue_then_advance_starts_fill():
    from core.fill_fsm import FillFSM
    fsm = FillFSM()
    current = make_pattern(1)
    fill = make_pattern(99)

    fsm.queue(fill)
    result_pattern, event = fsm.advance(current)

    assert result_pattern == fill
    assert event == "fill_started"
    assert fsm.is_active is True


# ---------------------------------------------------------------------------
# After fill starts, second advance ends fill and restores original pattern
# ---------------------------------------------------------------------------

def test_fill_fsm_second_advance_ends_fill():
    from core.fill_fsm import FillFSM
    fsm = FillFSM()
    current = make_pattern(1)
    fill = make_pattern(99)

    fsm.queue(fill)
    fsm.advance(current)               # starts fill, plays fill pattern
    result_pattern, event = fsm.advance(fill)  # ends fill, reverts

    assert result_pattern == current
    assert event == "fill_ended"
    assert fsm.is_active is False


# ---------------------------------------------------------------------------
# After fill ends, FSM returns to idle
# ---------------------------------------------------------------------------

def test_fill_fsm_returns_to_idle_after_fill():
    from core.fill_fsm import FillFSM
    fsm = FillFSM()
    current = make_pattern(1)
    fill = make_pattern(99)

    fsm.queue(fill)
    fsm.advance(current)
    fsm.advance(fill)

    # Next advance should be normal — no event
    result_pattern, event = fsm.advance(current)
    assert result_pattern == current
    assert event is None
    assert fsm.is_active is False


# ---------------------------------------------------------------------------
# AppState named write methods
# ---------------------------------------------------------------------------

def test_appstate_has_set_bpm():
    from core.state import AppState
    state = AppState()
    state.set_bpm(140.0)
    assert state.bpm == 140.0


def test_appstate_has_set_playing():
    from core.state import AppState
    state = AppState()
    state.set_playing(True)
    assert state.is_playing is True
    state.set_playing(False)
    assert state.is_playing is False


def test_appstate_has_set_pattern_length():
    from core.state import AppState
    state = AppState()
    state.set_pattern_length(32)
    assert state.pattern_length == 32


def test_appstate_has_update_pitch():
    from core.state import AppState
    state = AppState()
    state.update_pitch("kick", 48)
    assert state.track_pitch["kick"] == 48


def test_appstate_has_queue_pattern():
    from core.state import AppState
    state = AppState()
    pat = {k: [1] * 16 for k in TRACK_NAMES}
    state.queue_pattern(pat)
    assert state.pending_pattern == pat


def test_appstate_reset_clears_state():
    from core.state import AppState
    from core.midi_utils import CC_DEFAULTS
    state = AppState()
    state.set_bpm(160.0)
    state.last_prompt = "some prompt"

    empty_pat = {k: [0] * 16 for k in TRACK_NAMES}
    state.reset(empty_pat, 120.0, None)

    assert state.bpm == 120.0
    assert state.last_prompt is None
    assert state.pending_pattern == empty_pat
    for track in TRACK_NAMES:
        assert state.track_muted[track] is False
        assert state.track_cc[track] == CC_DEFAULTS
        assert state.track_velocity[track] == 127


# ---------------------------------------------------------------------------
# apply_bar_boundary()
# ---------------------------------------------------------------------------

def test_apply_bar_boundary_no_pending_returns_current():
    from core.state import AppState
    state = AppState()
    pat = {k: [1] * 16 for k in TRACK_NAMES}
    state.current_pattern = dict(pat)
    result = state.apply_bar_boundary()
    assert result["current_pattern"] == pat
    assert result["pattern_changed"] is False
    assert result["fill_event"] is None
    assert result["mute_changes"] is None


def test_apply_bar_boundary_swaps_pending_pattern():
    from core.state import AppState
    state = AppState()
    old = {k: [1] * 16 for k in TRACK_NAMES}
    new = {k: [2] * 16 for k in TRACK_NAMES}
    state.current_pattern = old
    state.pending_pattern = new

    result = state.apply_bar_boundary()

    assert result["pattern_changed"] is True
    assert result["current_pattern"] == new
    assert state.current_pattern == new
    assert state.pending_pattern is None


def test_apply_bar_boundary_applies_pending_mutes():
    from core.state import AppState
    state = AppState()
    state.current_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.queue_mute("kick", True)

    result = state.apply_bar_boundary()

    assert result["mute_changes"] == {"kick": True}
    assert state.track_muted["kick"] is True


def test_apply_bar_boundary_fill_started():
    from core.state import AppState
    state = AppState()
    current = {k: [1] * 16 for k in TRACK_NAMES}
    fill = {k: [99] * 16 for k in TRACK_NAMES}
    state.current_pattern = current
    state.queue_fill(fill)

    result = state.apply_bar_boundary()

    assert result["fill_event"] == "fill_started"
    assert result["current_pattern"] == fill
    assert state.current_pattern == fill


def test_apply_bar_boundary_fill_ended():
    from core.state import AppState
    state = AppState()
    original = {k: [1] * 16 for k in TRACK_NAMES}
    fill = {k: [99] * 16 for k in TRACK_NAMES}
    state.current_pattern = original
    state.queue_fill(fill)

    state.apply_bar_boundary()           # fill starts
    result = state.apply_bar_boundary()  # fill ends

    assert result["fill_event"] == "fill_ended"
    assert result["current_pattern"] == original
    assert state.current_pattern == original
