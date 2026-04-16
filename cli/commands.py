# cli/commands.py
from __future__ import annotations

import copy
import random
import re

TRACK_NAMES = ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]


def _pattern_length(pattern: dict) -> int:
    for track in TRACK_NAMES:
        vals = pattern.get(track)
        if isinstance(vals, list):
            return len(vals)
    return 16


def parse_random_range(range_str: str | None, param: str) -> tuple[int, int]:
    """
    Parse a range string like "[40-60]" into (lo, hi).

    Args:
        range_str: String like "[40-60]" or None
        param: "velocity" or "prob" — determines defaults and bounds

    Returns:
        (lo, hi) tuple

    Raises:
        ValueError: Bad format, inverted range, or out-of-domain
    """
    # Default ranges
    if range_str is None:
        if param == "velocity":
            return (0, 127)
        elif param == "prob":
            return (0, 100)
        else:
            raise ValueError(f"Unknown parameter: {param}")

    # Parse "[lo-hi]" format
    match = re.match(r"^\[(\d+)-(\d+)\]$", range_str.strip())
    if not match:
        raise ValueError(
            f"Invalid range format: '{range_str}'. Expected '[lo-hi]' (e.g., '[40-60]')"
        )

    lo, hi = int(match.group(1)), int(match.group(2))

    # Check inverted range
    if lo > hi:
        raise ValueError(
            f"Inverted range: lo={lo} > hi={hi}. Expected lo <= hi."
        )

    # Check domain bounds
    if param == "velocity":
        if lo < 0 or hi > 127:
            raise ValueError(
                f"Velocity out of range: [{lo}-{hi}]. Valid range: [0-127]"
            )
    elif param == "prob":
        if lo < 0 or hi > 100:
            raise ValueError(
                f"Probability out of range: [{lo}-{hi}]. Valid range: [0-100]"
            )
    else:
        raise ValueError(f"Unknown parameter: {param}")

    return (lo, hi)


def apply_random_velocity(
    pattern: dict, tracks: list[str], lo: int, hi: int
) -> dict:
    """
    Randomize velocity for non-zero steps in specified tracks.

    Args:
        pattern: Pattern dict
        tracks: List of track names, or ["all"] to apply to all 8 tracks
        lo: Lower bound (inclusive)
        hi: Upper bound (inclusive)

    Returns:
        New pattern dict with randomized velocities (preserves silence)
    """
    result = copy.deepcopy(pattern)

    # Expand "all" to all track names
    target_tracks = TRACK_NAMES if "all" in tracks else tracks

    for track in target_tracks:
        if track not in result:
            continue

        for step in range(len(result[track])):
            # Only randomize non-zero steps (preserve silence)
            if result[track][step] > 0:
                result[track][step] = random.randint(lo, hi)

    return result


def apply_random_prob(
    pattern: dict, tracks: list[str], lo: int, hi: int
) -> dict:
    """
    Randomize probability for all steps in specified tracks.

    Args:
        pattern: Pattern dict
        tracks: List of track names, or ["all"] to apply to all 8 tracks
        lo: Lower bound (inclusive)
        hi: Upper bound (inclusive)

    Returns:
        New pattern dict with randomized probabilities
    """
    result = copy.deepcopy(pattern)

    # Initialize prob dict if not present
    if "prob" not in result:
        result["prob"] = {}

    # Expand "all" to all track names
    target_tracks = TRACK_NAMES if "all" in tracks else tracks
    length = _pattern_length(result)

    for track in target_tracks:
        # Initialize track's prob list if not present
        if track not in result["prob"]:
            result["prob"][track] = [100] * length

        if len(result["prob"][track]) < length:
            result["prob"][track] += [100] * (length - len(result["prob"][track]))
        elif len(result["prob"][track]) > length:
            result["prob"][track] = result["prob"][track][:length]

        for step in range(length):
            result["prob"][track][step] = random.randint(lo, hi)

    return result


def apply_prob_step(pattern: dict, track: str, step: int, value: int) -> dict:
    """
    Set probability for a single step (0-indexed).

    Args:
        pattern: Pattern dict
        track: Track name
        step: Step index (0-15)
        value: Probability value (0-100)

    Returns:
        New pattern dict with updated probability
    """
    result = copy.deepcopy(pattern)

    # Initialize prob dict if not present
    if "prob" not in result:
        result["prob"] = {}
    length = _pattern_length(result)

    # Initialize track's prob list if not present
    if track not in result["prob"]:
        result["prob"][track] = [100] * length
    elif len(result["prob"][track]) < length:
        result["prob"][track] += [100] * (length - len(result["prob"][track]))
    elif len(result["prob"][track]) > length:
        result["prob"][track] = result["prob"][track][:length]

    result["prob"][track][step] = value
    return result


def apply_prob_track(pattern: dict, track: str, value: int) -> dict:
    """Set probability to the same value on every step for one track (0–100)."""
    if not (0 <= value <= 100):
        raise ValueError(f"Probability must be 0–100, got {value}")
    result = copy.deepcopy(pattern)
    if "prob" not in result:
        result["prob"] = {}
    length = _pattern_length(result)
    if track not in result["prob"]:
        result["prob"][track] = [100] * length
    elif len(result["prob"][track]) < length:
        result["prob"][track] += [100] * (length - len(result["prob"][track]))
    elif len(result["prob"][track]) > length:
        result["prob"][track] = result["prob"][track][:length]
    for step in range(length):
        result["prob"][track][step] = value
    return result


def apply_vel_step(pattern: dict, track: str, step: int, value: int) -> dict:
    """
    Set velocity for a single step (0-indexed).

    Args:
        pattern: Pattern dict
        track: Track name
        step: Step index (0-15)
        value: Velocity value (0-127)

    Returns:
        New pattern dict with updated velocity
    """
    result = copy.deepcopy(pattern)
    length = _pattern_length(result)

    if track not in result:
        result[track] = [0] * length

    result[track][step] = value
    return result


def apply_vel_track(pattern: dict, track: str, value: int) -> dict:
    """Set step velocity to the same value on every step for one track (0–127)."""
    if not (0 <= value <= 127):
        raise ValueError(f"Velocity must be 0–127, got {value}")
    result = copy.deepcopy(pattern)
    length = _pattern_length(result)
    if track not in result:
        result[track] = [0] * length
    elif len(result[track]) < length:
        result[track] += [0] * (length - len(result[track]))
    elif len(result[track]) > length:
        result[track] = result[track][:length]
    for step in range(length):
        result[track][step] = value
    return result


def apply_cc_step(pattern: dict, track: str, param: str, step: int, value: int | None) -> dict:
    """
    Set or clear a per-step CC override.

    Args:
        pattern: Pattern dict
        track: Track name
        param: CC param name (e.g. "filter")
        step: Step index (0-15)
        value: CC value (0-127), or None to clear the override

    Returns:
        New pattern dict with updated step_cc
    """
    result = copy.deepcopy(pattern)
    length = _pattern_length(result)
    if "step_cc" not in result:
        result["step_cc"] = {}
    if track not in result["step_cc"]:
        result["step_cc"][track] = {}
    if param not in result["step_cc"][track]:
        result["step_cc"][track][param] = [None] * length
    elif len(result["step_cc"][track][param]) < length:
        result["step_cc"][track][param] += [None] * (length - len(result["step_cc"][track][param]))
    elif len(result["step_cc"][track][param]) > length:
        result["step_cc"][track][param] = result["step_cc"][track][param][:length]
    result["step_cc"][track][param][step] = value
    return result


def apply_gate_step(pattern: dict, track: str, step: int, value: int) -> dict:
    """Set gate (0–100) for a single step. 100 = full step duration, 0 = immediate note_off."""
    if not (0 <= value <= 100):
        raise ValueError(f"Gate value must be 0–100, got {value}")
    pattern = dict(pattern)
    if "gate" not in pattern:
        length = len(pattern.get("kick", [None] * 16))
        pattern["gate"] = {t: [100] * length for t in TRACK_NAMES}
    pattern["gate"] = dict(pattern["gate"])
    pattern["gate"][track] = list(pattern["gate"][track])
    pattern["gate"][track][step] = value
    return pattern


def apply_gate_track(pattern: dict, track: str, value: int) -> dict:
    """Set gate (0–100) to the same value on every step for one track."""
    if not (0 <= value <= 100):
        raise ValueError(f"Gate value must be 0–100, got {value}")
    pattern = copy.deepcopy(pattern)
    if "gate" not in pattern:
        length = len(pattern.get("kick", [None] * 16))
        pattern["gate"] = {t: [100] * length for t in TRACK_NAMES}
    pattern["gate"] = dict(pattern["gate"])
    length = _pattern_length(pattern)
    if track not in pattern["gate"]:
        pattern["gate"][track] = [100] * length
    row = list(pattern["gate"][track])
    if len(row) < length:
        row += [100] * (length - len(row))
    elif len(row) > length:
        row = row[:length]
    for step in range(length):
        row[step] = value
    pattern["gate"][track] = row
    return pattern


_VALID_CONDITIONS = frozenset({"1:2", "not:2", "fill"})


def apply_cond_step(pattern: dict, track: str, step: int, value: "str | None") -> dict:
    """Set or clear a conditional trig on a step. value must be '1:2', 'not:2', 'fill', or None."""
    if value is not None and value not in _VALID_CONDITIONS:
        raise ValueError(f"Unknown condition '{value}'. Valid: {sorted(_VALID_CONDITIONS)}")
    pattern = dict(pattern)
    length = len(pattern.get("kick", [None] * 16))
    if "cond" not in pattern:
        pattern["cond"] = {t: [None] * length for t in TRACK_NAMES}
    pattern["cond"] = dict(pattern["cond"])
    pattern["cond"][track] = list(pattern["cond"][track])
    pattern["cond"][track][step] = value
    return pattern


def apply_swing(pattern: dict, amount: int) -> dict:
    """
    Set swing amount.

    Args:
        pattern: Pattern dict
        amount: Swing amount (typically 0-100)

    Returns:
        New pattern dict with updated swing
    """
    result = copy.deepcopy(pattern)
    result["swing"] = amount
    return result


def generate_random_beat() -> tuple[dict, int, int, dict]:
    """
    Generate a structurally valid random techno beat.

    Returns:
        (pattern, bpm, swing, cc_changes)
        - pattern: dict mapping track name → list of 16 velocity ints (0-127)
        - bpm: int in [128, 160]
        - swing: int in [0, 30]
        - cc_changes: {track: {param: value}} for all 8 tracks
    """
    bpm = random.randint(128, 160)
    swing = random.randint(0, 30)

    pattern: dict = {track: [0] * 16 for track in TRACK_NAMES}

    # Kick: 4-on-the-floor (steps 0,4,8,12) always on + 0-2 extra hits
    for step in [0, 4, 8, 12]:
        pattern["kick"][step] = random.randint(90, 127)
    extra_kick = [s for s in range(16) if s not in (0, 4, 8, 12)]
    for step in random.sample(extra_kick, random.randint(0, 2)):
        pattern["kick"][step] = random.randint(60, 90)

    # Snare: backbeats (steps 4, 12) + 0-3 ghost notes at lower velocity
    pattern["snare"][4] = random.randint(90, 127)
    pattern["snare"][12] = random.randint(90, 127)
    ghost_candidates = [s for s in range(16) if s not in (4, 12)]
    for step in random.sample(ghost_candidates, random.randint(0, 3)):
        pattern["snare"][step] = random.randint(15, 45)

    # Hihat: 8th notes (every 2 steps) or 16th notes (all steps)
    hat_steps = list(range(0, 16, 2)) if random.random() < 0.5 else list(range(16))
    for step in hat_steps:
        pattern["hihat"][step] = random.randint(40, 100)
    for step in random.sample(hat_steps, min(3, len(hat_steps))):
        pattern["hihat"][step] = min(127, pattern["hihat"][step] + random.randint(10, 30))

    # Openhat: 1-3 sparse hits, not on kick downbeats
    openhat_candidates = [s for s in range(16) if s not in {0, 4, 8, 12}]
    for step in random.sample(openhat_candidates, random.randint(1, 3)):
        pattern["openhat"][step] = random.randint(60, 90)

    # Clap: 0-2 hits
    for step in random.sample(range(16), random.randint(0, 2)):
        pattern["clap"][step] = random.randint(50, 90)

    # Tom, bell, cymbal: 0-2 hits each
    for track in ("tom", "bell", "cymbal"):
        for step in random.sample(range(16), random.randint(0, 2)):
            pattern[track][step] = random.randint(30, 80)

    # CC for all tracks
    cc_changes: dict = {}
    for track in TRACK_NAMES:
        cc_changes[track] = {
            "filter":    random.randint(40, 110),
            "resonance": random.randint(20, 80),
            "decay":     random.randint(30, 100),
            "tune":      random.randint(58, 70),
            "reverb":    random.randint(0, 40),
            "delay":     random.randint(0, 30),
            "attack":    random.randint(0, 30),
            "volume":    100,
        }

    return pattern, bpm, swing, cc_changes
