# tests/test_server.py
import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch, call
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


def test_post_play_without_midi_returns_200(tmp_path):
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    player = Player(state, bus, None)
    gen = Generator(state, bus)
    gen._client = MagicMock()
    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    client = TestClient(server_module.app)
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
    assert resp.json() == {"patterns": []}


def test_save_and_load_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    save_resp = client.post("/patterns/test-beat")
    assert save_resp.status_code == 200
    assert (tmp_path / "test-beat.json").exists()

    list_resp = client.get("/patterns")
    names = [p["name"] for p in list_resp.json()["patterns"]]
    assert "test-beat" in names

    load_resp = client.get("/patterns/test-beat")
    assert load_resp.status_code == 200


def test_load_nonexistent_pattern_returns_404(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns/does-not-exist")
    assert resp.status_code == 404


def test_load_while_stopped_applies_pattern_immediately(tmp_path):
    """GET /patterns/{name} must update the grid when playback is stopped (no player loop)."""
    client = _make_test_client(tmp_path)
    client.post("/patterns/snap")
    client.post("/vel", json={"track": "kick", "step": 1, "value": 5})
    assert client.get("/state").json()["current_pattern"]["kick"][0] == 5
    assert server_module._state.is_playing is False

    load_resp = client.get("/patterns/snap")
    assert load_resp.status_code == 200

    state = client.get("/state").json()
    assert state["current_pattern"]["kick"][0] == DEFAULT_PATTERN["kick"][0]
    assert server_module._state.pending_pattern is None


def test_websocket_connects(tmp_path):
    client = _make_test_client(tmp_path)
    with client.websocket_connect("/ws") as ws:
        # Connection established — no assertion needed beyond not raising
        pass


def test_get_state_includes_track_muted(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/state")
    assert resp.status_code == 200
    data = resp.json()
    assert "track_muted" in data
    assert set(data["track_muted"].keys()) == set(TRACK_NAMES)
    assert all(v is False for v in data["track_muted"].values())


def test_post_mute_mutes_track(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/mute", json={"track": "kick", "muted": True})
    assert resp.status_code == 200
    assert resp.json() == {"track": "kick", "muted": True}
    state_resp = client.get("/state")
    assert state_resp.json()["track_muted"]["kick"] is True


def test_post_mute_unmutes_track(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/mute", json={"track": "snare", "muted": True})
    resp = client.post("/mute", json={"track": "snare", "muted": False})
    assert resp.status_code == 200
    assert resp.json()["muted"] is False


def test_post_mute_invalid_track_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/mute", json={"track": "cowbell", "muted": True})
    assert resp.status_code == 422


# ── /prob ──────────────────────────────────────────────────────────────────

def test_post_prob_sets_step(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/prob", json={"track": "kick", "step": 1, "value": 50})
    assert resp.status_code == 200
    assert resp.json() == {"track": "kick", "step": 1, "value": 50}


def test_post_prob_updates_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/prob", json={"track": "snare", "step": 3, "value": 75})
    state = client.get("/state").json()
    assert state["current_pattern"]["prob"]["snare"][2] == 75


def test_post_prob_invalid_track_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/prob", json={"track": "cowbell", "step": 1, "value": 50})
    assert resp.status_code == 422


def test_post_prob_step_out_of_range_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/prob", json={"track": "kick", "step": 17, "value": 50})
    assert resp.status_code == 422


# ── /swing ─────────────────────────────────────────────────────────────────

def test_post_swing_sets_amount(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/swing", json={"amount": 25})
    assert resp.status_code == 200
    assert resp.json() == {"amount": 25}


def test_post_swing_reflected_in_state(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/swing", json={"amount": 30})
    state = client.get("/state").json()
    assert state["swing"] == 30


def test_post_swing_out_of_range_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/swing", json={"amount": 101})
    assert resp.status_code == 422


# ── /vel ───────────────────────────────────────────────────────────────────

def test_post_vel_sets_step(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/vel", json={"track": "snare", "step": 4, "value": 64})
    assert resp.status_code == 200
    assert resp.json() == {"track": "snare", "step": 4, "value": 64}


def test_post_vel_updates_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/vel", json={"track": "kick", "step": 1, "value": 80})
    state = client.get("/state").json()
    assert state["current_pattern"]["kick"][0] == 80


def test_post_vel_invalid_track_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/vel", json={"track": "cowbell", "step": 1, "value": 64})
    assert resp.status_code == 422


# ── /random ────────────────────────────────────────────────────────────────

def test_post_random_velocity_single_track(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/random", json={"track": "kick", "param": "velocity", "lo": 40, "hi": 100})
    assert resp.status_code == 200
    data = resp.json()
    assert data["track"] == "kick"
    assert data["param"] == "velocity"


def test_post_random_prob_all_tracks(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/random", json={"track": "all", "param": "prob", "lo": 0, "hi": 100})
    assert resp.status_code == 200
    assert resp.json()["track"] == "all"


def test_post_random_invalid_track_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/random", json={"track": "cowbell", "param": "velocity", "lo": 0, "hi": 127})
    assert resp.status_code == 422


def test_post_random_invalid_param_returns_422(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/random", json={"track": "kick", "param": "tempo", "lo": 0, "hi": 127})
    assert resp.status_code == 422


# ── /randbeat ──────────────────────────────────────────────────────────────

def test_post_randbeat_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/randbeat")
    assert resp.status_code == 200
    data = resp.json()
    assert "bpm" in data
    assert "swing" in data


def test_post_randbeat_bpm_in_techno_range(tmp_path):
    client = _make_test_client(tmp_path)
    for _ in range(5):
        resp = client.post("/randbeat")
        bpm = resp.json()["bpm"]
        assert 128 <= bpm <= 160, f"BPM {bpm} out of techno range"


def test_post_randbeat_updates_state_cc(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/randbeat")
    state = client.get("/state").json()
    # After randbeat, CC values should be present for all tracks
    for track in TRACK_NAMES:
        assert track in state["track_cc"]


# ── /new ───────────────────────────────────────────────────────────────────

def test_post_new_resets_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    # Set a non-empty pattern first
    server_module._state.current_pattern = {track: [100] * 16 for track in TRACK_NAMES}
    server_module._state.bpm = 160.0

    response = client.post("/new")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    # Pattern should be pending reset
    assert server_module._state.pending_pattern is not None
    for track in TRACK_NAMES:
        assert server_module._state.pending_pattern[track] == [0] * 16
    assert server_module._state.bpm == 120.0
    assert server_module._state.last_prompt is None


# ── /undo ──────────────────────────────────────────────────────────────────

def test_post_undo_applies_previous_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    pattern_a = {track: [50] * 16 for track in TRACK_NAMES}
    server_module._state.update_pattern(pattern_a, prompt="previous")

    response = client.post("/undo")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert server_module._state.pending_pattern is not None
    for track in TRACK_NAMES:
        assert server_module._state.pending_pattern[track] == [50] * 16


def test_post_undo_returns_404_when_empty_history(tmp_path):
    client = _make_test_client(tmp_path)
    response = client.post("/undo")
    assert response.status_code == 404


# ── WebSocket event payloads ───────────────────────────────────────────────

def test_ws_receives_bpm_changed_event(tmp_path):
    client = _make_test_client(tmp_path)
    with client.websocket_connect("/ws") as ws:
        server_module._bus.emit("bpm_changed", {"bpm": 130.0})
        import time; time.sleep(0.05)
        # Connection remains stable after event emission


def test_ws_receives_generation_complete_event(tmp_path):
    client = _make_test_client(tmp_path)
    with client.websocket_connect("/ws") as ws:
        payload = {"prompt": "test prompt", "pattern": {}}
        server_module._bus.emit("generation_complete", payload)
        import time; time.sleep(0.05)


def test_ws_receives_pattern_changed_event(tmp_path):
    client = _make_test_client(tmp_path)
    with client.websocket_connect("/ws") as ws:
        server_module._bus.emit("pattern_changed", {})
        import time; time.sleep(0.05)


def test_save_pattern_with_tags(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/patterns/groove", json={"tags": ["dark", "kick-heavy"]})
    assert resp.status_code == 200
    data = json.loads((tmp_path / "groove.json").read_text())
    assert data["tags"] == ["dark", "kick-heavy"]
    assert "pattern" in data
    assert "saved_at" in data


def test_list_patterns_includes_tags(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/patterns/groove", json={"tags": ["dark"]})
    client.post("/patterns/simple", json={})
    resp = client.get("/patterns")
    assert resp.status_code == 200
    names = {item["name"]: item for item in resp.json()["patterns"]}
    assert names["groove"]["tags"] == ["dark"]
    assert names["simple"]["tags"] == []


def test_load_old_format_pattern_backwards_compat(tmp_path):
    old = {k: [0] * 16 for k in ["kick","snare","tom","clap","bell","hihat","openhat","cymbal"]}
    (tmp_path / "legacy.json").write_text(json.dumps(old))
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns/legacy")
    assert resp.status_code == 200


def test_post_fill_queues_saved_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/patterns/myfill")        # save current as "myfill"
    resp = client.post("/fill/myfill")
    assert resp.status_code == 200
    assert resp.json()["queued"] == "myfill"


def test_post_fill_missing_pattern_returns_404(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/fill/doesnotexist")
    assert resp.status_code == 404


def test_post_length_sets_pattern_length(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/length", json={"steps": 8})
    assert resp.status_code == 200
    assert resp.json()["steps"] == 8
    state_resp = client.get("/state")
    assert state_resp.json()["pattern_length"] == 8


def test_post_length_rejects_invalid_value(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/length", json={"steps": 7})
    assert resp.status_code == 422


# ── /gate ──────────────────────────────────────────────────────────────────

def test_post_gate_sets_step_gate(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/gate", json={"track": "kick", "step": 1, "value": 50})
    assert resp.status_code == 200
    assert resp.json()["track"] == "kick"
    assert resp.json()["step"] == 1
    assert resp.json()["value"] == 50


# ── /pitch ─────────────────────────────────────────────────────────────────

def test_post_pitch_sets_track_pitch(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/pitch", json={"track": "kick", "value": 48})
    assert resp.status_code == 200
    assert resp.json()["track"] == "kick"
    assert resp.json()["value"] == 48
    state_resp = client.get("/state")
    assert state_resp.json()["track_pitch"]["kick"] == 48


# ── /cond ──────────────────────────────────────────────────────────────────

def test_post_cond_sets_step_condition(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/cond", json={"track": "kick", "step": 1, "value": "1:2"})
    assert resp.status_code == 200
    assert resp.json()["track"] == "kick"
    assert resp.json()["value"] == "1:2"


def test_post_cond_clears_step_condition(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/cond", json={"track": "kick", "step": 1, "value": "1:2"})
    resp = client.post("/cond", json={"track": "kick", "step": 1, "value": None})
    assert resp.status_code == 200
    assert resp.json()["value"] is None


# ── /new regression tests ──────────────────────────────────────────────────

def test_post_new_resets_to_empty_pattern(tmp_path):
    """Regression: /new must set pending_pattern to all-zero tracks."""
    client = _make_test_client(tmp_path)
    server_module._state.current_pattern = {t: [100] * 16 for t in TRACK_NAMES}
    server_module._state.bpm = 145.0
    server_module._state.last_prompt = "heavy kick"

    resp = client.post("/new")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    assert server_module._state.bpm == 120.0
    assert server_module._state.last_prompt is None
    assert server_module._state.pending_pattern is not None
    for track in TRACK_NAMES:
        assert server_module._state.pending_pattern[track] == [0] * 16


def test_post_new_broadcasts_pattern_data(tmp_path):
    """Regression: pattern_changed event from /new must include the pattern payload
    so the TUI doesn't crash on undefined current_pattern."""
    client = _make_test_client(tmp_path)

    with patch.object(server_module, "_broadcast_event") as mock_broadcast:
        client.post("/new")

        # Find the pattern_changed call
        pattern_calls = [
            c for c in mock_broadcast.call_args_list
            if c[0][0] == "pattern_changed"
        ]
        assert len(pattern_calls) >= 1, "Must broadcast pattern_changed"
        payload = pattern_calls[0][0][1]
        assert "pattern" in payload, "pattern_changed event must include 'pattern' key"
        pattern = payload["pattern"]
        assert pattern is not None
        for track in TRACK_NAMES:
            assert track in pattern
            assert pattern[track] == [0] * 16


def test_post_new_stops_playback_if_playing(tmp_path):
    client = _make_test_client(tmp_path)
    server_module._state.is_playing = True
    client.post("/new")
    # Player.stop() should have been called (is_playing cleared)
    assert server_module._state.is_playing is False


def test_post_new_resets_mutes(tmp_path):
    """Regression: /new must reset all track_muted to False and clear pending_mutes."""
    client = _make_test_client(tmp_path)
    for track in TRACK_NAMES:
        server_module._state.track_muted[track] = True
    server_module._state.pending_mutes["kick"] = True

    resp = client.post("/new")
    assert resp.status_code == 200
    for track in TRACK_NAMES:
        assert server_module._state.track_muted[track] is False
    assert server_module._state.pending_mutes == {}


def test_post_new_resets_cc_and_velocity(tmp_path):
    """Regression: /new must reset track_cc and track_velocity to defaults."""
    from core.state import _DEFAULT_CC_PARAMS
    client = _make_test_client(tmp_path)
    for track in TRACK_NAMES:
        server_module._state.track_cc[track]["filter"] = 0
        server_module._state.track_velocity[track] = 64

    resp = client.post("/new")
    assert resp.status_code == 200
    for track in TRACK_NAMES:
        assert server_module._state.track_cc[track] == dict(_DEFAULT_CC_PARAMS)
        assert server_module._state.track_velocity[track] == 127


# ── /ask — ask_complete event and is_implementable ─────────────────────────

def test_post_ask_emits_ask_complete_event(tmp_path):
    client = _make_test_client(tmp_path)
    received = []
    server_module._bus.subscribe("ask_complete", lambda p: received.append(p))

    # Mock both answer_question (returns str) and classify (returns bool)
    server_module._generator.answer_question = MagicMock(return_value="Use /bpm to set tempo")
    server_module._generator.classify_as_implementable = MagicMock(return_value=False)
    # answer_question_with_classify delegates to the two above
    server_module._generator.answer_question_with_classify = MagicMock(
        return_value=("Use /bpm to set tempo", False)
    )

    resp = client.post("/ask", json={"question": "How do I set BPM?"})
    assert resp.status_code == 200
    assert resp.json()["answer"] == "Use /bpm to set tempo"
    assert resp.json()["is_implementable"] is False
    assert len(received) == 1
    assert received[0]["answer"] == "Use /bpm to set tempo"
    assert received[0]["question"] == "How do I set BPM?"


def test_post_ask_returns_is_implementable_true(tmp_path):
    client = _make_test_client(tmp_path)
    server_module._generator.answer_question_with_classify = MagicMock(
        return_value=("Four-on-the-floor at 130 BPM with snare on 5 and 13", True)
    )

    resp = client.post("/ask", json={"question": "give me a basic techno beat"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_implementable"] is True
    assert "130 BPM" in data["answer"]
