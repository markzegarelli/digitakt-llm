# tests/test_midi_utils.py
from unittest.mock import MagicMock, patch, call
import mido
import core.midi_utils as midi_utils


def test_find_digitakt_returns_matching_port():
    ports = ["USB MIDI Interface", "Elektron Digitakt MIDI 1", "IAC Driver Bus 1"]
    assert midi_utils.find_digitakt(ports) == "Elektron Digitakt MIDI 1"


def test_find_digitakt_returns_none_when_absent():
    ports = ["USB MIDI Interface", "IAC Driver Bus 1"]
    assert midi_utils.find_digitakt(ports) is None


def test_find_digitakt_empty_list():
    assert midi_utils.find_digitakt([]) is None


def test_send_note_sends_note_on():
    port = MagicMock()
    midi_utils.send_note(port, note=36, velocity=100, channel=0)
    assert port.send.call_count == 1
    on_msg = port.send.call_args_list[0][0][0]
    assert on_msg.type == "note_on"
    assert on_msg.note == 36
    assert on_msg.velocity == 100
    assert on_msg.channel == 0


def test_send_note_off_sends_note_on_velocity_zero():
    port = MagicMock()
    midi_utils.send_note_off(port, note=36, channel=0)
    port.send.assert_called_once()
    msg = port.send.call_args[0][0]
    assert msg.type == "note_on"
    assert msg.note == 36
    assert msg.velocity == 0
    assert msg.channel == 0


def test_send_note_zero_velocity_does_nothing():
    port = MagicMock()
    midi_utils.send_note(port, note=36, velocity=0, channel=0)
    port.send.assert_not_called()


def test_note_map_has_all_tracks():
    from core.state import TRACK_NAMES
    for track in TRACK_NAMES:
        assert track in midi_utils.NOTE_MAP


def test_list_ports_returns_list():
    with patch("mido.get_output_names", return_value=["Port A", "Port B"]):
        ports = midi_utils.list_ports()
    assert ports == ["Port A", "Port B"]


def test_send_start():
    port = MagicMock()
    midi_utils.send_start(port)
    port.send.assert_called_once()
    msg = port.send.call_args[0][0]
    assert msg.type == "start"


def test_send_stop():
    port = MagicMock()
    midi_utils.send_stop(port)
    port.send.assert_called_once()
    msg = port.send.call_args[0][0]
    assert msg.type == "stop"


def test_send_clock():
    port = MagicMock()
    midi_utils.send_clock(port)
    port.send.assert_called_once()
    msg = port.send.call_args[0][0]
    assert msg.type == "clock"
