use crate::types::{DEFAULT_GATE_PCT, TRACK_NAMES};
use serde_json::{Map, Value};

pub type Pattern = Map<String, Value>;

pub fn deep_copy(pattern: &Pattern) -> Pattern {
    pattern.clone()
}

pub fn pattern_length(pattern: &Pattern) -> usize {
    for track in TRACK_NAMES {
        if let Some(vals) = pattern.get(track).and_then(|v| v.as_array()) {
            return vals.len();
        }
    }
    16
}

pub fn track_array(pattern: &Pattern, track: &str) -> Vec<i64> {
    pattern
        .get(track)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_i64())
                .collect()
        })
        .unwrap_or_default()
}

pub fn set_track_array(pattern: &mut Pattern, track: &str, vals: Vec<i64>) {
    pattern.insert(track.to_string(), Value::Array(vals.into_iter().map(Value::from).collect()));
}

pub fn nested_i64_list(pattern: &Pattern, key: &str, track: &str) -> Option<Vec<i64>> {
    pattern
        .get(key)?
        .as_object()?
        .get(track)?
        .as_array()?
        .iter()
        .map(|v| v.as_i64())
        .collect()
}

pub fn ensure_nested_track_list(
    pattern: &mut Pattern,
    key: &str,
    track: &str,
    length: usize,
    fill: i64,
) -> Vec<i64> {
    if !pattern.contains_key(key) {
        pattern.insert(key.to_string(), Value::Object(Map::new()));
    }
    let outer = pattern.get_mut(key).unwrap().as_object_mut().unwrap();
    let row = outer
        .entry(track.to_string())
        .or_insert_with(|| Value::Array(vec![Value::from(fill); length].into()));
    let arr = row.as_array_mut().unwrap();
    while arr.len() < length {
        arr.push(Value::from(fill));
    }
    if arr.len() > length {
        arr.truncate(length);
    }
    arr.iter().filter_map(|v| v.as_i64()).collect()
}

pub fn ensure_gate_block(pattern: &mut Pattern, length: usize) {
    if !pattern.contains_key("gate") {
        let mut gate = Map::new();
        for t in TRACK_NAMES {
            gate.insert(t.to_string(), Value::Array(vec![Value::from(DEFAULT_GATE_PCT); length]));
        }
        pattern.insert("gate".into(), Value::Object(gate));
    }
}

pub fn ensure_cond_block(pattern: &mut Pattern, length: usize) {
    if !pattern.contains_key("cond") {
        let mut cond = Map::new();
        for t in TRACK_NAMES {
            cond.insert(
                t.to_string(),
                Value::Array(vec![Value::Null; length]),
            );
        }
        pattern.insert("cond".into(), Value::Object(cond));
    }
}

pub fn has_all_tracks(pattern: &Pattern) -> bool {
    TRACK_NAMES.iter().all(|t| pattern.contains_key(*t))
}
