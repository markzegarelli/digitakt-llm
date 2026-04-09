import time
import threading
from unittest.mock import MagicMock
from core.state import AppState, TRACK_NAMES, DEFAULT_PATTERN
from core.events import EventBus
from core.player import Player


def _make_player() -> tuple[Player, AppState, EventBus, MagicMock]:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    port = MagicMock()
    player = Player(state, bus, port)
    return player, state, bus, port


def test_queue_pattern_sets_pending():
    player, state, _, _ = _make_player()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    player.queue_pattern(pattern)
    assert state.pending_pattern == pattern


def test_set_bpm_updates_state_and_emits():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("bpm_changed", lambda p: events.append(p))
    player.set_bpm(140.0)
    assert state.bpm == 140.0
    assert events == [{"bpm": 140.0}]


def test_start_sets_is_playing_and_emits():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("playback_started", lambda p: events.append(p))
    player.start()
    time.sleep(0.05)
    assert state.is_playing is True
    assert events == [{}]
    player.stop()


def test_stop_clears_is_playing_and_emits():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("playback_stopped", lambda p: events.append(p))
    player.start()
    time.sleep(0.05)
    player.stop()
    time.sleep(0.05)
    assert state.is_playing is False
    assert events == [{}]


def test_start_twice_does_not_start_second_thread():
    player, _, _, _ = _make_player()
    player.start()
    time.sleep(0.05)
    thread_before = player._thread
    player.start()
    assert player._thread is thread_before
    player.stop()


def test_pending_pattern_applied_after_loop():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("pattern_changed", lambda p: events.append(p))

    # Set BPM very high so the 16-step loop completes fast
    state.bpm = 9000.0
    player.start()

    new_pattern = {k: [127] * 16 for k in TRACK_NAMES}
    player.queue_pattern(new_pattern)

    # Wait long enough for at least one full loop at 9000 BPM
    # Step duration = 60/9000/4 ≈ 0.0017s; 16 steps ≈ 0.027s
    time.sleep(0.2)
    player.stop()

    assert state.current_pattern == new_pattern
    assert len(events) >= 1


def test_step_duration_formula():
    player, state, _, _ = _make_player()
    state.bpm = 120.0
    assert abs(player._step_duration() - 0.125) < 1e-9
    state.bpm = 60.0
    assert abs(player._step_duration() - 0.25) < 1e-9


def test_muted_track_does_not_send_midi():
    player, state, bus, port = _make_player()
    state.track_muted["kick"] = True
    player._play_step(0)   # step 0 — kick has velocity 100
    for call_args in port.send.call_args_list:
        msg = call_args[0][0]
        assert msg.note != 36, "Muted kick must not send MIDI"


def test_unmuted_track_still_sends_midi():
    player, state, bus, port = _make_player()
    state.track_muted["kick"] = False
    player._play_step(0)
    kick_sends = [c for c in port.send.call_args_list if c[0][0].note == 36]
    assert len(kick_sends) > 0, "Unmuted kick must send MIDI"
