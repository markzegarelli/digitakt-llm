# tests/test_cc_params.py
"""Tests for issue #22: single source of truth for CC parameters."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.midi_utils import CC_MAP
from core.state import AppState, TRACK_NAMES


# ---------------------------------------------------------------------------
# CC_DEFAULTS exported from midi_utils
# ---------------------------------------------------------------------------

def test_cc_defaults_exported_from_midi_utils():
    from core.midi_utils import CC_DEFAULTS
    assert isinstance(CC_DEFAULTS, dict)
    assert len(CC_DEFAULTS) > 0


def test_cc_defaults_keys_match_cc_map():
    from core.midi_utils import CC_DEFAULTS
    assert set(CC_DEFAULTS.keys()) == set(CC_MAP.keys())


def test_cc_defaults_values():
    from core.midi_utils import CC_DEFAULTS
    assert CC_DEFAULTS["tune"] == 64
    assert CC_DEFAULTS["filter"] == 127
    assert CC_DEFAULTS["resonance"] == 0
    assert CC_DEFAULTS["attack"] == 0
    assert CC_DEFAULTS["hold"] == 0
    assert CC_DEFAULTS["decay"] == 64
    assert CC_DEFAULTS["volume"] == 100
    assert CC_DEFAULTS["reverb"] == 0
    assert CC_DEFAULTS["delay"] == 0


# ---------------------------------------------------------------------------
# AppState.track_cc uses CC_DEFAULTS (not a hardcoded dict in state.py)
# ---------------------------------------------------------------------------

def test_state_track_cc_initialized_from_cc_defaults():
    """AppState.track_cc defaults must equal CC_DEFAULTS for each track."""
    from core.midi_utils import CC_DEFAULTS
    state = AppState()
    for track in TRACK_NAMES:
        assert state.track_cc[track] == CC_DEFAULTS, (
            f"track_cc[{track!r}] diverges from CC_DEFAULTS"
        )


# ---------------------------------------------------------------------------
# GET /cc-params endpoint
# ---------------------------------------------------------------------------

def _make_client(tmp_path: Path) -> TestClient:
    from core.events import EventBus
    from core.player import Player
    from core.generator import Generator
    import api.server as server_module

    state = AppState()
    state.current_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    bus = EventBus()
    player = Player(state, bus, MagicMock())
    gen = Generator(state, bus)
    gen._client = MagicMock()
    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


def test_cc_params_endpoint_returns_200(tmp_path):
    client = _make_client(tmp_path)
    resp = client.get("/cc-params")
    assert resp.status_code == 200


def test_cc_params_endpoint_contains_all_params(tmp_path):
    client = _make_client(tmp_path)
    resp = client.get("/cc-params")
    body = resp.json()
    names = {p["name"] for p in body["params"]}
    assert names == set(CC_MAP.keys())


def test_cc_params_endpoint_entries_have_cc_and_default(tmp_path):
    client = _make_client(tmp_path)
    resp = client.get("/cc-params")
    for entry in resp.json()["params"]:
        assert "name" in entry
        assert "cc" in entry
        assert "default" in entry
        assert 0 <= entry["cc"] <= 127
        assert 0 <= entry["default"] <= 127


def test_cc_params_endpoint_cc_numbers_match_cc_map(tmp_path):
    client = _make_client(tmp_path)
    resp = client.get("/cc-params")
    for entry in resp.json()["params"]:
        assert CC_MAP[entry["name"]] == entry["cc"]


def test_cc_params_endpoint_defaults_match_cc_defaults(tmp_path):
    from core.midi_utils import CC_DEFAULTS
    client = _make_client(tmp_path)
    resp = client.get("/cc-params")
    for entry in resp.json()["params"]:
        assert CC_DEFAULTS[entry["name"]] == entry["default"]
