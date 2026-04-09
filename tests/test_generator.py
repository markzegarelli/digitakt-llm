# tests/test_generator.py
import json
from unittest.mock import MagicMock, patch
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.generator import Generator

VALID_PATTERN = {k: [0] * 16 for k in TRACK_NAMES}
VALID_PATTERN["kick"][0] = 100


def _make_mock_client(response_text: str) -> MagicMock:
    client = MagicMock()
    msg = MagicMock()
    msg.content = [MagicMock(text=response_text)]
    client.messages.create.return_value = msg
    return client


def test_valid_json_emits_generation_complete():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_started", lambda p: events.append(("started", p)))
    bus.subscribe("generation_complete", lambda p: events.append(("complete", p)))

    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("heavy kick")

    assert events[0] == ("started", {"prompt": "heavy kick"})
    assert events[1][0] == "complete"
    assert events[1][1]["pattern"] == VALID_PATTERN
    assert events[1][1]["prompt"] == "heavy kick"


def test_valid_json_updates_state():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("heavy kick")

    assert state.last_prompt == "heavy kick"
    assert len(state.pattern_history) == 1
    assert state.pending_pattern == VALID_PATTERN


def test_invalid_json_retries_once_then_emits_failed():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    gen = Generator(state, bus)
    gen._client = _make_mock_client("not valid json at all")
    gen._run("test prompt")

    assert gen._client.messages.create.call_count == 2
    assert len(events) == 1
    assert events[0]["prompt"] == "test prompt"
    assert "error" in events[0]


def test_api_exception_emits_generation_failed():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    gen = Generator(state, bus)
    gen._client = MagicMock()
    gen._client.messages.create.side_effect = Exception("network error")
    gen._run("test")

    assert len(events) == 1
    assert "network error" in events[0]["error"]


def test_variation_passes_prior_context():
    state = AppState()
    state.last_prompt = "original prompt"
    state.current_pattern = VALID_PATTERN
    bus = EventBus()

    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("more sparse", variation=True)

    call_kwargs = gen._client.messages.create.call_args
    user_content = call_kwargs[1]["messages"][0]["content"]
    assert "original prompt" in user_content
    assert "more sparse" in user_content


def test_pattern_with_wrong_track_names_fails_validation():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    bad_pattern = {"bass": [0] * 16}
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(bad_pattern))
    gen._run("test")

    assert len(events) == 1


def test_pattern_with_wrong_step_count_fails_validation():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    bad_pattern = {k: [0] * 8 for k in TRACK_NAMES}  # 8 steps instead of 16
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(bad_pattern))
    gen._run("test")

    assert len(events) == 1
