use serde_json::{Map, Value};

pub const SEQ_MODE_STANDARD: &str = "standard";
pub const SEQ_MODE_EUCLIDEAN: &str = "euclidean";
pub const EUCLID_STRIP_MODE_GRID: &str = "grid";
pub const EUCLID_STRIP_MODE_FRACTIONAL: &str = "fractional";

const EUCLID_N_MAX: i64 = 16;
const EUCLID_N_MIN: i64 = 1;

#[derive(Debug, thiserror::Error, PartialEq)]
#[error("{0}")]
pub struct EuclideanError(pub String);

pub fn bjorklund(k: i64, n: i64) -> Result<Vec<bool>, EuclideanError> {
    if n < 1 {
        return Err(EuclideanError("n must be at least 1".into()));
    }
    if k < 0 || k > n {
        return Err(EuclideanError("k must satisfy 0 <= k <= n".into()));
    }
    if k == 0 {
        return Ok(vec![false; n as usize]);
    }
    if k == n {
        return Ok(vec![true; n as usize]);
    }
    Ok((0..n)
        .map(|i| ((i * k) % n) < k)
        .collect())
}

pub fn rhythm_hit(k: i64, n: i64, r: i64, step: i64) -> bool {
    if n < 1 {
        return false;
    }
    let ring = bjorklund(k, n).unwrap_or_default();
    let local = (step + r).rem_euclid(n) as usize;
    ring.get(local).copied().unwrap_or(false)
}

pub fn clamp_euclid_triplet(k: i64, n: i64, r: i64) -> (i64, i64, i64) {
    let n = n.max(EUCLID_N_MIN).min(EUCLID_N_MAX);
    let k = k.max(0).min(n);
    let r = if n != 0 { r.rem_euclid(n) } else { 0 };
    (k, n, r)
}

pub fn default_euclid_block(
    pattern_length: i64,
    track_names: &[&str],
) -> Map<String, Value> {
    let n = pattern_length.max(EUCLID_N_MIN).min(EUCLID_N_MAX);
    let mut block = Map::new();
    for t in track_names {
        let mut row = Map::new();
        row.insert("k".into(), Value::from(0));
        row.insert("n".into(), Value::from(n));
        row.insert("r".into(), Value::from(0));
        block.insert((*t).into(), Value::Object(row));
    }
    block
}

pub fn normalize_seq_mode(raw: Option<&str>) -> &'static str {
    if raw == Some(SEQ_MODE_EUCLIDEAN) {
        SEQ_MODE_EUCLIDEAN
    } else {
        SEQ_MODE_STANDARD
    }
}

pub fn normalize_euclid_strip_mode(raw: Option<&str>) -> &'static str {
    if raw == Some(EUCLID_STRIP_MODE_FRACTIONAL) {
        EUCLID_STRIP_MODE_FRACTIONAL
    } else {
        EUCLID_STRIP_MODE_GRID
    }
}

pub fn normalize_euclid_in_pattern(
    pattern: &mut Map<String, Value>,
    pattern_length: i64,
    track_names: &[&str],
) {
    let seq = normalize_seq_mode(pattern.get("seq_mode").and_then(|v| v.as_str()));
    pattern.insert("seq_mode".into(), Value::String(seq.into()));

    let pl = pattern_length.max(EUCLID_N_MIN).min(EUCLID_N_MAX);
    let defaults = default_euclid_block(pl, track_names);

    let new_block = if let Some(block) = pattern.get("euclid").and_then(|v| v.as_object()) {
        let mut new_block = Map::new();
        for t in track_names {
            if let Some(row) = block.get(*t).and_then(|v| v.as_object()) {
                let k = row.get("k").and_then(|v| v.as_i64()).unwrap_or(0);
                let n = row.get("n").and_then(|v| v.as_i64()).unwrap_or(pl);
                let r = row.get("r").and_then(|v| v.as_i64()).unwrap_or(0);
                let (k_i, n_i, r_i) = clamp_euclid_triplet(k, n, r);
                let mut triplet = Map::new();
                triplet.insert("k".into(), Value::from(k_i));
                triplet.insert("n".into(), Value::from(n_i));
                triplet.insert("r".into(), Value::from(r_i));
                new_block.insert((*t).into(), Value::Object(triplet));
            } else {
                new_block.insert((*t).into(), defaults.get(*t).cloned().unwrap());
            }
        }
        new_block
    } else {
        defaults
    };
    pattern.insert("euclid".into(), Value::Object(new_block));

    let strip = normalize_euclid_strip_mode(
        pattern.get("euclid_strip_mode").and_then(|v| v.as_str()),
    );
    pattern.insert(
        "euclid_strip_mode".into(),
        Value::String(strip.into()),
    );
}

pub fn track_euclidean_hit(pattern: &Map<String, Value>, track: &str, step: i64) -> bool {
    let eu = match pattern.get("euclid").and_then(|v| v.as_object()) {
        Some(e) => e,
        None => return true,
    };
    let row = match eu.get(track).and_then(|v| v.as_object()) {
        Some(r) => r,
        None => return true,
    };
    let k = row.get("k").and_then(|v| v.as_i64()).unwrap_or(0);
    let n = row.get("n").and_then(|v| v.as_i64()).unwrap_or(1);
    let r = row.get("r").and_then(|v| v.as_i64()).unwrap_or(0);
    let (k, n, r) = clamp_euclid_triplet(k, n, r);
    if k == 0 {
        return false;
    }
    if k == n {
        return true;
    }
    rhythm_hit(k, n, r, step)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TRACK_NAMES;

    #[test]
    fn test_bjorklund_3_8() {
        assert_eq!(
            bjorklund(3, 8).unwrap(),
            vec![true, false, false, true, false, false, true, false]
        );
    }

    #[test]
    fn test_bjorklund_4_16() {
        assert_eq!(
            bjorklund(4, 16).unwrap(),
            vec![
                true, false, false, false, true, false, false, false, true, false, false,
                false, true, false, false, false
            ]
        );
    }

    #[test]
    fn test_bjorklund_5_8() {
        assert_eq!(
            bjorklund(5, 8).unwrap(),
            vec![true, false, true, false, true, true, false, true]
        );
    }

    #[test]
    fn test_bjorklund_edges() {
        assert_eq!(bjorklund(0, 8).unwrap(), vec![false; 8]);
        assert_eq!(bjorklund(8, 8).unwrap(), vec![true; 8]);
        assert_eq!(bjorklund(1, 1).unwrap(), vec![true]);
        assert_eq!(bjorklund(0, 1).unwrap(), vec![false]);
    }

    #[test]
    fn test_bjorklund_invalid() {
        assert!(bjorklund(3, 0).is_err());
        assert!(bjorklund(9, 8).is_err());
        assert!(bjorklund(-1, 8).is_err());
    }

    #[test]
    fn test_rhythm_hit_rotation() {
        let ring = bjorklund(3, 8).unwrap();
        for s in 0..8 {
            assert_eq!(rhythm_hit(3, 8, 0, s), ring[s as usize]);
        }
        assert_eq!(rhythm_hit(3, 8, 1, 0), ring[1]);
    }

    #[test]
    fn test_normalize_seq_mode() {
        assert_eq!(normalize_seq_mode(None), SEQ_MODE_STANDARD);
        assert_eq!(normalize_seq_mode(Some("euclidean")), SEQ_MODE_EUCLIDEAN);
        assert_eq!(normalize_seq_mode(Some("grid")), SEQ_MODE_STANDARD);
    }

    #[test]
    fn test_clamp_euclid_triplet() {
        assert_eq!(clamp_euclid_triplet(10, 5, 0), (5, 5, 0));
        assert_eq!(clamp_euclid_triplet(-1, 8, 99), (0, 8, 3));
        assert_eq!(clamp_euclid_triplet(20, 40, 0), (16, 16, 0));
    }

    #[test]
    fn test_normalize_euclid_strip_mode() {
        assert_eq!(normalize_euclid_strip_mode(None), EUCLID_STRIP_MODE_GRID);
        assert_eq!(normalize_euclid_strip_mode(Some("bogus")), EUCLID_STRIP_MODE_GRID);
        assert_eq!(
            normalize_euclid_strip_mode(Some("fractional")),
            EUCLID_STRIP_MODE_FRACTIONAL
        );
    }

    #[test]
    fn test_normalize_euclid_in_pattern() {
        let tracks: Vec<&str> = vec!["kick", "snare"];
        let mut p = Map::new();
        p.insert("kick".into(), Value::Array(vec![Value::from(0); 2]));
        p.insert("snare".into(), Value::Array(vec![Value::from(0); 2]));
        normalize_euclid_in_pattern(&mut p, 2, &tracks);
        assert_eq!(p["seq_mode"], SEQ_MODE_STANDARD);
        let eu = p["euclid"].as_object().unwrap();
        assert!(eu.contains_key("kick") && eu.contains_key("snare"));
        assert_eq!(eu["kick"]["k"], 0);
        assert_eq!(eu["kick"]["n"], 2);
        assert_eq!(p["euclid_strip_mode"], EUCLID_STRIP_MODE_GRID);
    }

    #[test]
    fn test_track_euclidean_hit_respects_row() {
        let tracks: Vec<&str> = vec!["kick", "snare"];
        let mut p = Map::new();
        p.insert("seq_mode".into(), Value::String(SEQ_MODE_EUCLIDEAN.into()));
        let mut eu = Map::new();
        for (t, k, n) in [("kick", 1, 4), ("snare", 4, 4)] {
            let mut row = Map::new();
            row.insert("k".into(), Value::from(k));
            row.insert("n".into(), Value::from(n));
            row.insert("r".into(), Value::from(0));
            eu.insert(t.into(), Value::Object(row));
        }
        p.insert("euclid".into(), Value::Object(eu));
        normalize_euclid_in_pattern(&mut p, 16, &tracks);
        assert!(track_euclidean_hit(&p, "kick", 0));
        assert!(!track_euclidean_hit(&p, "kick", 1));
    }

    #[test]
    fn test_default_euclid_block_caps_n() {
        let b = default_euclid_block(32, &["a"]);
        assert_eq!(b["a"]["n"], 16);
    }

    #[test]
    fn test_default_euclid_block_16() {
        let b = default_euclid_block(16, &["a", "b"]);
        assert_eq!(b["a"]["k"], 0);
        assert_eq!(b["a"]["n"], 16);
        let _ = TRACK_NAMES;
    }
}
