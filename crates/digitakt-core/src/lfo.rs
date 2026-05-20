use std::f64::consts::PI;

use serde_json::{Map, Value};

use crate::types::{cc_map_contains, TRACK_NAMES};

pub const SHAPES: [&str; 5] = ["sine", "square", "triangle", "ramp", "saw"];

const LFO_TRIG_FIELDS: [&str; 4] = ["prob", "vel", "gate", "note"];

fn norm_p(p: f64) -> f64 {
    let x = p % 1.0;
    if x >= 0.0 { x } else { x + 1.0 }
}

#[derive(Debug, thiserror::Error, PartialEq)]
#[error("{0}")]
pub struct LfoError(pub String);

pub fn lfo_shape(shape: &str, p: f64) -> Result<f64, LfoError> {
    let p = norm_p(p);
    match shape {
        "sine" => Ok((2.0 * PI * p).sin()),
        "triangle" => {
            if p < 0.5 {
                Ok(4.0 * p - 1.0)
            } else {
                Ok(3.0 - 4.0 * p)
            }
        }
        "square" => Ok(if p < 0.5 { 1.0 } else { -1.0 }),
        "ramp" => Ok(2.0 * p - 1.0),
        "saw" => Ok(1.0 - 2.0 * p),
        _ => Err(LfoError(format!("unknown shape: '{shape}'"))),
    }
}

fn python_round(x: f64) -> i64 {
    let f = x.floor();
    let frac = x - f;
    if frac < 0.5 {
        f as i64
    } else if frac > 0.5 {
        x.ceil() as i64
    } else if (f as i64).rem_euclid(2) == 0 {
        f as i64
    } else {
        x.ceil() as i64
    }
}

pub fn apply_depth_clamp(base: i64, w: f64, depth_pct: i64, lo: i64, hi: i64) -> i64 {
    let half = (hi - lo) as f64 / 2.0;
    let mut v = python_round(base as f64 + w * (depth_pct as f64 / 100.0) * half);
    if v < lo {
        v = lo;
    }
    if v > hi {
        v = hi;
    }
    v
}

pub fn cycle_steps(pattern_length: i64, num: i64, den: i64) -> Result<i64, LfoError> {
    if num < 1 || den < 1 {
        return Err(LfoError("num and den must be >= 1".into()));
    }
    Ok(((pattern_length * num) / den).max(1))
}

pub fn lfo_w_at_step(
    global_step: i64,
    cycle_steps_n: i64,
    phase: f64,
    shape: &str,
) -> Result<f64, LfoError> {
    let p = (global_step % cycle_steps_n) as f64 / cycle_steps_n as f64;
    lfo_shape(shape, norm_p(p + phase))
}

pub fn lfo_mod_w(ldef: &Map<String, Value>, pattern_length: i64, global_step: i64) -> Option<(f64, i64)> {
    let rate = ldef.get("rate")?.as_object()?;
    let num = rate.get("num")?.as_i64()?;
    let den = rate.get("den")?.as_i64()?;
    let csn = cycle_steps(pattern_length, num, den).ok()?;
    let shape = ldef.get("shape").and_then(|v| v.as_str()).unwrap_or("sine");
    let depth = ldef
        .get("depth")
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        .clamp(0, 100);
    let phase = ldef
        .get("phase")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let w = lfo_w_at_step(global_step, csn, phase, shape).ok()?;
    Some((w, depth))
}

fn lfo_target_key_valid(key: &str) -> bool {
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() != 3 {
        return false;
    }
    let (kind, track, rest) = (parts[0], parts[1], parts[2]);
    if !TRACK_NAMES.contains(&track) {
        return false;
    }
    match kind {
        "cc" => cc_map_contains(rest),
        "trig" => LFO_TRIG_FIELDS.contains(&rest),
        "pitch" => rest == "main",
        _ => false,
    }
}

pub fn sanitize_lfo_in_pattern(pattern: &mut Map<String, Value>, pattern_length: i64) {
    let block = match pattern.get("lfo").and_then(|v| v.as_object()) {
        Some(b) => b.clone(),
        None => return,
    };
    let mut new_block = Map::new();
    for (k, v) in block {
        let ldef = match v.as_object() {
            Some(o) => o,
            None => continue,
        };
        if !lfo_target_key_valid(&k) {
            continue;
        }
        if lfo_mod_w(ldef, pattern_length, 0).is_none() {
            continue;
        }
        new_block.insert(k, Value::Object(ldef.clone()));
    }
    if new_block.is_empty() {
        pattern.remove("lfo");
    } else {
        pattern.insert("lfo".into(), Value::Object(new_block));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pattern::deep_copy;
    use crate::state::AppState;
    use crate::types::empty_pattern;
    use serde_json::json;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn test_sine_0_is_zero() {
        assert!(approx(lfo_shape("sine", 0.0).unwrap(), 0.0));
    }

    #[test]
    fn test_triangle_quarter() {
        assert!(approx(lfo_shape("triangle", 0.25).unwrap(), 0.0));
    }

    #[test]
    fn test_square_low_half() {
        assert_eq!(lfo_shape("square", 0.1).unwrap(), 1.0);
        assert_eq!(lfo_shape("square", 0.6).unwrap(), -1.0);
    }

    #[test]
    fn test_ramp_endpoints() {
        assert_eq!(lfo_shape("ramp", 0.0).unwrap(), -1.0);
        assert!(approx(lfo_shape("ramp", 1.0 - 1e-12).unwrap(), 1.0));
    }

    #[test]
    fn test_saw_basic() {
        assert!(approx(lfo_shape("saw", 0.0).unwrap(), 1.0));
        assert!(approx(lfo_shape("saw", 0.5).unwrap(), 0.0));
        assert!(approx(lfo_shape("saw", 0.75).unwrap(), -0.5));
    }

    #[test]
    fn test_lfo_shape_wraps_p() {
        assert_eq!(lfo_shape("ramp", 0.0).unwrap(), lfo_shape("ramp", 1.0).unwrap());
        assert_eq!(lfo_shape("sine", 0.25).unwrap(), lfo_shape("sine", 1.25).unwrap());
    }

    #[test]
    fn test_cycle_steps_16_1_4() {
        assert_eq!(cycle_steps(16, 1, 4).unwrap(), 4);
    }

    #[test]
    fn test_cycle_steps_invalid() {
        assert!(cycle_steps(16, 0, 1).is_err());
        assert!(cycle_steps(16, 1, 0).is_err());
    }

    #[test]
    fn test_lfo_w_at_step_four_step_sine() {
        let n = 4;
        for (step, expected) in [(0, 0.0), (1, 1.0), (2, 0.0), (3, -1.0)] {
            assert!(approx(
                lfo_w_at_step(step, n, 0.0, "sine").unwrap(),
                expected
            ));
        }
    }

    #[test]
    fn test_shapes_tuple() {
        assert!(SHAPES.contains(&"sine"));
        assert_eq!(SHAPES.len(), 5);
    }

    #[test]
    fn test_unknown_shape_raises() {
        assert!(lfo_shape("nope", 0.0).is_err());
    }

    #[test]
    fn test_lfo_mod_w_returns_w_depth() {
        let mut m = Map::new();
        m.insert("shape".into(), json!("ramp"));
        m.insert("depth".into(), json!(50));
        m.insert("phase".into(), json!(0.0));
        let mut rate = Map::new();
        rate.insert("num".into(), json!(1));
        rate.insert("den".into(), json!(1));
        m.insert("rate".into(), Value::Object(rate));
        let (w, d) = lfo_mod_w(&m, 16, 0).unwrap();
        assert_eq!(w, -1.0);
        assert_eq!(d, 50);
    }

    #[test]
    fn test_apply_depth_clamp() {
        assert_eq!(apply_depth_clamp(64, 1.0, 100, 0, 127), 127);
        assert_eq!(apply_depth_clamp(64, 0.0, 100, 0, 127), 64);
        assert_eq!(apply_depth_clamp(64, -1.0, 100, 0, 127), 0);
        assert_eq!(apply_depth_clamp(0, 1.0, 0, 0, 127), 0);
        assert_eq!(apply_depth_clamp(5, 1.0, 100, 0, 10), 10);
        assert_eq!(apply_depth_clamp(5, -1.0, 100, 0, 10), 0);
    }

    #[test]
    fn test_sanitize_lfo_drops_invalid() {
        let mut pat = empty_pattern();
        pat.insert(
            "lfo".into(),
            json!({
                "cc:kick:filter": {"shape": "nope", "depth": 50, "phase": 0.0, "rate": {"num": 1, "den": 1}},
                "cc:kick:decay": {"shape": "sine", "depth": 10, "phase": 0.0, "rate": {"num": 1, "den": 1}}
            }),
        );
        sanitize_lfo_in_pattern(&mut pat, 16);
        let lfo = pat.get("lfo").unwrap().as_object().unwrap();
        assert!(!lfo.contains_key("cc:kick:filter"));
        assert_eq!(lfo["cc:kick:decay"]["shape"], "sine");
    }

    #[test]
    fn test_sanitize_drops_bad_target() {
        let mut pat = empty_pattern();
        pat.insert(
            "lfo".into(),
            json!({"cc:kick:__bad__": {"shape": "sine", "depth": 1, "phase": 0.0, "rate": {"num": 1, "den": 1}}}),
        );
        sanitize_lfo_in_pattern(&mut pat, 16);
        assert!(!pat.contains_key("lfo"));
    }

    #[test]
    fn test_lfo_preserved_in_replace_current_pattern() {
        let lfo = json!({
            "cc:kick:filter": {
                "shape": "sine",
                "depth": 50,
                "phase": 0.0,
                "rate": {"num": 1, "den": 1}
            }
        });
        let mut pat = empty_pattern();
        pat.insert("lfo".into(), lfo.clone());
        let mut state = AppState::new();
        state.replace_current_pattern(pat);
        assert_eq!(state.current_pattern()["lfo"], lfo);
    }
}
