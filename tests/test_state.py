# tests/test_state.py
import threading
import time
from core.state import AppState, DEFAULT_PATTERN, EMPTY_PATTERN, TRACK_NAMES


def test_initial_values():
    state = AppState()
    assert state.bpm == 120.0
    assert state.is_playing is False
    assert state.current_pattern == {}
    assert state.pending_pattern is None
    assert state.last_prompt is None
    assert state.pattern_history == []
    assert state.midi_port_name is None
    assert state.event_loop is None


def test_update_pattern_sets_current_and_history():
    state = AppState()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.update_pattern(pattern, prompt="heavy kick")
    assert state.current_pattern == pattern
    assert state.last_prompt == "heavy kick"
    assert len(state.pattern_history) == 1
    assert state.pattern_history[0]["prompt"] == "heavy kick"
    assert state.pattern_history[0]["pattern"] == pattern
    assert "timestamp" in state.pattern_history[0]


def test_update_pattern_caps_history_at_20():
    state = AppState()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    for i in range(25):
        state.update_pattern(pattern, prompt=f"prompt {i}")
    assert len(state.pattern_history) == 20
    assert state.pattern_history[0]["prompt"] == "prompt 5"
    assert state.pattern_history[-1]["prompt"] == "prompt 24"


def test_update_pattern_without_prompt_skips_history():
    state = AppState()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.update_pattern(pattern)
    assert state.current_pattern == pattern
    assert state.pattern_history == []
    assert state.last_prompt is None


def test_thread_safe_bpm_update():
    state = AppState()
    errors = []

    def writer():
        for _ in range(1000):
            try:
                state.bpm = 140.0
            except Exception as e:
                errors.append(e)

    threads = [threading.Thread(target=writer) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []


def test_default_pattern_has_all_tracks():
    assert set(DEFAULT_PATTERN.keys()) == set(TRACK_NAMES)
    for track in TRACK_NAMES:
        assert len(DEFAULT_PATTERN[track]) == 16
        assert all(isinstance(v, int) and 0 <= v <= 127 for v in DEFAULT_PATTERN[track])


def test_empty_pattern_is_all_zeros():
    for track in TRACK_NAMES:
        assert EMPTY_PATTERN[track] == [0] * 16, f"{track} should be all zeros"


def test_empty_pattern_has_all_tracks():
    assert set(EMPTY_PATTERN.keys()) == set(TRACK_NAMES)


def test_undo_pattern_returns_previous():
    state = AppState()
    pattern_a = {track: [1] * 16 for track in TRACK_NAMES}
    pattern_b = {track: [2] * 16 for track in TRACK_NAMES}
    state.update_pattern(pattern_a, prompt="first")
    state.update_pattern(pattern_b, prompt="second")
    result = state.undo_pattern()
    assert result is not None
    assert result["kick"] == [1] * 16
    assert state.last_prompt == "first"


def test_undo_pattern_returns_none_when_empty():
    state = AppState()
    result = state.undo_pattern()
    assert result is None


def test_undo_pattern_removes_entry_from_history():
    state = AppState()
    state.update_pattern({track: [1] * 16 for track in TRACK_NAMES}, prompt="first")
    state.undo_pattern()
    assert len(state.pattern_history) == 0


def test_initial_mute_state_all_unmuted():
    state = AppState()
    assert set(state.track_muted.keys()) == set(TRACK_NAMES)
    assert all(v is False for v in state.track_muted.values())


def test_update_mute_toggles_track():
    state = AppState()
    state.update_mute("kick", True)
    assert state.track_muted["kick"] is True
    state.update_mute("kick", False)
    assert state.track_muted["kick"] is False


def test_update_mute_thread_safety():
    state = AppState()
    errors = []

    def toggle(track, value):
        for _ in range(500):
            try:
                state.update_mute(track, value)
            except Exception as e:
                errors.append(e)

    threads = [
        threading.Thread(target=toggle, args=(track, i % 2 == 0))
        for i, track in enumerate(TRACK_NAMES * 5)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []


def test_queue_fill_sets_fill_pattern():
    state = AppState()
    fill = {k: [50] * 16 for k in TRACK_NAMES}
    state.queue_fill(fill)
    assert state.fill_pattern == fill


def test_queue_fill_from_chain_slot_success():
    from core.state import TRACK_NAMES

    state = AppState()
    p1 = {k: [1] * 16 for k in TRACK_NAMES}
    p2 = {k: [2] * 16 for k in TRACK_NAMES}
    state.set_chain(["a", "b"], [p1, p2], auto=False)
    state.chain_index = 0
    out = state.queue_fill_from_chain_slot(2)
    assert out["ok"] is True
    assert out["slot"] == 2
    assert out["pattern_name"] == "b"
    assert state.fill_pattern is not None
    assert state.chain_index == 0


def test_queue_fill_from_chain_slot_errors():
    from core.state import TRACK_NAMES

    state = AppState()
    assert state.queue_fill_from_chain_slot(1)["code"] == "no_chain"

    p1 = {k: [1] * 16 for k in TRACK_NAMES}
    state.set_chain(["a"], [p1], auto=False)
    assert state.queue_fill_from_chain_slot(0)["code"] == "bad_slot"
    assert state.queue_fill_from_chain_slot(2)["code"] == "bad_slot"

    state.queue_fill({k: [9] * 16 for k in TRACK_NAMES})
    state.apply_bar_boundary()
    assert state.is_fill_active() is True
    assert state.queue_fill_from_chain_slot(1)["code"] == "fill_active"


def test_track_pitch_defaults_to_60():
    state = AppState()
    for track in TRACK_NAMES:
        assert state.track_pitch[track] == 60


# ── Queue mutes (bar-synced) ───────────────────────────────────────────

def test_queue_mute_does_not_apply_immediately():
    state = AppState()
    state.queue_mute("kick", True)
    assert state.track_muted["kick"] is False  # not applied yet
    assert state.pending_mutes == {"kick": True}


def test_apply_pending_mutes_applies_and_clears():
    state = AppState()
    state.queue_mute("kick", True)
    state.queue_mute("snare", True)
    changes = state.apply_pending_mutes()
    assert changes == {"kick": True, "snare": True}
    assert state.track_muted["kick"] is True
    assert state.track_muted["snare"] is True
    assert state.pending_mutes == {}


def test_apply_pending_mutes_returns_none_when_empty():
    state = AppState()
    assert state.apply_pending_mutes() is None


def test_queue_mute_overwrites_previous():
    state = AppState()
    state.queue_mute("kick", True)
    state.queue_mute("kick", False)
    changes = state.apply_pending_mutes()
    assert changes == {"kick": False}
    assert state.track_muted["kick"] is False
