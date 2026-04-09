# tests/test_server.py
import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
import api.server as server_module


def _make_test_client(tmp_path: Path) -> TestClient:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    mock_port = MagicMock()
    player = Player(state, bus, mock_port)
    gen = Generator(state, bus)
    gen._client = MagicMock()  # prevent real API calls

    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


def test_get_state_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/state")
    assert resp.status_code == 200
    data = resp.json()
    assert "bpm" in data
    assert "is_playing" in data
    assert data["bpm"] == 120.0


def test_post_bpm_updates_state(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/bpm", json={"bpm": 140.0})
    assert resp.status_code == 200
    state_resp = client.get("/state")
    assert state_resp.json()["bpm"] == 140.0


def test_post_generate_returns_202(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/generate", json={"prompt": "heavy kick"})
    assert resp.status_code == 202


def test_post_play_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/play")
    assert resp.status_code == 200
    server_module._player.stop()


def test_post_stop_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/stop")
    assert resp.status_code == 200


def test_get_patterns_empty(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns")
    assert resp.status_code == 200
    assert resp.json() == {"names": []}


def test_save_and_load_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    save_resp = client.post("/patterns/test-beat")
    assert save_resp.status_code == 200
    assert (tmp_path / "test-beat.json").exists()

    list_resp = client.get("/patterns")
    assert "test-beat" in list_resp.json()["names"]

    load_resp = client.get("/patterns/test-beat")
    assert load_resp.status_code == 200


def test_load_nonexistent_pattern_returns_404(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns/does-not-exist")
    assert resp.status_code == 404


def test_websocket_connects(tmp_path):
    client = _make_test_client(tmp_path)
    with client.websocket_connect("/ws") as ws:
        # Connection established — no assertion needed beyond not raising
        pass
