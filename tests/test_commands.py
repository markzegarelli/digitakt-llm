# tests/test_commands.py
import copy
import pytest

from cli.commands import (
    parse_random_range,
    apply_random_velocity,
    apply_random_prob,
    apply_prob_step,
    apply_vel_step,
    apply_swing,
    generate_random_beat,
    apply_gate_step,
    apply_cond_step,
)
from core.state import TRACK_NAMES


FIXTURE_PATTERN = {
    "kick":    [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
    "snare":   [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
    "tom":     [0] * 16,
    "clap":    [0] * 16,
    "bell":    [0] * 16,
    "hihat":   [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
    "openhat": [0] * 16,
    "cymbal":  [0] * 16,
}


def _fresh_pattern():
    return copy.deepcopy(FIXTURE_PATTERN)


# ── parse_random_range ────────────────────────────────────────────────────────

def test_parse_range_explicit():
    assert parse_random_range("[40-60]", "velocity") == (40, 60)


def test_parse_range_none_velocity_defaults():
    assert parse_random_range(None, "velocity") == (0, 127)


def test_parse_range_none_prob_defaults():
    assert parse_random_range(None, "prob") == (0, 100)


def test_parse_range_bad_format_raises():
    # Missing brackets
    with pytest.raises(ValueError):
        parse_random_range("40-60", "velocity")


def test_parse_range_inverted_raises():
    with pytest.raises(ValueError):
        parse_random_range("[60-40]", "velocity")


def test_parse_range_out_of_domain_raises():
    # 200 > 127 for velocity
    with pytest.raises(ValueError):
        parse_random_range("[0-200]", "velocity")


# ── apply_random_velocity ─────────────────────────────────────────────────────

def test_apply_random_velocity_preserves_silent_steps():
    pattern = _fresh_pattern()
    result = apply_random_velocity(pattern, ["kick"], lo=50, hi=100)
    for i, v in enumerate(result["kick"]):
        if pattern["kick"][i] == 0:
            assert v == 0, f"Silent step {i} should remain 0"


def test_apply_random_velocity_modifies_active_steps_in_range():
    pattern = _fresh_pattern()
    # lo == hi makes it deterministic
    result = apply_random_velocity(pattern, ["kick"], lo=50, hi=50)
    for i, v in enumerate(result["kick"]):
        if pattern["kick"][i] > 0:
            assert v == 50, f"Active step {i} should be 50"


def test_apply_random_velocity_all_tracks():
    pattern = _fresh_pattern()
    result = apply_random_velocity(pattern, ["all"], lo=77, hi=77)
    for track in TRACK_NAMES:
        for i, v in enumerate(result[track]):
            if pattern[track][i] > 0:
                assert v == 77, f"{track} step {i} should be 77"


# ── apply_random_prob ─────────────────────────────────────────────────────────

def test_apply_random_prob_sets_16_values_in_range():
    pattern = _fresh_pattern()
    result = apply_random_prob(pattern, ["kick"], lo=50, hi=50)
    assert len(result["prob"]["kick"]) == 16
    assert all(v == 50 for v in result["prob"]["kick"])


# ── apply_prob_step ───────────────────────────────────────────────────────────

def test_apply_prob_step_sets_correct_index():
    pattern = _fresh_pattern()
    result = apply_prob_step(pattern, "kick", 3, 75)
    assert result["prob"]["kick"][3] == 75


# ── apply_vel_step ────────────────────────────────────────────────────────────

def test_apply_vel_step_sets_correct_index():
    pattern = _fresh_pattern()
    result = apply_vel_step(pattern, "kick", 5, 99)
    assert result["kick"][5] == 99


# ── apply_swing ───────────────────────────────────────────────────────────────

def test_apply_swing_sets_value():
    pattern = _fresh_pattern()
    result = apply_swing(pattern, 42)
    assert result["swing"] == 42


# ── immutability ──────────────────────────────────────────────────────────────

def test_apply_functions_do_not_mutate_input():
    original = _fresh_pattern()
    snapshot = copy.deepcopy(original)

    apply_random_velocity(original, ["kick"], lo=50, hi=50)
    assert original["kick"] == snapshot["kick"]

    apply_random_prob(original, ["kick"], lo=50, hi=50)
    assert "prob" not in original

    apply_prob_step(original, "kick", 3, 75)
    assert "prob" not in original

    apply_vel_step(original, "kick", 5, 99)
    assert original["kick"][5] == snapshot["kick"][5]

    apply_swing(original, 42)
    assert "swing" not in original


# ── generate_random_beat ──────────────────────────────────────────────────────

def test_randbeat_returns_four_values():
    result = generate_random_beat()
    assert len(result) == 4
    pattern, bpm, swing, cc_changes = result


def test_randbeat_pattern_has_all_tracks():
    pattern, *_ = generate_random_beat()
    for track in ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]:
        assert track in pattern
        assert len(pattern[track]) == 16


def test_randbeat_kick_on_four_on_the_floor():
    for _ in range(10):  # run multiple times — structural guarantee
        pattern, *_ = generate_random_beat()
        for step in [0, 4, 8, 12]:
            assert pattern["kick"][step] > 0, f"kick missing at step {step}"


def test_randbeat_snare_on_backbeats():
    for _ in range(10):
        pattern, *_ = generate_random_beat()
        assert pattern["snare"][4] > 0, "snare missing at step 4"
        assert pattern["snare"][12] > 0, "snare missing at step 12"


def test_randbeat_bpm_in_techno_range():
    for _ in range(20):
        _, bpm, *_ = generate_random_beat()
        assert 128 <= bpm <= 160, f"BPM {bpm} out of range"


def test_randbeat_swing_in_range():
    for _ in range(20):
        _, _, swing, _ = generate_random_beat()
        assert 0 <= swing <= 30, f"swing {swing} out of range"


def test_randbeat_all_velocities_valid():
    pattern, *_ = generate_random_beat()
    for track in ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]:
        for i, v in enumerate(pattern[track]):
            assert 0 <= v <= 127, f"{track}[{i}] = {v} out of range"


def test_randbeat_cc_has_all_tracks():
    _, _, _, cc_changes = generate_random_beat()
    for track in ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]:
        assert track in cc_changes


def test_randbeat_cc_values_in_range():
    _, _, _, cc_changes = generate_random_beat()
    ranges = {
        "filter":    (40, 110),
        "resonance": (20, 80),
        "decay":     (30, 100),
        "tune":      (58, 70),
        "reverb":    (0, 40),
        "delay":     (0, 30),
        "attack":    (0, 30),
        "volume":    (100, 100),
    }
    for track, params in cc_changes.items():
        for param, value in params.items():
            lo, hi = ranges[param]
            assert lo <= value <= hi, f"{track}.{param} = {value} out of [{lo},{hi}]"


def test_randbeat_hihat_has_hits():
    # hihat must have at least some steps active (8th or 16th pattern)
    for _ in range(10):
        pattern, *_ = generate_random_beat()
        assert any(v > 0 for v in pattern["hihat"]), "hihat has no hits"


# ── apply_gate_step ───────────────────────────────────────────────────────────

def test_apply_gate_step_sets_value():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    result = apply_gate_step(pattern, "kick", 0, 50)
    assert result["gate"]["kick"][0] == 50


def test_apply_gate_step_creates_gate_key_if_missing():
    pattern = {k: [64] * 16 for k in TRACK_NAMES}
    result = apply_gate_step(pattern, "hihat", 3, 75)
    assert "gate" in result
    assert result["gate"]["hihat"][3] == 75
    # Other steps default to 100
    assert result["gate"]["hihat"][0] == 100


def test_apply_gate_step_rejects_out_of_range():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    with pytest.raises(ValueError):
        apply_gate_step(pattern, "kick", 0, 101)


# ── apply_cond_step ───────────────────────────────────────────────────────────

def test_apply_cond_step_sets_condition():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    result = apply_cond_step(pattern, "kick", 0, "1:2")
    assert result["cond"]["kick"][0] == "1:2"


def test_apply_cond_step_clears_condition():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["cond"] = {"kick": ["1:2"] + [None] * 15}
    result = apply_cond_step(pattern, "kick", 0, None)
    assert result["cond"]["kick"][0] is None


def test_apply_cond_step_rejects_unknown_condition():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    with pytest.raises(ValueError):
        apply_cond_step(pattern, "kick", 0, "bogus")
