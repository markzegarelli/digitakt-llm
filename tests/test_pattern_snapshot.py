import copy
import json

from core.state import AppState, TRACK_NAMES, DEFAULT_PATTERN
from core.pattern_snapshot import (
    SAVE_FORMAT_VERSION,
    build_save_file_dict,
    extract_pattern_from_saved_json,
    merge_session_snapshot_into_state,
    parse_session_snapshot,
)


def test_build_save_file_dict_includes_session_fields():
    state = AppState()
    state.bpm = 138.0
    state.set_pattern_length(32)
    state.track_cc["kick"]["filter"] = 42
    state.track_pitch["snare"] = 55
    state.track_velocity["hihat"] = 90
    state.track_muted["tom"] = True
    pat = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    blob = build_save_file_dict(state, pat, ["x"], "2020-01-01T00:00:00")
    assert blob["version"] == SAVE_FORMAT_VERSION
    assert blob["bpm"] == 138.0
    assert blob["pattern_length"] == 32
    assert blob["track_cc"]["kick"]["filter"] == 42
    assert blob["track_pitch"]["snare"] == 55
    assert blob["track_velocity"]["hihat"] == 90
    assert blob["track_muted"]["tom"] is True
    assert blob["swing"] == 0
    state.current_pattern = {**pat, "swing": 37}
    blob2 = build_save_file_dict(state, pat, ["x"], "2020-01-01T00:00:00")
    assert blob2["swing"] == 37
    assert blob["pattern"] == pat
    assert pat["kick"] is not blob["pattern"]["kick"]


def test_extract_pattern_legacy_top_level_tracks():
    raw = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    p = extract_pattern_from_saved_json(raw)
    assert p["kick"] == DEFAULT_PATTERN["kick"]


def test_parse_session_snapshot_requires_version_2():
    assert parse_session_snapshot({"version": 1, "bpm": 140}) is None
    snap = parse_session_snapshot({"version": 2, "bpm": 140.0, "pattern_length": 8, "swing": 44})
    assert snap["bpm"] == 140.0
    assert snap["pattern_length"] == 8
    assert snap["swing"] == 44


def test_merge_session_snapshot_into_state():
    state = AppState()
    snap = {
        "pattern_length": 8,
        "track_cc": {t: copy.deepcopy(state.track_cc[t]) for t in TRACK_NAMES},
        "track_velocity": {t: 127 for t in TRACK_NAMES},
        "track_pitch": {t: 60 for t in TRACK_NAMES},
        "track_muted": {t: False for t in TRACK_NAMES},
    }
    snap["track_cc"]["kick"]["volume"] = 77
    snap["track_pitch"]["kick"] = 48
    merge_session_snapshot_into_state(state, snap)
    assert state.pattern_length == 8
    assert state.track_cc["kick"]["volume"] == 77
    assert state.track_pitch["kick"] == 48


def test_merge_session_snapshot_applies_swing():
    state = AppState()
    state.current_pattern = {**{t: [0] * 16 for t in TRACK_NAMES}, "swing": 0}
    merge_session_snapshot_into_state(state, {"swing": 55})
    assert state.current_pattern.get("swing") == 55
