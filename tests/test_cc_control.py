# tests/test_cc_control.py
from __future__ import annotations

import threading
from pathlib import Path
from unittest.mock import MagicMock, call

import mido
import pytest
from fastapi.testclient import TestClient

from core.midi_utils import CC_MAP, NOTE_MAP, TRACK_CHANNELS, send_cc
from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
import api.server as server_module


# ---------------------------------------------------------------------------
# 1. send_cc sends correct mido message
# ---------------------------------------------------------------------------

def test_send_cc_sends_correct_message():
    mock_port = MagicMock()
    send_cc(mock_port, channel=2, cc_num=74, value=100)
    mock_port.send.assert_called_once()
    msg = mock_port.send.call_args[0][0]
    assert msg.type == "control_change"
    assert msg.channel == 2
    assert msg.control == 74
    assert msg.value == 100


# ---------------------------------------------------------------------------
# 2. TRACK_CHANNELS completeness
# ---------------------------------------------------------------------------

def test_track_channels_completeness():
    assert set(TRACK_CHANNELS.keys()) == set(TRACK_NAMES)
    channels = list(TRACK_CHANNELS.values())
    assert sorted(channels) == list(range(8))  # 0–7, unique


# ---------------------------------------------------------------------------
# 3. CC_MAP completeness
# ---------------------------------------------------------------------------

def test_cc_map_completeness():
    expected = {"tune", "filter", "resonance", "attack", "hold", "decay", "volume", "reverb", "delay"}
    assert set(CC_MAP.keys()) == expected
    for name, num in CC_MAP.items():
        assert 0 <= num <= 127, f"{name} CC number {num} out of range"


# ---------------------------------------------------------------------------
# 4. AppState.track_cc defaults
# ---------------------------------------------------------------------------

def test_app_state_track_cc_defaults():
    state = AppState()
    assert set(state.track_cc.keys()) == set(TRACK_NAMES)
    for track in TRACK_NAMES:
        cc = state.track_cc[track]
        assert set(cc.keys()) == set(CC_MAP.keys())
        assert cc["volume"] == 100
        assert cc["reverb"] == 0
        assert cc["delay"] == 0
        assert cc["tune"] == 64
        assert cc["filter"] == 127
        assert cc["resonance"] == 0
        assert cc["attack"] == 0
        assert cc["hold"] == 0
        assert cc["decay"] == 64


# ---------------------------------------------------------------------------
# 5. AppState.update_cc thread safety
# ---------------------------------------------------------------------------

def test_update_cc_thread_safety():
    state = AppState()
    errors = []

    def worker(track, param, value):
        try:
            state.update_cc(track, param, value)
        except Exception as e:
            errors.append(e)

    threads = [
        threading.Thread(target=worker, args=(track, "filter", i))
        for i, track in enumerate(TRACK_NAMES * 10)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    # Each track's filter should be one of the written values (not corrupted)
    for track in TRACK_NAMES:
        assert 0 <= state.track_cc[track]["filter"] <= 127


# ---------------------------------------------------------------------------
# Helpers for API tests
# ---------------------------------------------------------------------------

def _make_test_client(tmp_path: Path) -> tuple[TestClient, AppState, EventBus]:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    mock_port = MagicMock()
    player = Player(state, bus, mock_port)
    gen = Generator(state, bus)
    gen._client = MagicMock()

    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app), state, bus


# ---------------------------------------------------------------------------
# 6. POST /cc happy path
# ---------------------------------------------------------------------------

def test_post_cc_happy_path(tmp_path):
    client, state, bus = _make_test_client(tmp_path)
    events = []
    bus.subscribe("cc_changed", events.append)

    resp = client.post("/cc", json={"track": "kick", "param": "filter", "value": 80})
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"track": "kick", "param": "filter", "value": 80}
    assert state.track_cc["kick"]["filter"] == 80
    assert len(events) == 1
    assert events[0] == {"track": "kick", "param": "filter", "value": 80}


# ---------------------------------------------------------------------------
# 7. POST /cc invalid track → 422
# ---------------------------------------------------------------------------

def test_post_cc_invalid_track(tmp_path):
    client, _, _ = _make_test_client(tmp_path)
    resp = client.post("/cc", json={"track": "cowbell", "param": "filter", "value": 64})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 8. POST /cc invalid param → 422
# ---------------------------------------------------------------------------

def test_post_cc_invalid_param(tmp_path):
    client, _, _ = _make_test_client(tmp_path)
    resp = client.post("/cc", json={"track": "kick", "param": "unknown_param", "value": 64})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 9. POST /cc value out of range → 422 (Pydantic)
# ---------------------------------------------------------------------------

def test_post_cc_value_out_of_range(tmp_path):
    client, _, _ = _make_test_client(tmp_path)
    resp = client.post("/cc", json={"track": "kick", "param": "filter", "value": 200})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 10. GET /cc returns full track_cc
# ---------------------------------------------------------------------------

def test_get_cc_returns_track_cc(tmp_path):
    client, state, _ = _make_test_client(tmp_path)
    state.update_cc("snare", "reverb", 42)
    resp = client.get("/cc")
    assert resp.status_code == 200
    body = resp.json()
    assert body["snare"]["reverb"] == 42
    assert set(body.keys()) == set(TRACK_NAMES)


# ---------------------------------------------------------------------------
# 11. REPL cc command parsing
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 12. send_note uses correct channel from TRACK_CHANNELS
# ---------------------------------------------------------------------------

def test_send_note_uses_correct_channel():
    mock_port = MagicMock()
    from core.midi_utils import send_note

    send_note(mock_port, NOTE_MAP["kick"], 100, channel=TRACK_CHANNELS["kick"])
    send_note(mock_port, NOTE_MAP["snare"], 100, channel=TRACK_CHANNELS["snare"])

    calls = mock_port.send.call_args_list
    kick_msgs = [c[0][0] for c in calls if c[0][0].channel == TRACK_CHANNELS["kick"]]
    snare_msgs = [c[0][0] for c in calls if c[0][0].channel == TRACK_CHANNELS["snare"]]

    assert all(m.note == NOTE_MAP["kick"] for m in kick_msgs)
    assert all(m.note == NOTE_MAP["snare"] for m in snare_msgs)
