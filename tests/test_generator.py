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


def test_valid_prob_is_accepted():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["prob"] = {"kick": [100] * 16, "snare": [75] * 16}
    result = gen._parse_pattern(json.dumps(pattern))
    assert result is not None
    assert result[0]["prob"]["kick"] == [100] * 16


def test_prob_with_unknown_track_is_rejected():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["prob"] = {"cowbell": [100] * 16}
    assert gen._parse_pattern(json.dumps(pattern)) is None


def test_prob_with_wrong_step_count_is_rejected():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["prob"] = {"kick": [100] * 8}
    assert gen._parse_pattern(json.dumps(pattern)) is None


def test_prob_with_out_of_range_value_is_rejected():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["prob"] = {"kick": [150] * 16}  # 150 > 100
    assert gen._parse_pattern(json.dumps(pattern)) is None


def test_prob_is_optional():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    result = gen._parse_pattern(json.dumps(pattern))
    assert result is not None
    assert "prob" not in result[0]


def test_valid_swing_is_accepted():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["swing"] = 25
    result = gen._parse_pattern(json.dumps(pattern))
    assert result is not None
    assert result[0]["swing"] == 25


def test_swing_zero_is_accepted():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["swing"] = 0
    result = gen._parse_pattern(json.dumps(pattern))
    assert result is not None


def test_swing_out_of_range_is_rejected():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["swing"] = 150
    assert gen._parse_pattern(json.dumps(pattern)) is None


def test_swing_negative_is_rejected():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["swing"] = -5
    assert gen._parse_pattern(json.dumps(pattern)) is None


def test_swing_is_optional():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    result = gen._parse_pattern(json.dumps(pattern))
    assert result is not None
    assert "swing" not in result[0]


# ── P1-6: State context in prompts ─────────────────────────────────────────

def test_build_state_context_includes_bpm():
    state = AppState()
    state.bpm = 140.0
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "BPM: 140.0" in ctx


def test_build_state_context_includes_muted_tracks():
    state = AppState()
    state.track_muted["kick"] = True
    state.track_muted["snare"] = True
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "kick" in ctx
    assert "snare" in ctx
    assert "Muted" in ctx


def test_build_state_context_includes_cc_overrides():
    state = AppState()
    state.track_cc["kick"]["filter"] = 90
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "kick.filter=90" in ctx


def test_build_state_context_includes_velocity_overrides():
    state = AppState()
    state.track_velocity["hihat"] = 80
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "hihat=80" in ctx


def test_build_state_context_includes_pattern_length():
    state = AppState()
    state.pattern_length = 32
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "32" in ctx


def test_variation_prompt_includes_state_context():
    state = AppState()
    state.last_prompt = "heavy kick"
    state.current_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.current_pattern["kick"][0] = 100
    state.track_muted["snare"] = True
    bus = EventBus()

    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("more sparse", variation=True)

    call_kwargs = gen._client.messages.create.call_args
    user_content = call_kwargs[1]["messages"][0]["content"]
    assert "Current state:" in user_content
    assert "snare" in user_content  # muted track should appear


# ── P1-7: Conversation history sharing ─────────────────────────────────────

def test_conversation_history_populated_after_ask():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client("This is an answer")
    gen.answer_question("How do I set BPM?")

    assert len(gen.conversation_history) == 2
    assert gen.conversation_history[0]["role"] == "user"
    assert gen.conversation_history[1]["role"] == "assistant"


def test_conversation_history_populated_after_generation():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("deep techno")

    assert len(gen.conversation_history) == 2
    assert "deep techno" in gen.conversation_history[0]["content"]


def test_conversation_history_bounded():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client("answer")

    # Add many conversation entries
    for i in range(30):
        gen.answer_question(f"Question {i}")

    # History should be bounded (max 20 entries = 10 pairs)
    assert len(gen.conversation_history) <= 20
