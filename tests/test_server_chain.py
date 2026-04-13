# tests/test_server_chain.py
import json
from pathlib import Path
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
import api.server as server_module


def _make_client(tmp_path: Path) -> TestClient:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    player = Player(state, bus, MagicMock())
    gen = Generator(state, bus)
    gen._client = MagicMock()
    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


def _save_pattern(tmp_path: Path, name: str) -> None:
    """Helper: write a minimal saved pattern file."""
    pattern = {t: [0] * 16 for t in TRACK_NAMES}
    data = {"pattern": pattern, "tags": [], "saved_at": "2026-01-01T00:00:00"}
    (tmp_path / f"{name}.json").write_text(json.dumps(data))


def test_post_chain_sets_chain(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    resp = client.post("/chain", json={"names": ["intro", "drop"], "auto": False})
    assert resp.status_code == 200
    assert server_module._state.chain == ["intro", "drop"]
    assert server_module._state.chain_auto is False


def test_post_chain_auto_flag(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    resp = client.post("/chain", json={"names": ["intro"], "auto": True})
    assert resp.status_code == 200
    assert server_module._state.chain_auto is True


def test_post_chain_rejects_unknown_pattern(tmp_path):
    client = _make_client(tmp_path)
    resp = client.post("/chain", json={"names": ["does-not-exist"], "auto": False})
    assert resp.status_code == 422
    assert "does-not-exist" in resp.json()["detail"]


def test_post_chain_next_loads_first_pattern(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    client.post("/chain", json={"names": ["intro", "drop"]})
    resp = client.post("/chain/next")
    assert resp.status_code == 200
    assert resp.json()["current"] == "intro"
    assert server_module._state.pending_pattern is not None


def test_post_chain_next_advances_index(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    client.post("/chain", json={"names": ["intro", "drop"]})
    client.post("/chain/next")  # intro
    resp = client.post("/chain/next")  # drop
    assert resp.status_code == 200
    assert resp.json()["current"] == "drop"


def test_post_chain_next_returns_409_at_end(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    client.post("/chain", json={"names": ["intro"]})
    client.post("/chain/next")  # intro
    resp = client.post("/chain/next")  # end
    assert resp.status_code == 409


def test_delete_chain_clears_state(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    client.post("/chain", json={"names": ["intro"]})
    resp = client.delete("/chain")
    assert resp.status_code == 200
    assert server_module._state.chain == []
    assert server_module._state.chain_index == -1


def test_get_chain_returns_status(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    client.post("/chain", json={"names": ["intro", "drop"]})
    resp = client.get("/chain")
    assert resp.status_code == 200
    data = resp.json()
    assert data["chain"] == ["intro", "drop"]
    assert data["chain_index"] == -1
    assert data["current"] is None
