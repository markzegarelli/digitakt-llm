"""Bjorklund Euclidean rhythms for alternate sequencing mode."""

from __future__ import annotations

from typing import Any

SEQ_MODE_STANDARD = "standard"
SEQ_MODE_EUCLIDEAN = "euclidean"
VALID_SEQ_MODES = frozenset({SEQ_MODE_STANDARD, SEQ_MODE_EUCLIDEAN})

EUCLID_STRIP_MODE_GRID = "grid"
EUCLID_STRIP_MODE_FRACTIONAL = "fractional"

_EUCLID_N_MAX = 16
_EUCLID_N_MIN = 1


def bjorklund(k: int, n: int) -> list[bool]:
    """Return length-`n` boolean list with exactly `k` True values (Euclidean / Bjorklund).

    Uses the usual ``(i * k) % n < k`` characterization (0-based step index ``i``): the first
    pulse is always at step 0 when ``k > 0``, e.g. E(4, 16) hits 0, 4, 8, 12.
    """
    if n < 1:
        raise ValueError("n must be at least 1")
    k = int(k)
    n = int(n)
    if k < 0 or k > n:
        raise ValueError("k must satisfy 0 <= k <= n")
    if k == 0:
        return [False] * n
    if k == n:
        return [True] * n
    return [((i * k) % n) < k for i in range(n)]


def rhythm_hit(k: int, n: int, r: int, step: int) -> bool:
    """True if master step `step` (0-based) falls on a Euclidean pulse after rotation `r`."""
    k, n, r = int(k), int(n), int(r)
    if n < 1:
        return False
    ring = bjorklund(k, n)
    local = (int(step) + r) % n
    return bool(ring[local])


def clamp_euclid_triplet(k: int, n: int, r: int) -> tuple[int, int, int]:
    """Clamp k/n/r to valid ranges; k is clamped to [0, n]."""
    n = max(_EUCLID_N_MIN, min(int(n), _EUCLID_N_MAX))
    k = max(0, min(int(k), n))
    r = int(r)
    if n:
        r %= n
    else:
        r = 0
    return k, n, r


def default_euclid_block(pattern_length: int, track_names: tuple[str, ...]) -> dict[str, dict[str, int]]:
    """Default Euclidean params: silent rings until a track is explicitly armed."""
    n = max(_EUCLID_N_MIN, min(int(pattern_length), _EUCLID_N_MAX))
    return {t: {"k": 0, "n": n, "r": 0} for t in track_names}


def normalize_seq_mode(raw: Any) -> str:
    if raw == SEQ_MODE_EUCLIDEAN:
        return SEQ_MODE_EUCLIDEAN
    return SEQ_MODE_STANDARD


def normalize_euclid_strip_mode(raw: Any) -> str:
    """Strip UI only: `grid` (pattern-length columns) or `fractional` (n equal columns). Unknown → grid."""
    if raw == EUCLID_STRIP_MODE_FRACTIONAL:
        return EUCLID_STRIP_MODE_FRACTIONAL
    return EUCLID_STRIP_MODE_GRID


def normalize_euclid_in_pattern(
    pattern: dict, pattern_length: int, track_names: tuple[str, ...]
) -> None:
    """In-place: ensure `seq_mode`, `euclid`, `euclid_strip_mode` keys exist and triplets are clamped."""
    pattern["seq_mode"] = normalize_seq_mode(pattern.get("seq_mode"))
    block = pattern.get("euclid")
    if not isinstance(block, dict):
        pattern["euclid"] = default_euclid_block(pattern_length, track_names)
    else:
        pl = max(_EUCLID_N_MIN, min(int(pattern_length), _EUCLID_N_MAX))
        defaults = default_euclid_block(pl, track_names)
        new_block: dict[str, dict[str, int]] = {}
        for t in track_names:
            row = block.get(t)
            if not isinstance(row, dict):
                new_block[t] = defaults[t].copy()
                continue
            k = row.get("k", defaults[t]["k"])
            n = row.get("n", defaults[t]["n"])
            r = row.get("r", 0)
            try:
                k_i, n_i, r_i = clamp_euclid_triplet(int(k), int(n), int(r))
            except (TypeError, ValueError):
                new_block[t] = defaults[t].copy()
                continue
            new_block[t] = {"k": k_i, "n": n_i, "r": r_i}
        pattern["euclid"] = new_block
    pattern["euclid_strip_mode"] = normalize_euclid_strip_mode(pattern.get("euclid_strip_mode"))


def track_euclidean_hit(pattern: dict, track: str, step: int) -> bool:
    """Whether `track` has a Euclidean pulse at master step `step` (only meaningful in euclidean seq_mode)."""
    eu = pattern.get("euclid")
    if not isinstance(eu, dict):
        return True
    row = eu.get(track)
    if not isinstance(row, dict):
        return True
    try:
        k = int(row.get("k", 0))
        n = int(row.get("n", 1))
        r = int(row.get("r", 0))
    except (TypeError, ValueError):
        return True
    k, n, r = clamp_euclid_triplet(k, n, r)
    if k == 0:
        return False
    if k == n:
        return True
    return rhythm_hit(k, n, r, step)
