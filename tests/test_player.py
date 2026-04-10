import time
import threading
from unittest.mock import MagicMock, patch
from core.state import AppState, TRACK_NAMES, DEFAULT_PATTERN
from core.events import EventBus
from core.player import Player
from core import midi_utils


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
    kick_channel = midi_utils.TRACK_CHANNELS["kick"]
    kick_sends = [
        c for c in port.send.call_args_list
        if hasattr(c[0][0], "channel") and c[0][0].channel == kick_channel
        and c[0][0].type == "note_on"
    ]
    assert len(kick_sends) == 0, "Muted kick must not send MIDI"


def test_unmuted_track_still_sends_midi():
    player, state, bus, port = _make_player()
    state.track_muted["kick"] = False
    player._play_step(0)
    kick_channel = midi_utils.TRACK_CHANNELS["kick"]
    kick_sends = [
        c for c in port.send.call_args_list
        if hasattr(c[0][0], "channel") and c[0][0].channel == kick_channel
        and c[0][0].type == "note_on"
    ]
    assert len(kick_sends) > 0, "Unmuted kick must send MIDI"


def test_start_sends_midi_start():
    player, state, bus, port = _make_player()
    player.start()
    player.stop()
    sent_types = [c[0][0].type for c in port.send.call_args_list]
    assert "start" in sent_types
    # start message must be the very first send call
    assert port.send.call_args_list[0][0][0].type == "start"


def test_stop_sends_midi_stop():
    player, state, bus, port = _make_player()
    player.start()
    player.stop()
    sent_types = [c[0][0].type for c in port.send.call_args_list]
    assert "stop" in sent_types


def test_clock_ticks_sent_during_playback():
    """96 clock ticks per full 16-step loop (6 ticks × 16 steps)."""
    player, state, bus, port = _make_player()
    player.set_bpm(9000)
    player.start()
    time.sleep(0.05)  # enough for ~1.8 loops at 9000 BPM
    player.stop()

    clock_calls = [
        c for c in port.send.call_args_list
        if c[0][0].type == "clock"
    ]
    assert len(clock_calls) >= 96  # at least one full loop


def _kick_note_ons(port):
    """Return note_on calls for the kick track (channel 0)."""
    kick_channel = midi_utils.TRACK_CHANNELS["kick"]
    return [
        c for c in port.send.call_args_list
        if c[0][0].type == "note_on" and c[0][0].channel == kick_channel
    ]


def test_step_with_100_prob_always_fires():
    player, state, bus, port = _make_player()
    state.current_pattern["prob"] = {"kick": [100] * 16}
    with patch("random.random", return_value=0.0):
        player._play_step(0)
    assert len(_kick_note_ons(port)) == 1


def test_step_with_0_prob_never_fires():
    player, state, bus, port = _make_player()
    state.current_pattern["prob"] = {"kick": [0] * 16}
    player._play_step(0)
    assert len(_kick_note_ons(port)) == 0


def test_step_fires_when_random_below_prob():
    player, state, bus, port = _make_player()
    state.current_pattern["prob"] = {"kick": [75] * 16}
    with patch("random.random", return_value=0.74):  # 0.74 * 100 = 74 < 75 → fires
        player._play_step(0)
    assert len(_kick_note_ons(port)) == 1


def test_step_skipped_when_random_at_or_above_prob():
    player, state, bus, port = _make_player()
    state.current_pattern["prob"] = {"kick": [75] * 16}
    with patch("random.random", return_value=0.75):  # 0.75 * 100 = 75 >= 75 → skipped
        player._play_step(0)
    assert len(_kick_note_ons(port)) == 0


def test_missing_prob_key_fires_normally():
    player, state, bus, port = _make_player()
    # No prob key in pattern — kick step 0 = 100, should fire
    player._play_step(0)
    assert len(_kick_note_ons(port)) == 1


def test_swing_delay_returns_positive_when_swing_set():
    player, state, bus, port = _make_player()
    state.current_pattern["swing"] = 100  # max swing
    delay = player._swing_delay()
    assert delay > 0


def test_no_swing_delay_when_swing_is_zero():
    player, state, bus, port = _make_player()
    state.current_pattern["swing"] = 0
    delay = player._swing_delay()
    assert delay == 0.0


def test_no_swing_delay_when_swing_absent():
    player, state, bus, port = _make_player()
    # No swing key in pattern
    delay = player._swing_delay()
    assert delay == 0.0


def test_swing_delay_scales_with_bpm():
    player, state, bus, port = _make_player()
    state.current_pattern["swing"] = 50
    state.bpm = 120.0
    delay_120 = player._swing_delay()
    state.bpm = 240.0
    delay_240 = player._swing_delay()
    # At double BPM, delay should halve
    assert abs(delay_120 - delay_240 * 2) < 1e-9
