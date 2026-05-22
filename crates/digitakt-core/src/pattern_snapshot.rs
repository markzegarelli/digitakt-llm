use serde_json::{json, Map, Value};

use crate::commands::apply_swing;
use crate::state::AppState;
use crate::types::TRACK_NAMES;

pub const SAVE_FORMAT_VERSION: i64 = 2;

pub fn build_save_file_dict(
    state: &AppState,
    pattern: &Map<String, Value>,
    tags: &[String],
    saved_at: &str,
) -> Map<String, Value> {
    let cp = state.current_pattern();
    let swing_val = cp
        .get("swing")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let mut track_cc = Map::new();
    for (track, params) in state.track_cc_map() {
        track_cc.insert(track, Value::Object(params));
    }

    let mut track_velocity = Map::new();
    let mut track_pitch = Map::new();
    let mut track_muted = Map::new();
    for t in TRACK_NAMES {
        track_velocity.insert((*t).into(), json!(127));
        track_pitch.insert((*t).into(), json!(state.track_pitch(t)));
        track_muted.insert((*t).into(), json!(state.track_muted(t)));
    }
    for t in TRACK_NAMES {
        track_velocity.insert((*t).into(), json!(127));
    }

    let mut out = Map::new();
    out.insert("version".into(), json!(SAVE_FORMAT_VERSION));
    out.insert("pattern".into(), Value::Object(pattern.clone()));
    out.insert("tags".into(), json!(tags));
    out.insert("saved_at".into(), json!(saved_at));
    out.insert("bpm".into(), json!(state.bpm()));
    out.insert("swing".into(), json!(swing_val));
    out.insert("pattern_length".into(), json!(state.pattern_length()));
    out.insert("track_cc".into(), Value::Object(track_cc));
    out.insert("track_pitch".into(), Value::Object(track_pitch));
    out.insert("track_muted".into(), Value::Object(track_muted));
    out.insert("track_velocity".into(), Value::Object(track_velocity));
    out
}

pub fn extract_pattern_from_saved_json(data: &Value) -> Result<Map<String, Value>, String> {
    if let Some(obj) = data.as_object() {
        if let Some(pat) = obj.get("pattern").and_then(|v| v.as_object()) {
            return Ok(pat.clone());
        }
        return Ok(obj.clone());
    }
    Err("saved pattern JSON must be an object".into())
}

pub fn parse_session_snapshot(data: &Value) -> Option<Map<String, Value>> {
    let obj = data.as_object()?;
    if obj.get("version")?.as_i64()? != SAVE_FORMAT_VERSION {
        return None;
    }
    let mut snap = Map::new();
    if let Some(bpm) = obj.get("bpm").and_then(|v| v.as_f64()) {
        snap.insert("bpm".into(), json!(bpm));
    }
    if let Some(pl) = obj.get("pattern_length").and_then(|v| v.as_i64()) {
        snap.insert("pattern_length".into(), json!(pl));
    }
    if let Some(sw) = obj.get("swing").and_then(|v| v.as_i64()) {
        snap.insert("swing".into(), json!(sw));
    }
    for key in ["track_cc", "track_velocity", "track_pitch", "track_muted"] {
        if let Some(inner) = obj.get(key).and_then(|v| v.as_object()) {
            snap.insert(key.into(), Value::Object(inner.clone()));
        }
    }
    if snap.is_empty() {
        None
    } else {
        Some(snap)
    }
}

fn validate_track_dict(blob: &Map<String, Value>, key: &str) -> bool {
    blob.get(key)
        .and_then(|v| v.as_object())
        .map(|inner| TRACK_NAMES.iter().all(|t| inner.contains_key(*t)))
        .unwrap_or(false)
}

pub fn merge_session_snapshot_into_state(state: &AppState, snapshot: &Map<String, Value>) {
    if let Some(pl) = snapshot.get("pattern_length").and_then(|v| v.as_i64()) {
        if [8, 16, 32].contains(&pl) {
            state.set_pattern_length(pl);
        }
    }

    if validate_track_dict(snapshot, "track_cc") {
        let tc = snapshot["track_cc"].as_object().unwrap();
        for track in TRACK_NAMES {
            if let Some(src) = tc.get(track).and_then(|v| v.as_object()) {
                for (param, val) in src {
                    if let Some(v) = val.as_i64() {
                        state.update_cc(track, param, v);
                    }
                }
            }
        }
    }

    if validate_track_dict(snapshot, "track_velocity") {
        let tv = snapshot["track_velocity"].as_object().unwrap();
        for track in TRACK_NAMES {
            if let Some(v) = tv.get(track).and_then(|x| x.as_i64()) {
                state.update_velocity(track, v.clamp(0, 127));
            }
        }
    }

    if validate_track_dict(snapshot, "track_pitch") {
        let tp = snapshot["track_pitch"].as_object().unwrap();
        for track in TRACK_NAMES {
            if let Some(v) = tp.get(track).and_then(|x| x.as_i64()) {
                state.update_pitch(track, v.clamp(0, 127));
            }
        }
    }

    if validate_track_dict(snapshot, "track_muted") {
        let tm = snapshot["track_muted"].as_object().unwrap();
        for track in TRACK_NAMES {
            if let Some(v) = tm.get(track) {
                let muted = v.as_bool().unwrap_or_else(|| v.as_i64().unwrap_or(0) != 0);
                state.update_mute(track, muted);
            }
        }
    }

    if let Some(sw) = snapshot.get("swing").and_then(|v| v.as_i64()) {
        let cp = state.current_pattern();
        if TRACK_NAMES.iter().any(|t| cp.contains_key(*t)) {
            let updated = apply_swing(&cp, sw);
            state.set_current_pattern_raw(updated);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{default_pattern, empty_pattern};

    #[test]
    fn test_build_save_file_dict() {
        let state = AppState::new();
        state.set_bpm(138.0);
        state.set_pattern_length(32);
        state.update_pitch("snare", 55);
        state.update_mute("tom", true);
        let pat = default_pattern();
        let blob = build_save_file_dict(&state, &pat, &["x".into()], "2020-01-01T00:00:00");
        assert_eq!(blob["version"], SAVE_FORMAT_VERSION);
        assert_eq!(blob["bpm"], 138.0);
        assert_eq!(blob["pattern_length"], 32);
        assert_eq!(blob["track_pitch"]["snare"], 55);
        assert_eq!(blob["track_muted"]["tom"], true);
    }

    #[test]
    fn test_extract_pattern_legacy() {
        let raw = default_pattern();
        let p = extract_pattern_from_saved_json(&Value::Object(raw.clone())).unwrap();
        assert_eq!(p["kick"], raw["kick"]);
    }

    #[test]
    fn test_parse_session_snapshot() {
        assert!(parse_session_snapshot(&json!({"version": 1, "bpm": 140})).is_none());
        let snap = parse_session_snapshot(&json!({"version": 2, "bpm": 140.0, "pattern_length": 8})).unwrap();
        assert_eq!(snap["bpm"], 140.0);
        assert_eq!(snap["pattern_length"], 8);
    }

    #[test]
    fn test_merge_session_snapshot() {
        let state = AppState::new();
        state.set_current_pattern_raw(empty_pattern());
        let mut snap = Map::new();
        snap.insert("pattern_length".into(), json!(8));
        snap.insert("swing".into(), json!(55));
        merge_session_snapshot_into_state(&state, &snap);
        assert_eq!(state.pattern_length(), 8);
        assert_eq!(state.current_pattern()["swing"], 55);
    }
}
