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


def test_loop_respects_pattern_length_8():
    player, state, bus, _ = _make_player()
    state.bpm = 9000.0
    state.pattern_length = 8
    state.current_pattern = {k: [64] * 8 for k in TRACK_NAMES}
    steps_seen = []
    bus.subscribe("step_changed", lambda p: steps_seen.append(p["step"]))
    player.start()
    time.sleep(0.05)
    player.stop()
    assert steps_seen, "No steps emitted"
    assert all(s < 8 for s in steps_seen)


def test_loop_respects_pattern_length_32():
    player, state, bus, _ = _make_player()
    state.bpm = 9000.0
    state.pattern_length = 32
    state.current_pattern = {k: [64] * 32 for k in TRACK_NAMES}
    steps_seen = []
    bus.subscribe("step_changed", lambda p: steps_seen.append(p["step"]))
    player.start()
    time.sleep(0.05)
    player.stop()
    assert any(s >= 16 for s in steps_seen), "No steps > 15 seen for 32-step pattern"
    assert all(s < 32 for s in steps_seen)


def test_gate_under_100_sends_note_off():
    """A step with gate < 100 should trigger a note_off after a delay."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0

    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    pattern["gate"] = {k: [100] * 16 for k in TRACK_NAMES}
    pattern["gate"]["kick"][0] = 50
    state.current_pattern = pattern

    player.start()
    time.sleep(0.15)
    player.stop()
    time.sleep(0.05)  # let any pending Timers fire

    # note_off is sent as note_on with velocity=0 on kick channel (ch 0)
    kick_note_offs = [
        c for c in port.send.call_args_list
        if hasattr(c[0][0], "type")
        and c[0][0].type == "note_on"
        and c[0][0].channel == 0
        and c[0][0].velocity == 0
    ]
    assert kick_note_offs, "Expected a note_off (velocity=0) for kick with gate=50"


def test_gate_100_does_not_send_note_off():
    """Default gate=100 should not send any note_off (preserves original behavior)."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    state.current_pattern = pattern  # no gate key = default 100

    player.start()
    time.sleep(0.15)
    player.stop()
    time.sleep(0.05)

    # No note_on with velocity=0 should appear on kick channel
    kick_note_offs = [
        c for c in port.send.call_args_list
        if hasattr(c[0][0], "type")
        and c[0][0].type == "note_on"
        and c[0][0].channel == 0
        and c[0][0].velocity == 0
    ]
    assert not kick_note_offs, "Unexpected note_off found for kick with gate=100"


def test_fill_plays_once_then_reverts():
    player, state, bus, _ = _make_player()
    state.bpm = 9000.0
    original = {k: [10] * 16 for k in TRACK_NAMES}
    fill_pat = {k: [99] * 16 for k in TRACK_NAMES}
    state.current_pattern = dict(original)

    fill_events = []
    bus.subscribe("fill_started", lambda p: fill_events.append("started"))
    bus.subscribe("fill_ended", lambda p: fill_events.append("ended"))

    player.start()
    time.sleep(0.05)
    state.queue_fill(fill_pat)
    time.sleep(0.3)  # wait for fill loop + revert at 9000 BPM
    player.stop()

    assert "started" in fill_events
    assert "ended" in fill_events
    assert state.current_pattern[TRACK_NAMES[0]][0] == 10  # reverted


def test_player_uses_track_pitch():
    """When track_pitch[kick] = 48, the note sent for kick should be 48."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0
    state.track_pitch["kick"] = 48
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    state.current_pattern = pattern

    player.start()
    time.sleep(0.1)
    player.stop()

    found = False
    for c in port.send.call_args_list:
        msg = c[0][0]
        if hasattr(msg, "type") and msg.type == "note_on" and msg.channel == 0 and msg.note == 48 and msg.velocity > 0:
            found = True
            break
    assert found, "Expected note_on with pitch 48 for kick"


def test_condition_1_2_fires_on_even_loops():
    """A step with condition '1:2' should fire on loop 0, 2, 4 but not 1, 3."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    pattern["cond"] = {k: [None] * 16 for k in TRACK_NAMES}
    pattern["cond"]["kick"][0] = "1:2"
    state.current_pattern = pattern

    player.start()
    time.sleep(0.3)
    player.stop()

    kick_note_ons = [
        c for c in port.send.call_args_list
        if hasattr(c[0][0], "type")
        and c[0][0].type == "note_on"
        and c[0][0].channel == 0
        and c[0][0].velocity > 0
    ]
    # At 9000 BPM, ~11 loops in 0.3s; 1:2 fires on even loops only (~half)
    total_loops_approx = 12  # generous upper bound
    assert len(kick_note_ons) <= total_loops_approx // 2 + 1, \
        f"1:2 condition fired too often: {len(kick_note_ons)} times in ~{total_loops_approx} loops"
