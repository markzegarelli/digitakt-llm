import pytest

from core.lfo import SHAPES, apply_depth_clamp, cycle_steps, lfo_mod_w, lfo_shape, lfo_w_at_step
from core.state import AppState, EMPTY_PATTERN


def test_sine_0_is_zero():
    assert lfo_shape("sine", 0.0) == pytest.approx(0, abs=1e-9)


def test_triangle_quarter():
    assert lfo_shape("triangle", 0.25) == pytest.approx(0, abs=1e-9)


def test_square_low_half():
    assert lfo_shape("square", 0.1) == 1.0
    assert lfo_shape("square", 0.6) == -1.0


def test_ramp_endpoints():
    assert lfo_shape("ramp", 0.0) == -1.0
    assert lfo_shape("ramp", 1.0 - 1e-12) == pytest.approx(1.0, abs=1e-9)


def test_saw_basic():
    assert lfo_shape("saw", 0.0) == pytest.approx(1.0, abs=1e-9)
    assert lfo_shape("saw", 0.5) == pytest.approx(0.0, abs=1e-9)
    assert lfo_shape("saw", 0.75) == pytest.approx(-0.5, abs=1e-9)


def test_lfo_shape_wraps_p():
    assert lfo_shape("ramp", 0.0) == lfo_shape("ramp", 1.0)
    assert lfo_shape("sine", 0.25) == lfo_shape("sine", 1.25)


def test_cycle_steps_16_1_4():
    assert cycle_steps(16, 1, 4) == 4


def test_cycle_steps_invalid_num_den():
    with pytest.raises(ValueError, match="num and den must be >= 1"):
        cycle_steps(16, 0, 1)
    with pytest.raises(ValueError, match="num and den must be >= 1"):
        cycle_steps(16, 1, 0)


def test_lfo_w_at_step_four_step_sine():
    n = 4
    for step, expected in [
        (0, 0.0),
        (1, 1.0),
        (2, 0.0),
        (3, -1.0),
    ]:
        assert lfo_w_at_step(step, n, 0.0, "sine") == pytest.approx(expected, abs=1e-9)


def test_lfo_w_at_step_respects_phase():
    n = 4
    w0 = lfo_w_at_step(0, n, 0.0, "ramp")
    w_shift = lfo_w_at_step(0, n, 0.25, "ramp")
    assert w0 == pytest.approx(-1.0, abs=1e-9)
    assert w_shift == lfo_shape("ramp", 0.25)


def test_shapes_tuple():
    assert "sine" in SHAPES
    assert set(SHAPES) == {"sine", "square", "triangle", "ramp", "saw"}


def test_unknown_shape_raises():
    with pytest.raises(ValueError, match="unknown shape"):
        lfo_shape("nope", 0.0)


def test_lfo_mod_w_returns_w_depth():
    m = lfo_mod_w(
        {
            "shape": "ramp",
            "depth": 50,
            "phase": 0.0,
            "rate": {"num": 1, "den": 1},
        },
        16,
        0,
    )
    assert m is not None
    w, d = m
    assert w == -1.0
    assert d == 50


def test_apply_depth_clamp_w_positive_full_depth():
    assert apply_depth_clamp(64, 1.0, 100, 0, 127) == 127


def test_apply_depth_clamp_w_zero_returns_base():
    assert apply_depth_clamp(64, 0, 100, 0, 127) == 64


def test_apply_depth_clamp_w_negative_full_depth():
    assert apply_depth_clamp(64, -1.0, 100, 0, 127) == 0


def test_apply_depth_clamp_zero_depth_ignores_w():
    assert apply_depth_clamp(0, 1.0, 0, 0, 127) == 0
    assert apply_depth_clamp(100, -1.0, 0, 0, 127) == 100


def test_apply_depth_clamp_clamps_narrow_range():
    # full swing ±5 around base 5 → 10 at w=+1, 0 at w=-1
    assert apply_depth_clamp(5, 1.0, 100, 0, 10) == 10
    assert apply_depth_clamp(5, -1.0, 100, 0, 10) == 0


def test_lfo_preserved_in_replace_current_pattern():
    lfo = {
        "cc:kick:filter": {
            "shape": "sine",
            "depth": 50,
            "phase": 0.0,
            "rate": {"num": 1, "den": 1},
        }
    }
    pat = {**EMPTY_PATTERN, "lfo": lfo}
    state = AppState()
    state.replace_current_pattern(pat)
    assert state.current_pattern["lfo"] == lfo
