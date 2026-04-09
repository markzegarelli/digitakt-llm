# tests/test_state.py
import threading
import time
from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES


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
