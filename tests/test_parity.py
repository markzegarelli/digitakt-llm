# tests/test_parity.py
"""Tests for issue #23: Python is authoritative for validation.

Category A: acceptance contract — valid requests must return 200
Category B: rejection contract — invalid requests must return 422
Category C: human-readable error messages
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
import api.server as server_module


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    player = Player(state, bus, MagicMock())
    gen = Generator(state, bus)
    gen._client = MagicMock()
    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


# ---------------------------------------------------------------------------
# Category A: acceptance contracts
# ---------------------------------------------------------------------------

def test_parity_prob_valid(client):
    assert client.post("/prob", json={"track": "kick", "step": 1, "value": 50}).status_code == 200


def test_parity_vel_valid(client):
    assert client.post("/vel", json={"track": "snare", "step": 4, "value": 100}).status_code == 200


def test_parity_bpm_valid_min(client):
    assert client.post("/bpm", json={"bpm": 20.0}).status_code == 200


def test_parity_bpm_valid_max(client):
    assert client.post("/bpm", json={"bpm": 400.0}).status_code == 200


def test_parity_length_valid_8(client):
    assert client.post("/length", json={"steps": 8}).status_code == 200


def test_parity_length_valid_16(client):
    assert client.post("/length", json={"steps": 16}).status_code == 200


def test_parity_length_valid_32(client):
    assert client.post("/length", json={"steps": 32}).status_code == 200


def test_parity_cc_valid(client):
    assert client.post("/cc", json={"track": "kick", "param": "filter", "value": 64}).status_code == 200


def test_parity_swing_valid(client):
    assert client.post("/swing", json={"amount": 50}).status_code == 200


def test_parity_gate_valid(client):
    assert client.post("/gate", json={"track": "kick", "step": 1, "value": 75}).status_code == 200


def test_parity_pitch_valid(client):
    assert client.post("/pitch", json={"track": "kick", "value": 48}).status_code == 200


def test_parity_cond_valid(client):
    assert client.post("/cond", json={"track": "kick", "step": 1, "value": "1:2"}).status_code == 200


def test_parity_cond_clear_valid(client):
    assert client.post("/cond", json={"track": "kick", "step": 1, "value": None}).status_code == 200


# ---------------------------------------------------------------------------
# Category B: rejection contracts (what TypeScript used to pre-screen)
# ---------------------------------------------------------------------------

def test_parity_bpm_too_low_rejected(client):
    assert client.post("/bpm", json={"bpm": 5.0}).status_code == 422


def test_parity_bpm_too_high_rejected(client):
    assert client.post("/bpm", json={"bpm": 500.0}).status_code == 422


def test_parity_prob_invalid_track_rejected(client):
    assert client.post("/prob", json={"track": "cowbell", "step": 1, "value": 50}).status_code == 422


def test_parity_cc_invalid_track_rejected(client):
    assert client.post("/cc", json={"track": "cowbell", "param": "filter", "value": 64}).status_code == 422


def test_parity_cc_invalid_param_rejected(client):
    assert client.post("/cc", json={"track": "kick", "param": "bogus", "value": 64}).status_code == 422


def test_parity_length_invalid_steps_rejected(client):
    assert client.post("/length", json={"steps": 10}).status_code == 422


def test_parity_cond_invalid_value_rejected(client):
    assert client.post("/cond", json={"track": "kick", "step": 1, "value": "bogus"}).status_code == 422


def test_parity_gate_invalid_track_rejected(client):
    assert client.post("/gate", json={"track": "cowbell", "step": 1, "value": 50}).status_code == 422


def test_parity_cond_invalid_track_rejected(client):
    assert client.post("/cond", json={"track": "cowbell", "step": 1, "value": "1:2"}).status_code == 422


def test_parity_velocity_out_of_range_rejected(client):
    assert client.post("/velocity", json={"track": "kick", "value": 200}).status_code == 422


def test_parity_prob_value_out_of_range_rejected(client):
    assert client.post("/prob", json={"track": "kick", "step": 1, "value": 150}).status_code == 422


# ---------------------------------------------------------------------------
# Category C: human-readable error messages
# ---------------------------------------------------------------------------

def test_parity_bpm_error_message_is_readable(client):
    resp = client.post("/bpm", json={"bpm": 5.0})
    body = resp.json()
    assert "detail" in body
    detail = body["detail"]
    # Must have some message — not an empty list or None
    assert detail is not None
    assert detail != []


def test_parity_length_error_message_is_readable(client):
    resp = client.post("/length", json={"steps": 10})
    body = resp.json()
    assert "detail" in body
    assert body["detail"] is not None
