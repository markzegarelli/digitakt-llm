from __future__ import annotations

import math

SHAPES = ("sine", "square", "triangle", "ramp", "saw")


def _norm_p(p: float) -> float:
    x = p % 1.0
    return x + 0.0 if x >= 0 else x + 1.0


def lfo_shape(shape: str, p: float) -> float:
    p = _norm_p(p)
    if shape == "sine":
        return math.sin(2.0 * math.pi * p)
    if shape == "triangle":
        if p < 0.5:
            return 4.0 * p - 1.0
        return 3.0 - 4.0 * p
    if shape == "square":
        return 1.0 if p < 0.5 else -1.0
    if shape == "ramp":
        return 2.0 * p - 1.0
    if shape == "saw":
        return 1.0 - 2.0 * p
    raise ValueError(f"unknown shape: {shape!r}")


def apply_depth_clamp(base: int, w: float, depth_pct: int, lo: int, hi: int) -> int:
    """Map bipolar w in [-1, 1] and depth 0..100 to [lo, hi] via range midpoint (see LFO v1 plan)."""
    _ = base  # reserved for static anchor when player combines LFO with per-step base CC
    mid = (lo + hi) / 2.0
    half = (hi - lo) / 2.0
    v = int(round(mid + w * (depth_pct / 100.0) * half))
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def cycle_steps(pattern_length: int, num: int, den: int) -> int:
    if num < 1 or den < 1:
        raise ValueError("num and den must be >= 1")
    return max(1, (pattern_length * num) // den)


def lfo_w_at_step(
    global_step: int,
    cycle_steps_n: int,
    phase: float,
    shape: str,
) -> float:
    p = (global_step % cycle_steps_n) / float(cycle_steps_n)
    p = _norm_p(p + phase)
    return lfo_shape(shape, p)
