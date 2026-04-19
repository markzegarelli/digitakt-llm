# core/pattern_snapshot.py
"""Serialize / deserialize full session data alongside the step pattern for named saves."""
from __future__ import annotations

import copy
from typing import Any

from cli.commands import apply_swing
from core.state import AppState, TRACK_NAMES

SAVE_FORMAT_VERSION = 2


def build_save_file_dict(state: AppState, pattern: dict, tags: list[str], saved_at: str) -> dict[str, Any]:
    swing_raw = state.current_pattern.get("swing", 0) if isinstance(state.current_pattern, dict) else 0
    swing_val = int(swing_raw) if isinstance(swing_raw, (int, float)) else 0
    return {
        "version": SAVE_FORMAT_VERSION,
        "pattern": copy.deepcopy(pattern),
        "tags": tags,
        "saved_at": saved_at,
        "bpm": state.bpm,
        "swing": swing_val,
        "pattern_length": state.pattern_length,
        "track_cc": copy.deepcopy(state.track_cc),
        "track_velocity": copy.deepcopy(state.track_velocity),
        "track_pitch": copy.deepcopy(state.track_pitch),
        "track_muted": copy.deepcopy(state.track_muted),
    }


def extract_pattern_from_saved_json(data: Any) -> dict:
    """Return the step pattern dict from a saved JSON object (v2 wrapper or legacy)."""
    if isinstance(data, dict) and "pattern" in data and isinstance(data["pattern"], dict):
        return copy.deepcopy(data["pattern"])
    if isinstance(data, dict):
        return copy.deepcopy(data)
    raise TypeError("saved pattern JSON must be an object")


def parse_session_snapshot(data: Any) -> dict[str, Any] | None:
    """If the file includes a v2 session snapshot, return its fields; else None."""
    if not isinstance(data, dict) or data.get("version") != SAVE_FORMAT_VERSION:
        return None
    snap: dict[str, Any] = {}
    if "bpm" in data and isinstance(data["bpm"], (int, float)):
        snap["bpm"] = float(data["bpm"])
    if "pattern_length" in data and isinstance(data["pattern_length"], int):
        snap["pattern_length"] = data["pattern_length"]
    if "swing" in data and isinstance(data["swing"], (int, float)):
        snap["swing"] = int(data["swing"])
    for key in ("track_cc", "track_velocity", "track_pitch", "track_muted"):
        if key in data and isinstance(data[key], dict):
            snap[key] = copy.deepcopy(data[key])
    return snap if snap else None


def _validate_track_dict(blob: dict[str, Any], key: str) -> bool:
    inner = blob.get(key)
    if not isinstance(inner, dict):
        return False
    return all(t in inner for t in TRACK_NAMES)


def merge_session_snapshot_into_state(state: AppState, snapshot: dict[str, Any]) -> None:
    """Apply snapshot fields to AppState (not BPM — use Player.set_bpm in the API layer for emit + clock)."""
    if "pattern_length" in snapshot:
        pl = snapshot["pattern_length"]
        if isinstance(pl, int) and pl in (8, 16, 32):
            state.set_pattern_length(pl)

    if _validate_track_dict(snapshot, "track_cc"):
        for track in TRACK_NAMES:
            src = snapshot["track_cc"][track]
            if not isinstance(src, dict):
                continue
            for param, val in src.items():
                if param in state.track_cc[track] and isinstance(val, (int, float)):
                    state.track_cc[track][param] = int(val)

    if _validate_track_dict(snapshot, "track_velocity"):
        for track in TRACK_NAMES:
            val = snapshot["track_velocity"][track]
            if isinstance(val, (int, float)):
                state.update_velocity(track, max(0, min(127, int(val))))

    if _validate_track_dict(snapshot, "track_pitch"):
        for track in TRACK_NAMES:
            val = snapshot["track_pitch"][track]
            if isinstance(val, (int, float)):
                state.update_pitch(track, max(0, min(127, int(val))))

    if _validate_track_dict(snapshot, "track_muted"):
        for track in TRACK_NAMES:
            val = snapshot["track_muted"][track]
            if isinstance(val, bool):
                state.update_mute(track, val)
            elif isinstance(val, (int, float)):
                state.update_mute(track, bool(val))

    if "swing" in snapshot:
        sw = snapshot["swing"]
        if isinstance(sw, (int, float)) and any(t in state.current_pattern for t in TRACK_NAMES):
            state.current_pattern = apply_swing(state.current_pattern, int(sw))
