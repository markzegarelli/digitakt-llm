use rand::Rng;
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::pattern::{
    deep_copy, ensure_cond_block, ensure_gate_block, ensure_nested_track_list, pattern_length,
    Pattern,
};
use crate::types::{zeros, DEFAULT_GATE_PCT, TRACK_NAMES};

const LFO_TRIG_FIELDS: [&str; 4] = ["prob", "vel", "gate", "note"];
const VALID_CONDITIONS: [&str; 3] = ["1:2", "not:2", "fill"];

#[derive(Debug, thiserror::Error, PartialEq)]
#[error("{0}")]
pub struct CommandError(pub String);

pub fn parse_random_range(range_str: Option<&str>, param: &str) -> Result<(i64, i64), CommandError> {
    match range_str {
        None => match param {
            "velocity" => Ok((0, 127)),
            "prob" => Ok((0, 100)),
            _ => Err(CommandError(format!("Unknown parameter: {param}"))),
        },
        Some(s) => {
            let re = Regex::new(r"^\[(\d+)-(\d+)\]$").unwrap();
            let caps = re
                .captures(s.trim())
                .ok_or_else(|| {
                    CommandError(format!(
                        "Invalid range format: '{s}'. Expected '[lo-hi]' (e.g., '[40-60]')"
                    ))
                })?;
            let lo: i64 = caps[1].parse().unwrap();
            let hi: i64 = caps[2].parse().unwrap();
            if lo > hi {
                return Err(CommandError(format!(
                    "Inverted range: lo={lo} > hi={hi}. Expected lo <= hi."
                )));
            }
            match param {
                "velocity" => {
                    if lo < 0 || hi > 127 {
                        return Err(CommandError(format!(
                            "Velocity out of range: [{lo}-{hi}]. Valid range: [0-127]"
                        )));
                    }
                }
                "prob" => {
                    if lo < 0 || hi > 100 {
                        return Err(CommandError(format!(
                            "Probability out of range: [{lo}-{hi}]. Valid range: [0-100]"
                        )));
                    }
                }
                _ => return Err(CommandError(format!("Unknown parameter: {param}"))),
            }
            Ok((lo, hi))
        }
    }
}

pub fn apply_random_velocity(
    pattern: &Pattern,
    tracks: &[&str],
    lo: i64,
    hi: i64,
    rng: &mut impl Rng,
) -> Pattern {
    let mut result = deep_copy(pattern);
    let target: Vec<&str> = if tracks.contains(&"all") {
        TRACK_NAMES.to_vec()
    } else {
        tracks.to_vec()
    };
    for track in target {
        if let Some(arr) = result.get_mut(track).and_then(|v| v.as_array_mut()) {
            for cell in arr.iter_mut() {
                if cell.as_i64().unwrap_or(0) > 0 {
                    *cell = Value::from(rng.gen_range(lo..=hi));
                }
            }
        }
    }
    result
}

pub fn apply_random_prob(
    pattern: &Pattern,
    tracks: &[&str],
    lo: i64,
    hi: i64,
    rng: &mut impl Rng,
) -> Pattern {
    let mut result = deep_copy(pattern);
    if !result.contains_key("prob") {
        result.insert("prob".into(), Value::Object(Map::new()));
    }
    let target: Vec<&str> = if tracks.contains(&"all") {
        TRACK_NAMES.to_vec()
    } else {
        tracks.to_vec()
    };
    let length = pattern_length(&result) as i64;
    for track in target {
        let row = ensure_nested_track_list(&mut result, "prob", track, length as usize, 100);
        let prob_obj = result.get_mut("prob").unwrap().as_object_mut().unwrap();
        let arr = prob_obj
            .get_mut(track)
            .unwrap()
            .as_array_mut()
            .unwrap();
        for cell in arr.iter_mut() {
            *cell = Value::from(rng.gen_range(lo..=hi));
        }
        let _ = row;
    }
    result
}

pub fn apply_prob_step(pattern: &Pattern, track: &str, step: usize, value: i64) -> Pattern {
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    ensure_nested_track_list(&mut result, "prob", track, length, 100);
    result["prob"][track][step] = json!(value);
    result
}

pub fn apply_prob_track(pattern: &Pattern, track: &str, value: i64) -> Result<Pattern, CommandError> {
    if !(0..=100).contains(&value) {
        return Err(CommandError(format!("Probability must be 0–100, got {value}")));
    }
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    ensure_nested_track_list(&mut result, "prob", track, length, 100);
    let arr = result["prob"][track].as_array_mut().unwrap();
    for cell in arr.iter_mut() {
        *cell = Value::from(value);
    }
    Ok(result)
}

pub fn apply_vel_step(pattern: &Pattern, track: &str, step: usize, value: i64) -> Pattern {
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    if !result.contains_key(track) {
        result.insert(track.into(), zeros(length));
    }
    result[track][step] = json!(value);
    result
}

pub fn apply_vel_track(pattern: &Pattern, track: &str, value: i64) -> Result<Pattern, CommandError> {
    if !(0..=127).contains(&value) {
        return Err(CommandError(format!("Velocity must be 0–127, got {value}")));
    }
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    if !result.contains_key(track) {
        result.insert(track.into(), zeros(length));
    }
    let arr = result[track].as_array_mut().unwrap();
    while arr.len() < length {
        arr.push(Value::from(0));
    }
    arr.truncate(length);
    for cell in arr.iter_mut() {
        *cell = Value::from(value);
    }
    Ok(result)
}

pub fn apply_cc_step(
    pattern: &Pattern,
    track: &str,
    param: &str,
    step: usize,
    value: Option<i64>,
) -> Pattern {
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    if !result.contains_key("step_cc") {
        result.insert("step_cc".into(), Value::Object(Map::new()));
    }
    let outer = result.get_mut("step_cc").unwrap().as_object_mut().unwrap();
    if !outer.contains_key(track) {
        outer.insert(track.into(), Value::Object(Map::new()));
    }
    let track_obj = outer.get_mut(track).unwrap().as_object_mut().unwrap();
    if !track_obj.contains_key(param) {
        track_obj.insert(param.into(), Value::Array(vec![Value::Null; length]));
    }
    let arr = track_obj.get_mut(param).unwrap().as_array_mut().unwrap();
    while arr.len() < length {
        arr.push(Value::Null);
    }
    arr.truncate(length);
    arr[step] = value.map(Value::from).unwrap_or(Value::Null);
    result
}

pub fn apply_gate_step(pattern: &Pattern, track: &str, step: usize, value: i64) -> Result<Pattern, CommandError> {
    if !(0..=100).contains(&value) {
        return Err(CommandError(format!("Gate value must be 0–100, got {value}")));
    }
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    ensure_gate_block(&mut result, length);
    result["gate"][track][step] = json!(value);
    Ok(result)
}

pub fn apply_gate_track(pattern: &Pattern, track: &str, value: i64) -> Result<Pattern, CommandError> {
    if !(0..=100).contains(&value) {
        return Err(CommandError(format!("Gate value must be 0–100, got {value}")));
    }
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    ensure_gate_block(&mut result, length);
    let arr = result["gate"][track].as_array_mut().unwrap();
    while arr.len() < length {
        arr.push(Value::from(DEFAULT_GATE_PCT));
    }
    arr.truncate(length);
    for cell in arr.iter_mut() {
        *cell = Value::from(value);
    }
    Ok(result)
}

pub fn apply_note_step(
    pattern: &Pattern,
    track: &str,
    step: usize,
    value: Option<i64>,
) -> Result<Pattern, CommandError> {
    if let Some(v) = value {
        if !(0..=127).contains(&v) {
            return Err(CommandError(format!("Note must be 0–127 or None, got {v}")));
        }
    }
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    if !result.contains_key("note") {
        result.insert("note".into(), Value::Object(Map::new()));
    }
    let notes = result.get_mut("note").unwrap().as_object_mut().unwrap();
    if !notes.contains_key(track) {
        notes.insert(track.into(), Value::Array(vec![Value::Null; length]));
    }
    let arr = notes.get_mut(track).unwrap().as_array_mut().unwrap();
    while arr.len() < length {
        arr.push(Value::Null);
    }
    arr.truncate(length);
    arr[step] = value.map(Value::from).unwrap_or(Value::Null);
    Ok(result)
}

pub fn apply_cond_step(
    pattern: &Pattern,
    track: &str,
    step: usize,
    value: Option<&str>,
) -> Result<Pattern, CommandError> {
    if let Some(v) = value {
        if !VALID_CONDITIONS.contains(&v) {
            return Err(CommandError(format!(
                "Unknown condition '{v}'. Valid: {:?}",
                VALID_CONDITIONS
            )));
        }
    }
    let mut result = deep_copy(pattern);
    let length = pattern_length(&result);
    ensure_cond_block(&mut result, length);
    result["cond"][track][step] = value
        .map(|s| Value::String(s.into()))
        .unwrap_or(Value::Null);
    Ok(result)
}

pub fn apply_swing(pattern: &Pattern, amount: i64) -> Pattern {
    let mut result = deep_copy(pattern);
    result.insert("swing".into(), json!(amount));
    result
}

pub fn generate_random_beat(rng: &mut impl Rng) -> (Pattern, i64, i64, Map<String, Value>) {
    let bpm = rng.gen_range(128..=160);
    let swing = rng.gen_range(0..=30);
    let mut pattern = Map::new();
    for t in TRACK_NAMES {
        pattern.insert(t.into(), Value::Array(vec![Value::from(0); 16]));
    }

    for step in [0, 4, 8, 12] {
        pattern["kick"][step] = json!(rng.gen_range(90..=127));
    }
    let extra_kick: Vec<usize> = (0..16).filter(|s| ![0, 4, 8, 12].contains(s)).collect();
    let n_extra = rng.gen_range(0..=2);
    for step in sample_indices(rng, &extra_kick, n_extra) {
        pattern["kick"][step] = json!(rng.gen_range(60..=90));
    }

    pattern["snare"][4] = json!(rng.gen_range(90..=127));
    pattern["snare"][12] = json!(rng.gen_range(90..=127));
    let ghost: Vec<usize> = (0..16).filter(|s| *s != 4 && *s != 12).collect();
    let ghost_n = rng.gen_range(0..=3);
    for step in sample_indices(rng, &ghost, ghost_n) {
        pattern["snare"][step] = json!(rng.gen_range(15..=45));
    }

    let hat_steps: Vec<usize> = if rng.gen_bool(0.5) {
        (0..16).step_by(2).collect()
    } else {
        (0..16).collect()
    };
    for step in &hat_steps {
        pattern["hihat"][*step] = json!(rng.gen_range(40..=100));
    }
    let accent_n = hat_steps.len().min(3);
    for step in sample_indices(rng, &hat_steps, accent_n) {
        let cur = pattern["hihat"][step].as_i64().unwrap_or(0);
        pattern["hihat"][step] = json!((cur + rng.gen_range(10..=30)).min(127));
    }

    let openhat_candidates: Vec<usize> = (0..16).filter(|s| ![0, 4, 8, 12].contains(s)).collect();
    let openhat_n = rng.gen_range(1..=3);
    for step in sample_indices(rng, &openhat_candidates, openhat_n) {
        pattern["openhat"][step] = json!(rng.gen_range(60..=90));
    }

    let all_steps: Vec<usize> = (0..16).collect();
    let clap_n = rng.gen_range(0..=2);
    for step in sample_indices(rng, &all_steps, clap_n) {
        pattern["clap"][step] = json!(rng.gen_range(50..=90));
    }

    for track in ["tom", "bell", "cymbal"] {
        let tom_n = rng.gen_range(0..=2);
        for step in sample_indices(rng, &all_steps, tom_n) {
            pattern[track][step] = json!(rng.gen_range(30..=80));
        }
    }

    let mut cc_changes = Map::new();
    for track in TRACK_NAMES {
        let mut params = Map::new();
        params.insert("filter".into(), json!(rng.gen_range(40..=110)));
        params.insert("resonance".into(), json!(rng.gen_range(20..=80)));
        params.insert("decay".into(), json!(rng.gen_range(30..=100)));
        params.insert("tune".into(), json!(rng.gen_range(58..=70)));
        params.insert("reverb".into(), json!(rng.gen_range(0..=40)));
        params.insert("delay".into(), json!(rng.gen_range(0..=30)));
        params.insert("attack".into(), json!(rng.gen_range(0..=30)));
        params.insert("volume".into(), json!(100));
        cc_changes.insert(track.into(), Value::Object(params));
    }

    (pattern, bpm, swing, cc_changes)
}

fn sample_indices(rng: &mut impl Rng, pool: &[usize], count: usize) -> Vec<usize> {
    if pool.is_empty() || count == 0 {
        return vec![];
    }
    let n = count.min(pool.len());
    let mut indices: Vec<usize> = pool.to_vec();
    for i in 0..n {
        let j = rng.gen_range(i..indices.len());
        indices.swap(i, j);
    }
    indices.truncate(n);
    indices
}

pub fn validate_lfo_target_key(key: &str) -> Result<(), CommandError> {
    use crate::types::cc_map_contains;
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() != 3 {
        return Err(CommandError(
            "LFO target must have three : segments (e.g. cc:kick:filter, trig:snare:prob)".into(),
        ));
    }
    let (kind, track, rest) = (parts[0], parts[1], parts[2]);
    if !TRACK_NAMES.contains(&track) {
        return Err(CommandError("unknown track in LFO target".into()));
    }
    match kind {
        "cc" if cc_map_contains(rest) => Ok(()),
        "cc" => Err(CommandError("unknown CC param in LFO target".into())),
        "trig" if LFO_TRIG_FIELDS.contains(&rest) => Ok(()),
        "trig" => Err(CommandError(
            "unknown trig field (use prob, vel, gate, or note)".into(),
        )),
        "pitch" if rest == "main" => Ok(()),
        "pitch" => Err(CommandError("pitch LFO must use pitch:<track>:main".into())),
        _ => Err(CommandError(
            "LFO target must start with cc:, trig:, or pitch:".into(),
        )),
    }
}

pub fn set_lfo(pattern: &Pattern, target: &str, lfo: Option<Map<String, Value>>) -> Pattern {
    let mut p = deep_copy(pattern);
    match lfo {
        None => {
            if let Some(m) = p.get_mut("lfo").and_then(|v| v.as_object_mut()) {
                m.remove(target);
                if m.is_empty() {
                    p.remove("lfo");
                }
            }
        }
        Some(def) => {
            if !p.contains_key("lfo") {
                p.insert("lfo".into(), Value::Object(Map::new()));
            }
            p["lfo"][target] = Value::Object(def);
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn fixture() -> Pattern {
        serde_json::from_value(json!({
            "kick":    [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
            "snare":   [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
            "tom":     [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "clap":    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "bell":    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "hihat":   [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
            "openhat": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
            "cymbal":  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
        }))
        .unwrap()
    }

    #[test]
    fn test_parse_range_explicit() {
        assert_eq!(parse_random_range(Some("[40-60]"), "velocity").unwrap(), (40, 60));
    }

    #[test]
    fn test_parse_range_defaults() {
        assert_eq!(parse_random_range(None, "velocity").unwrap(), (0, 127));
        assert_eq!(parse_random_range(None, "prob").unwrap(), (0, 100));
    }

    #[test]
    fn test_parse_range_errors() {
        assert!(parse_random_range(Some("40-60"), "velocity").is_err());
        assert!(parse_random_range(Some("[60-40]"), "velocity").is_err());
        assert!(parse_random_range(Some("[0-200]"), "velocity").is_err());
    }

    #[test]
    fn test_apply_random_velocity() {
        let mut rng = StdRng::seed_from_u64(1);
        let pattern = fixture();
        let result = apply_random_velocity(&pattern, &["kick"], 50, 50, &mut rng);
        for (i, v) in result["kick"].as_array().unwrap().iter().enumerate() {
            if pattern["kick"][i].as_i64().unwrap() == 0 {
                assert_eq!(v.as_i64(), Some(0));
            } else {
                assert_eq!(v.as_i64(), Some(50));
            }
        }
    }

    #[test]
    fn test_apply_prob_step() {
        let result = apply_prob_step(&fixture(), "kick", 3, 75);
        assert_eq!(result["prob"]["kick"][3], 75);
    }

    #[test]
    fn test_apply_swing() {
        let result = apply_swing(&fixture(), 42);
        assert_eq!(result["swing"], 42);
    }

    #[test]
    fn test_randbeat_structure() {
        let mut rng = StdRng::seed_from_u64(42);
        for _ in 0..10 {
            let (pattern, bpm, swing, cc) = generate_random_beat(&mut rng);
            for t in TRACK_NAMES {
                assert_eq!(pattern[t].as_array().unwrap().len(), 16);
                assert!(cc.contains_key(t));
            }
            assert!((128..=160).contains(&bpm));
            assert!((0..=30).contains(&swing));
            for step in [0, 4, 8, 12] {
                assert!(pattern["kick"][step].as_i64().unwrap() > 0);
            }
        }
    }

    #[test]
    fn test_validate_lfo_target() {
        validate_lfo_target_key("cc:kick:filter").unwrap();
        validate_lfo_target_key("trig:snare:prob").unwrap();
        assert!(validate_lfo_target_key("nope").is_err());
    }

    #[test]
    fn test_set_lfo() {
        let p = fixture();
        let def: Map<String, Value> = serde_json::from_value(json!({
            "shape": "sine", "depth": 10, "phase": 0, "rate": {"num": 1, "den": 1}
        }))
        .unwrap();
        let p1 = set_lfo(&p, "cc:kick:filter", Some(def.clone()));
        let mut def2 = def;
        def2.insert("depth".into(), json!(20));
        let p2 = set_lfo(&p1, "cc:kick:filter", Some(def2));
        assert_eq!(p2["lfo"]["cc:kick:filter"]["depth"], 20);
        let p3 = set_lfo(&p2, "cc:kick:filter", None);
        assert!(!p3.contains_key("lfo"));
    }

    #[test]
    fn test_gate_and_cond() {
        let p = Map::from_iter(TRACK_NAMES.iter().map(|t| (t.to_string(), zeros(16))));
        let g = apply_gate_step(&p, "kick", 0, 50).unwrap();
        assert_eq!(g["gate"]["kick"][0], 50);
        let c = apply_cond_step(&p, "kick", 0, Some("1:2")).unwrap();
        assert_eq!(c["cond"]["kick"][0], "1:2");
    }
}
