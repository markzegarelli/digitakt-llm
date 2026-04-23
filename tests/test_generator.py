# tests/test_generator.py
import json
from unittest.mock import MagicMock, patch
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.generator import (
    _GENRE_ALIASES,
    _GENRE_CONTEXTS,
    Generator,
    _compute_generation_summary,
    _detect_genre,
    _detect_target_tracks,
    _normalize_producer_notes,
    _opus_max_output_tokens,
    _parse_ask_response,
    _serialize_pattern_for_llm,
)

VALID_PATTERN = {k: [0] * 16 for k in TRACK_NAMES}
VALID_PATTERN["kick"][0] = 100


def _make_mock_client(response_text: str) -> MagicMock:
    client = MagicMock()
    msg = MagicMock()
    msg.content = [MagicMock(text=response_text)]
    client.messages.create.return_value = msg
    return client


def _make_mock_client_tool(pattern_dict: dict) -> MagicMock:
    client = MagicMock()
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.name = "emit_pattern"
    tool_block.input = pattern_dict
    msg = MagicMock()
    msg.content = [tool_block]
    client.messages.create.return_value = msg
    return client


def test_tool_use_emits_generation_complete():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_complete", lambda p: events.append(p))
    gen = Generator(state, bus)
    gen._client = _make_mock_client_tool(dict(VALID_PATTERN, bpm=135))
    gen._run("heavy kick")
    assert len(events) == 1
    assert events[0]["bpm"] == 135


def test_opus_max_output_tokens_scales_with_steps():
    assert _opus_max_output_tokens(16) == 2048
    assert _opus_max_output_tokens(32) > 2048


def test_parse_ask_response_strips_trailing_line():
    ans, impl = _parse_ask_response("Line one\nLine two\nIMPLEMENTABLE: YES")
    assert impl is True
    assert "IMPLEMENTABLE" not in ans
    assert "Line two" in ans


def test_parse_ask_response_defaults_false():
    ans, impl = _parse_ask_response("No marker here")
    assert impl is False
    assert ans == "No marker here"


def test_serialize_pattern_for_llm_includes_prob():
    pat = {k: [0] * 16 for k in TRACK_NAMES}
    pat["kick"][0] = 100
    pat["prob"] = {"snare": [100] * 16}
    raw = _serialize_pattern_for_llm(pat, 16)
    data = json.loads(raw)
    assert "prob" in data
    assert data["prob"]["snare"] == [100] * 16


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
    emitted = events[1][1]["pattern"]
    for t in TRACK_NAMES:
        assert emitted[t] == VALID_PATTERN[t]
    assert emitted.get("seq_mode") == "standard"
    assert events[1][1]["prompt"] == "heavy kick"
    assert events[1][1]["summary"]["prompt"] == "heavy kick"
    assert "latency_ms" in events[1][1]["summary"]
    assert events[1][1].get("producer_notes") is None
    assert "producer_notes" not in events[1][1]["summary"]


def test_generation_complete_includes_producer_notes_from_json():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_complete", lambda p: events.append(p))

    payload = {**VALID_PATTERN, "producer_notes": "  Tip: sub-osc.  "}
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(payload))
    gen._run("hypnotic techno")

    assert len(events) == 1
    assert events[0]["producer_notes"] == "Tip: sub-osc."
    assert events[0]["summary"]["producer_notes"] == "Tip: sub-osc."
    assert "producer_notes" not in state.current_pattern


def test_compute_generation_summary_counts_tracks():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    pattern["snare"][4] = 90
    summary = _compute_generation_summary("test", pattern, 123)
    assert summary["prompt"] == "test"
    assert summary["latency_ms"] == 123
    assert "BDx1" in summary["track_summary"]
    assert "SDx1" in summary["track_summary"]


def test_compute_generation_summary_includes_producer_notes_when_set():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    summary = _compute_generation_summary("p", pattern, 50, "Clock divide /4.")
    assert summary["producer_notes"] == "Clock divide /4."


def test_compute_generation_summary_omits_producer_notes_when_none():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    summary = _compute_generation_summary("p", pattern, 50, None)
    assert "producer_notes" not in summary


def test_normalize_producer_notes_truncates():
    long_text = "a" * 1300
    out = _normalize_producer_notes(long_text)
    assert len(out) == 1200


def test_normalize_producer_notes_empty_returns_none():
    assert _normalize_producer_notes("  \n\t ") is None


def test_valid_json_updates_state():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("heavy kick")

    assert state.last_prompt == "heavy kick"
    assert len(state.pattern_history) == 1
    pend = state.pending_pattern
    for t in TRACK_NAMES:
        assert pend[t] == VALID_PATTERN[t]
    assert pend.get("seq_mode") == "standard"


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
    assert result[3] is None


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
    assert result[3] is None


def test_parse_pattern_accepts_producer_notes():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["producer_notes"] = "Keep bass below kick fundamental."
    result = gen._parse_pattern(json.dumps(pattern))
    assert result is not None
    assert result[3] == "Keep bass below kick fundamental."
    assert "producer_notes" not in result[0]


def test_parse_pattern_rejects_non_string_producer_notes():
    gen = Generator(AppState(), EventBus())
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["producer_notes"] = ["not", "a", "string"]
    assert gen._parse_pattern(json.dumps(pattern)) is None


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


def test_build_state_context_includes_pitch_overrides():
    state = AppState()
    state.track_pitch["kick"] = 36
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "kick=36" in ctx
    assert "pitch" in ctx.lower()


def test_build_state_context_prob_summary():
    state = AppState()
    state.pattern_length = 16
    state.current_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.current_pattern["prob"] = {"hihat": [100, 50] + [100] * 14}
    gen = Generator(state, EventBus())
    ctx = gen._build_state_context()
    assert "Prob summary" in ctx
    assert "hihat" in ctx


def test_build_user_prompt_variation_includes_prob_and_gate():
    state = AppState()
    state.last_prompt = "original"
    state.current_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.current_pattern["kick"][0] = 100
    state.current_pattern["prob"] = {"snare": [100] * 16}
    state.current_pattern["gate"] = {"tom": [40] * 16}
    gen = Generator(state, EventBus())
    p = gen._build_user_prompt("more energy", variation=True)
    assert '"prob"' in p
    assert '"gate"' in p


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


# ── Feature 5: _strip_markdown ──────────────────────────────────────────────

from core.generator import _strip_markdown


def test_strip_markdown_removes_bold_stars():
    assert _strip_markdown("Use **bold text** here") == "Use bold text here"


def test_strip_markdown_removes_bold_underscores():
    assert _strip_markdown("Use __bold text__ here") == "Use bold text here"


def test_strip_markdown_removes_italic_star():
    assert _strip_markdown("this is *italic*") == "this is italic"


def test_strip_markdown_removes_italic_underscore():
    assert _strip_markdown("this is _italic_") == "this is italic"


def test_strip_markdown_removes_inline_code():
    assert _strip_markdown("Run `bpm 140` to set tempo") == "Run bpm 140 to set tempo"


def test_strip_markdown_converts_heading():
    assert _strip_markdown("## Commands") == "COMMANDS:"


def test_strip_markdown_converts_h1():
    assert _strip_markdown("# Overview") == "OVERVIEW:"


def test_strip_markdown_removes_horizontal_rule():
    result = _strip_markdown("above\n---\nbelow")
    assert "---" not in result
    assert "above" in result
    assert "below" in result


def test_strip_markdown_leaves_plain_text_unchanged():
    result = _strip_markdown("Use /bpm 140 to set tempo")
    assert result == "Use /bpm 140 to set tempo"


def test_strip_markdown_applied_in_answer_question():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client(
        "Use **bpm** command to set tempo\nIMPLEMENTABLE: NO"
    )
    answer = gen.answer_question("How do I set BPM?")
    assert "**" not in answer
    assert "bpm" in answer


# ── Feature 4: classify_as_implementable / answer_question_with_classify ────

def test_classify_as_implementable_returns_true():
    gen = Generator(AppState(), EventBus())
    gen._client = _make_mock_client("YES")
    assert gen.classify_as_implementable("Four-on-the-floor kick with snare on 2 and 4") is True


def test_classify_as_implementable_returns_false():
    gen = Generator(AppState(), EventBus())
    gen._client = _make_mock_client("NO")
    assert gen.classify_as_implementable("Use /bpm to set tempo") is False


def test_classify_as_implementable_returns_false_on_exception():
    gen = Generator(AppState(), EventBus())
    gen._client = MagicMock()
    gen._client.messages.create.side_effect = Exception("network error")
    assert gen.classify_as_implementable("anything") is False


def test_answer_question_with_classify_returns_tuple():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    combined = "Use /bpm 140 for techno\nIMPLEMENTABLE: YES"
    gen._client = _make_mock_client(combined)
    answer, is_impl = gen.answer_question_with_classify("give me a techno beat")
    assert gen._client.messages.create.call_count == 1
    assert "bpm" in answer.lower() or "140" in answer
    assert "IMPLEMENTABLE" not in answer
    assert is_impl is True


def test_answer_question_with_classify_false_for_info():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    combined = "Use /bpm to set tempo\nIMPLEMENTABLE: NO"
    gen._client = _make_mock_client(combined)
    answer, is_impl = gen.answer_question_with_classify("how do I set BPM?")
    assert gen._client.messages.create.call_count == 1
    assert is_impl is False


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


# ── P2-8: Genre awareness in system prompt ───────────────────────────────

def test_system_prompt_includes_expanded_genres():
    from core.generator import _build_system_prompt
    prompt = _build_system_prompt(16)
    # Should include new genres beyond original set
    assert "dub techno" in prompt
    assert "breakbeat" in prompt
    assert "house" in prompt
    assert "jungle" in prompt
    assert "EBM" in prompt
    assert "electro" in prompt
    assert "ambient" in prompt


def test_system_prompt_includes_genre_conventions():
    from core.generator import _build_system_prompt
    prompt = _build_system_prompt(16)
    assert "GENRE-SPECIFIC PATTERN CONVENTIONS" in prompt
    assert "four-on-the-floor" in prompt


# ── P2-9: Sound design guidance ───────────────────────────────────────

def test_system_prompt_includes_sound_design_guidance():
    from core.generator import _build_system_prompt
    _build_system_prompt.cache_clear()
    prompt = _build_system_prompt(16)
    assert "SOUND DESIGN GUIDANCE" in prompt
    assert "lowpass cutoff" in prompt
    assert "sample pitch" in prompt


def test_system_prompt_includes_808_909_hypnotic_and_producer_notes():
    from core.generator import _build_system_prompt
    _build_system_prompt.cache_clear()
    prompt = _build_system_prompt(16)
    assert "TR-808" in prompt
    assert "TR-909" in prompt
    assert "polyrhythm" in prompt
    assert "CLASSIC MACHINE CHARACTER" in prompt
    assert "producer_notes" in prompt


# ── Targeted track detection ──────────────────────────────────────────────────

def test_detect_target_tracks_exact():
    assert _detect_target_tracks("update the kick") == {"kick"}


def test_detect_target_tracks_alias_hats():
    assert _detect_target_tracks("make the hats brighter") == {"hihat"}


def test_detect_target_tracks_alias_bass_drum():
    assert _detect_target_tracks("tighten the bass drum") == {"kick"}


def test_detect_target_tracks_multi():
    assert _detect_target_tracks("kick and hihat only") == {"kick", "hihat"}


def test_detect_target_tracks_open_hihat_does_not_match_closed_hihat():
    assert _detect_target_tracks("update the open hihat only") == {"openhat"}


def test_detect_target_tracks_no_match():
    assert _detect_target_tracks("dark minimal techno") == set()


def test_detect_target_tracks_case_insensitive():
    assert _detect_target_tracks("Update The KICK") == {"kick"}


def test_detect_target_tracks_ride_verb_not_cymbal_alias():
    assert _detect_target_tracks("ride the filter down for a darker mix") == set()


def test_detect_target_tracks_oh_interjection_not_openhat_alias():
    assert _detect_target_tracks("oh make it darker and more minimal") == set()


# ── Constraint injection in _build_user_prompt ───────────────────────────────

def test_build_user_prompt_targeted_injects_constraint():
    state = AppState()
    state.last_prompt = "original prompt"
    state.current_pattern = VALID_PATTERN.copy()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("apply randomization to the kick", variation=True)

    assert "TARGETED UPDATE" in prompt
    assert "MODIFY" in prompt
    assert "kick" in prompt
    assert "PRESERVE" in prompt


def test_build_user_prompt_targeted_preserves_other_tracks():
    state = AppState()
    state.last_prompt = "original prompt"
    state.current_pattern = VALID_PATTERN.copy()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("update the hihat only", variation=True)

    assert "PRESERVE" in prompt
    assert "hihat" not in prompt.split("PRESERVE")[1].split("\n")[0]


def test_build_user_prompt_no_target_no_constraint():
    state = AppState()
    state.last_prompt = "original prompt"
    state.current_pattern = VALID_PATTERN.copy()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("make it darker", variation=True)

    assert "TARGETED UPDATE" not in prompt
    assert "PRESERVE" not in prompt


def test_build_user_prompt_fresh_no_constraint():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("update the kick", variation=False)

    assert "TARGETED UPDATE" not in prompt
    assert "PRESERVE" not in prompt


def test_system_prompt_includes_targeted_update_guidance():
    from core.generator import _build_system_prompt
    _build_system_prompt.cache_clear()
    prompt = _build_system_prompt(16)
    assert "TARGETED UPDATES" in prompt
    assert "PRESERVE" in prompt
    assert "amp envelope" in prompt


# ── Genre context injection ──────────────────────────────────────────────────

def test_detect_genre_ambient_aliases():
    assert _detect_genre("ambient pad loop") == "ambient"
    assert _detect_genre("dark ambient drone") == "ambient"
    assert _detect_genre("slow downtempo texture") == "ambient"
    assert _detect_genre("eerie soundscape") == "ambient"
    assert _detect_genre("DRONE layers please") == "ambient"


def test_detect_genre_no_match():
    assert _detect_genre("techno banger 135 bpm") is None
    assert _detect_genre("dub techno groove") is None
    assert _detect_genre("") is None


def test_detect_genre_word_boundary():
    # Substring without word boundary must not match.
    assert _detect_genre("ambientness") is None
    assert _detect_genre("dronebot") is None


def test_detect_genre_respects_negation_phrases():
    assert _detect_genre("not ambient please") is None
    assert _detect_genre("non-ambient techno groove") is None
    assert _detect_genre("without downtempo vibes") is None
    assert _detect_genre("no drone layers") is None


def test_detect_genre_first_mention_wins_with_multiple_genres():
    import core.generator as generator_module

    with patch.dict(
        generator_module._GENRE_ALIASES,
        {
            "ambient": ["ambient", "drone"],
            "industrial": ["industrial", "hard industrial"],
        },
        clear=True,
    ), patch.dict(
        generator_module._GENRE_CONTEXTS,
        {"ambient": "ambient ctx", "industrial": "industrial ctx"},
        clear=True,
    ):
        assert _detect_genre("industrial pulse then ambient wash") == "industrial"
        assert _detect_genre("ambient wash then industrial pulse") == "ambient"


def test_genre_registry_maps_have_identical_keys():
    assert set(_GENRE_ALIASES.keys()) == set(_GENRE_CONTEXTS.keys())


def test_build_user_prompt_injects_ambient_block_plain():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("deep ambient texture", variation=False)

    assert "AMBIENT MODE CONTEXT" in prompt
    assert "TRACK SAMPLES:" in prompt
    assert "REPURPOSED" in prompt
    # Ensure the original user request survives the prefix.
    assert "deep ambient texture" in prompt


def test_build_user_prompt_no_injection_when_no_genre_match():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("punchy minimal techno", variation=False)

    assert "AMBIENT MODE CONTEXT" not in prompt
    assert "TRACK SAMPLES:" not in prompt


def test_build_user_prompt_injects_ambient_block_with_state():
    state = AppState()
    state.bpm = 90
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt("slow downtempo pad", variation=False)

    assert "AMBIENT MODE CONTEXT" in prompt
    assert "Current state:" in prompt
    # Genre block must precede state context.
    assert prompt.index("AMBIENT MODE CONTEXT") < prompt.index("Current state:")


def test_build_user_prompt_ambient_composes_with_targeted_variation():
    state = AppState()
    state.last_prompt = "previous ambient drone"
    state.current_pattern = VALID_PATTERN.copy()
    bus = EventBus()
    gen = Generator(state, bus)

    prompt = gen._build_user_prompt(
        "make the bell more ambient and sparse", variation=True
    )

    assert "AMBIENT MODE CONTEXT" in prompt
    assert "TARGETED UPDATE" in prompt
    assert "Apply this variation:" in prompt
    # Genre block should come before the TARGETED UPDATE block.
    assert prompt.index("AMBIENT MODE CONTEXT") < prompt.index("TARGETED UPDATE")
