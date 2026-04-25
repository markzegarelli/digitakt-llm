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
    """LFO v1: sweep around static base by ±half of [lo,hi] at depth 100%, then clamp."""
    half = (hi - lo) / 2.0
    v = int(round(float(base) + w * (depth_pct / 100.0) * half))
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


def lfo_mod_w(
    ldef: dict, pattern_length: int, global_step: int
) -> tuple[float, int] | None:
    """Parse a LfoDef dict into (bipolar w, depth 0..100) or None if invalid."""
    if not isinstance(ldef, dict):
        return None
    rate = ldef.get("rate") if isinstance(ldef.get("rate"), dict) else {}
    try:
        num = int(rate.get("num", 1))
        den = int(rate.get("den", 1))
    except (TypeError, ValueError):
        return None
    try:
        csn = cycle_steps(pattern_length, num, den)
    except ValueError:
        return None
    shape = ldef.get("shape", "sine")
    if not isinstance(shape, str):
        return None
    try:
        depth = int(ldef.get("depth", 0))
    except (TypeError, ValueError):
        depth = 0
    depth = max(0, min(100, depth))
    try:
        phase = float(ldef.get("phase", 0.0))
    except (TypeError, ValueError):
        phase = 0.0
    try:
        w = lfo_w_at_step(global_step, csn, phase, shape)
    except ValueError:
        return None
    return (w, depth)


def _lfo_target_key_valid(key: str) -> bool:
    """Match `cli.commands.validate_lfo_target_key` without importing cli (avoids import cycles)."""
    from core.midi_utils import CC_MAP
    from core.state import TRACK_NAMES

    trig_fields = frozenset({"prob", "vel", "gate", "note"})
    parts = key.split(":")
    if len(parts) != 3:
        return False
    kind, track, rest = parts
    if track not in TRACK_NAMES:
        return False
    if kind == "cc":
        return rest in CC_MAP
    if kind == "trig":
        return rest in trig_fields
    if kind == "pitch":
        return rest == "main"
    return False


def sanitize_lfo_in_pattern(result: dict, pattern_length: int) -> None:
    """Drop invalid `lfo` routes (bad key grammar, unknown shape/rate, etc.) in-place."""
    block = result.get("lfo")
    if not isinstance(block, dict):
        return
    new_block: dict = {}
    for k, v in block.items():
        if not isinstance(v, dict):
            continue
        if not _lfo_target_key_valid(k):
            continue
        if lfo_mod_w(v, pattern_length, 0) is None:
            continue
        new_block[k] = v
    if new_block:
        result["lfo"] = new_block
    else:
        result.pop("lfo", None)
