import pytest

from core.lfo import SHAPES, cycle_steps, lfo_shape, lfo_w_at_step


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
