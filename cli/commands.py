# cli/commands.py
from __future__ import annotations

import copy
import random
import re

TRACK_NAMES = ["kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal"]


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

    for track in target_tracks:
        # Initialize track's prob list if not present
        if track not in result["prob"]:
            result["prob"][track] = [100] * 16

        for step in range(16):
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

    # Initialize track's prob list if not present
    if track not in result["prob"]:
        result["prob"][track] = [100] * 16

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

    if track not in result:
        result[track] = [0] * 16

    result[track][step] = value
    return result


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
