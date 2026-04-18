from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

from core.state import AppState
from core.events import EventBus
from core.midi_input import MidiInputListener
from core.midi_utils import CC_NUMBER_TO_PARAM, CHANNEL_TO_TRACK


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_listener(messages: list) -> tuple[MidiInputListener, AppState, EventBus, MagicMock]:
    state = AppState()
    bus = EventBus()
    port = MagicMock()
    port.poll.side_effect = messages + [None] * 1000
    listener = MidiInputListener(port, state, bus)
    return listener, state, bus, port


def _cc(channel: int, control: int, value: int) -> MagicMock:
    msg = MagicMock()
    msg.type = "control_change"
    msg.channel = channel
    msg.control = control
    msg.value = value
    return msg


def _non_cc(msg_type: str = "clock") -> MagicMock:
    msg = MagicMock()
    msg.type = msg_type
    return msg


# ── _handle: valid CC ────────────────────────────────────────────────────────

def test_handle_known_cc_updates_state():
    listener, state, bus, _ = _make_listener([])
    listener._handle(_cc(channel=0, control=74, value=80))  # kick / filter
    assert state.track_cc["kick"]["filter"] == 80


def test_handle_known_cc_emits_cc_changed():
    listener, state, bus, _ = _make_listener([])
    events = []
    bus.subscribe("cc_changed", events.append)
    listener._handle(_cc(channel=1, control=75, value=64))  # snare / resonance
    assert len(events) == 1
    assert events[0] == {"track": "snare", "param": "resonance", "value": 64, "source": "hardware"}


def test_handle_all_mapped_params_accepted():
    from core.midi_utils import CC_MAP
    listener, state, bus, _ = _make_listener([])
    events = []
    bus.subscribe("cc_changed", events.append)
    for param, cc_num in CC_MAP.items():
        listener._handle(_cc(channel=0, control=cc_num, value=50))
        state.update_cc("kick", param, 0)  # reset to allow next message through
    assert len(events) == len(CC_MAP)


# ── _handle: ignored messages ────────────────────────────────────────────────

def test_handle_unknown_channel_routes_to_focused_track():
    """CC on an unmapped channel (Digitakt auto channel) applies to the focused track."""
    listener, state, bus, _ = _make_listener([])
    state.set_cc_focused_track("snare")
    events = []
    bus.subscribe("cc_changed", events.append)
    listener._handle(_cc(channel=8, control=74, value=100))
    assert len(events) == 1
    assert events[0]["track"] == "snare"
    assert events[0]["param"] == "filter"
    assert events[0]["value"] == 100


def test_handle_unknown_cc_number_ignored():
    listener, state, bus, _ = _make_listener([])
    events = []
    bus.subscribe("cc_changed", events.append)
    listener._handle(_cc(channel=0, control=99, value=100))
    assert events == []


def test_handle_non_cc_messages_ignored():
    listener, state, bus, _ = _make_listener([])
    events = []
    bus.subscribe("cc_changed", events.append)
    listener._handle(_non_cc("clock"))
    listener._handle(_non_cc("note_on"))
    assert events == []


# ── _handle: echo suppression ────────────────────────────────────────────────

def test_handle_duplicate_value_suppressed():
    listener, state, bus, _ = _make_listener([])
    state.update_cc("kick", "filter", 80)  # pre-set to match incoming
    events = []
    bus.subscribe("cc_changed", events.append)
    listener._handle(_cc(channel=0, control=74, value=80))
    assert events == []


def test_handle_different_value_not_suppressed():
    listener, state, bus, _ = _make_listener([])
    state.update_cc("kick", "filter", 80)
    events = []
    bus.subscribe("cc_changed", events.append)
    listener._handle(_cc(channel=0, control=74, value=81))
    assert len(events) == 1
    assert events[0]["value"] == 81


# ── Thread lifecycle ─────────────────────────────────────────────────────────

def test_start_spawns_daemon_thread():
    listener, _, _, port = _make_listener([])
    port.poll.return_value = None
    listener.start()
    time.sleep(0.02)
    assert listener._thread is not None
    assert listener._thread.is_alive()
    assert listener._thread.daemon is True
    listener.stop()


def test_stop_terminates_thread():
    listener, _, _, port = _make_listener([])
    port.poll.return_value = None
    listener.start()
    time.sleep(0.02)
    listener.stop()
    listener._thread.join(timeout=0.5)
    assert not listener._thread.is_alive()


def test_start_twice_does_not_spawn_second_thread():
    listener, _, _, port = _make_listener([])
    port.poll.return_value = None
    listener.start()
    time.sleep(0.02)
    t1 = listener._thread
    listener.start()
    assert listener._thread is t1
    listener.stop()


def test_messages_processed_in_background():
    msg = _cc(channel=0, control=74, value=90)
    listener, state, bus, _ = _make_listener([msg])
    events = []
    bus.subscribe("cc_changed", events.append)
    listener.start()
    time.sleep(0.1)
    listener.stop()
    assert len(events) >= 1
    assert events[0]["value"] == 90


def test_port_exception_stops_loop():
    listener, _, _, port = _make_listener([])
    port.poll.side_effect = IOError("port closed")
    listener.start()
    time.sleep(0.1)
    assert not listener._thread.is_alive()


# ── Reverse lookup correctness ───────────────────────────────────────────────

def test_all_track_channels_covered():
    from core.midi_utils import TRACK_CHANNELS
    for track, ch in TRACK_CHANNELS.items():
        assert CHANNEL_TO_TRACK[ch] == track


def test_all_cc_numbers_covered():
    from core.midi_utils import CC_MAP
    for param, cc_num in CC_MAP.items():
        assert CC_NUMBER_TO_PARAM[cc_num] == param


# ── tui_launcher wiring ───────────────────────────────────────────────────────

def test_launcher_starts_listener_when_input_port_found():
    mock_input_port = MagicMock()
    mock_input_port.poll.return_value = None

    with (
        patch("core.midi_utils.list_ports", return_value=["Digitakt"]),
        patch("core.midi_utils.open_port", return_value=MagicMock()),
        patch("core.midi_utils.list_input_ports", return_value=["Digitakt"]),
        patch("core.midi_utils.open_input_port", return_value=mock_input_port),
        patch("core.midi_input.MidiInputListener.start") as mock_start,
        patch("api.server.init"),
        patch("api.server.start_background"),
        patch("core.player.Player.start"),
    ):
        from cli import tui_launcher
        tui_launcher._start_server(api_port=9999)
        mock_start.assert_called_once()


def test_launcher_graceful_when_no_input_port():
    with (
        patch("core.midi_utils.list_ports", return_value=[]),
        patch("core.midi_utils.list_input_ports", return_value=[]),
        patch("api.server.init"),
        patch("api.server.start_background"),
        patch("core.player.Player.start"),
    ):
        from cli import tui_launcher
        tui_launcher._start_server(api_port=9998)


def test_launcher_graceful_when_input_port_open_fails():
    with (
        patch("core.midi_utils.list_ports", return_value=[]),
        patch("core.midi_utils.list_input_ports", return_value=["Digitakt"]),
        patch("core.midi_utils.open_input_port", side_effect=IOError("no device")),
        patch("api.server.init"),
        patch("api.server.start_background"),
        patch("core.player.Player.start"),
    ):
        from cli import tui_launcher
        tui_launcher._start_server(api_port=9997)
