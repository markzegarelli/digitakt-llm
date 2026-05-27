//! Pattern coercion helpers (parity with `core/generator.py`).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use digitakt_core::{
    clamp_euclid_triplet, sanitize_lfo_in_pattern, AppState, Pattern, SEQ_MODE_EUCLIDEAN,
    SEQ_MODE_STANDARD, TRACK_NAMES,
};
use regex::Regex;
use serde_json::{json, Map, Value};

const PRODUCER_NOTES_MAX_LEN: usize = 1200;

pub fn opus_max_output_tokens(steps: usize) -> usize {
    (2048_usize).max(400 + steps * 90)
}

pub fn parse_ask_response(raw: &str) -> (String, bool) {
    let raw_stripped = raw.trim_end();
    let mut lines: Vec<&str> = raw_stripped.split('\n').collect();
    let mut implementable = false;
    if let Some(last) = lines.last() {
        let last_trim = last.trim();
        if last_trim.to_ascii_uppercase().starts_with("IMPLEMENTABLE:") {
            implementable = last_trim.to_ascii_uppercase().contains("YES");
            lines.pop();
        }
    }
    (lines.join("\n").trim().to_string(), implementable)
}

pub fn normalize_producer_notes(raw: &str) -> Option<String> {
    let text: String = raw
        .trim()
        .chars()
        .map(|ch| {
            if ch == '\n' || ch == '\r' || ch == '\t' || ch as u32 >= 32 {
                ch
            } else {
                ' '
            }
        })
        .collect();
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let text = if text.len() > PRODUCER_NOTES_MAX_LEN {
        text[..PRODUCER_NOTES_MAX_LEN].trim_end()
    } else {
        text
    };
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

pub fn serialize_pattern_for_llm(pattern: &Pattern, steps: usize) -> String {
    let st = AppState::new();
    let norm = st.normalize_pattern_length(pattern.clone(), Some(steps as i64));
    let mut blob = Map::new();
    for t in TRACK_NAMES {
        if let Some(v) = norm.get(t) {
            blob.insert(t.to_string(), v.clone());
        }
    }
    for key in ["prob", "gate", "cond", "note", "step_cc"] {
        if let Some(v) = norm.get(key).filter(|v| v.is_object() && !v.as_object().unwrap().is_empty())
        {
            blob.insert(key.to_string(), v.clone());
        }
    }
    if let Some(sw) = norm.get("swing").and_then(|v| v.as_i64()) {
        if sw != 0 {
            blob.insert("swing".into(), json!(sw));
        }
    }
    serde_json::to_string(&blob).unwrap_or_default()
}

pub fn detect_target_tracks(prompt: &str) -> HashSet<&'static str> {
    let aliases: HashMap<&str, &[&str]> = HashMap::from([
        ("kick", &["kick", "bass drum", "bassdrum", "bd"][..]),
        ("snare", &["snare", "snare drum", "sd"][..]),
        (
            "hihat",
            &["hihat", "hi-hat", "hi hat", "hat", "hats", "closed hat", "ch"][..],
        ),
        ("openhat", &["open hat", "openhat", "open hi-hat", "open hihat"][..]),
        ("clap", &["clap", "cl"][..]),
        ("tom", &["tom", "toms", "lt"][..]),
        ("bell", &["bell", "cowbell", "bl"][..]),
        ("cymbal", &["cymbal", "cymbals", "crash", "cy"][..]),
    ]);
    let lowered = prompt.to_lowercase();
    let mut matches: Vec<(usize, usize, &'static str)> = Vec::new();
    for (track, alist) in aliases {
        for alias in alist {
            let pat = format!(r"\b{}\b", regex::escape(alias));
            let re = Regex::new(&pat).unwrap();
            for m in re.find_iter(&lowered) {
                matches.push((m.start(), m.end(), track));
            }
        }
    }
    let mut found = HashSet::new();
    let mut occupied: Vec<(usize, usize)> = Vec::new();
    matches.sort_by(|a, b| b.1.saturating_sub(b.0).cmp(&a.1.saturating_sub(a.0)).then(a.0.cmp(&b.0)));
    for (start, end, track) in matches {
        if occupied
            .iter()
            .any(|(s, e)| !(end <= *s || start >= *e))
        {
            continue;
        }
        occupied.push((start, end));
        found.insert(track);
    }
    found
}

fn global_rewrite_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)(?:from scratch|start over|start fresh|new pattern|new beat|replace (?:the )?(?:whole |entire )?pattern|whole pattern|entire pattern|all tracks|redo everything|scrap (?:this|it))",
        )
        .unwrap()
    })
}

fn global_variation_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)(?:\bsparser\b|\bdenser\b|\bbusier\b|less busy|more energy|less energy|\bvariation\b|vary the|evolve the|transform the|\bremix\b|more minimal\b|more chaotic)",
        )
        .unwrap()
    })
}

fn step_rewrite_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)(?:\b(?:add|remove|delete|drop|cut|introduce|inject)\s+(?:more\s+)?(?:hits?|steps?|trigs?|notes?)\b|\b(?:more|fewer|less|extra|additional|new)\s+(?:hits?|steps?|trigs?|notes?)\b|\b(?:denser|sparser|busier|quieter)\s+(?:pattern|groove|beat|rhythm)\b|\b(?:offbeat|syncopated|polyrhythm|euclidean|fill)\b|\b(?:pattern|groove|rhythm|beat|sequence|arrangement)\s+(?:change|rewrite|redo)\b|\b(?:move|shift|relocate)\s+(?:hits?|steps?)\b|\b(?:rewrite|rework|rebuild)\s+(?:the\s+)?(?:pattern|groove|beat)\b)",
        )
        .unwrap()
    })
}

fn param_range_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\b(?:between|from)\s+(\d+)\s+(?:and|to|-)\s+(\d+)").unwrap())
}

pub fn track_has_content(pattern: &Pattern, track: &str, steps: usize) -> bool {
    pattern
        .get(track)
        .and_then(|v| v.as_array())
        .is_some_and(|arr| {
            arr.iter()
                .take(steps)
                .any(|v| v.as_i64().unwrap_or(0) > 0)
        })
}

pub fn detect_global_rewrite(prompt: &str) -> bool {
    global_rewrite_re().is_match(prompt)
}

pub fn detect_global_variation(prompt: &str) -> bool {
    global_variation_re().is_match(prompt)
}

pub fn detect_param_fields(prompt: &str) -> HashSet<&'static str> {
    let patterns: &[(&str, &str)] = &[
        ("prob", r"(?i)\b(?:prob(?:ability)?)\b"),
        ("gate", r"(?i)\b(?:gate|length)\b"),
        ("vel", r"(?i)\b(?:velocity|vel(?:ocity)?)\b"),
        ("note", r"(?i)\b(?:note|pitch)\b"),
        ("cond", r"(?i)\b(?:conditional|cond(?:ition)?)\b"),
        ("swing", r"(?i)\bswing\b"),
        (
            "cc",
            r"(?i)\b(?:cc|tune|filter|resonance|res(?:onance)?|attack|decay|volume|reverb|delay)\b",
        ),
        ("lfo", r"(?i)\blfo\b"),
    ];
    let mut found = HashSet::new();
    for (name, pat) in patterns {
        if Regex::new(pat).unwrap().is_match(prompt) {
            found.insert(*name);
        }
    }
    found
}

pub fn detect_param_only_update(prompt: &str) -> Option<(HashSet<&'static str>, HashSet<&'static str>)> {
    if detect_global_rewrite(prompt) || detect_global_variation(prompt) {
        return None;
    }
    if step_rewrite_re().is_match(prompt) {
        return None;
    }
    let fields = detect_param_fields(prompt);
    if fields.is_empty() {
        return None;
    }
    let targets = detect_target_tracks(prompt);
    if targets.is_empty() {
        return None;
    }
    Some((targets, fields))
}

pub fn format_param_range_hint(prompt: &str) -> String {
    let Some(caps) = param_range_re().captures(prompt) else {
        return String::new();
    };
    let mut lo: i64 = caps.get(1).unwrap().as_str().parse().unwrap_or(0);
    let mut hi: i64 = caps.get(2).unwrap().as_str().parse().unwrap_or(0);
    if lo > hi {
        std::mem::swap(&mut lo, &mut hi);
    }
    format!(" (use values {lo}–{hi} where applicable)")
}

fn param_field_label(field: &str) -> &str {
    match field {
        "prob" => "probability",
        "gate" => "gate",
        "vel" => "velocity",
        "note" => "note",
        "cond" => "conditional trig",
        "swing" => "swing",
        "cc" => "CC",
        "lfo" => "LFO",
        _ => field,
    }
}

pub fn resolve_preserve_tracks(
    prompt: &str,
    pattern: &Pattern,
    steps: usize,
    variation: bool,
) -> HashSet<&'static str> {
    if !variation || pattern.is_empty() {
        return HashSet::new();
    }
    let content: HashSet<_> = TRACK_NAMES
        .iter()
        .filter(|t| track_has_content(pattern, t, steps))
        .copied()
        .collect();
    if content.is_empty() {
        return HashSet::new();
    }
    if detect_global_rewrite(prompt) {
        return HashSet::new();
    }
    let targets = detect_target_tracks(prompt);
    if !targets.is_empty() {
        return content.difference(&targets).copied().collect();
    }
    if detect_global_variation(prompt) {
        return HashSet::new();
    }
    content
}

pub fn format_targeted_update_block(
    preserve: &HashSet<&'static str>,
    modify: &HashSet<&'static str>,
    param_only: Option<(&HashSet<&'static str>, &HashSet<&'static str>)>,
    param_range_hint: &str,
) -> String {
    if let Some((tracks, fields)) = param_only {
        let mut labels: Vec<_> = fields.iter().map(|f| param_field_label(f)).collect();
        labels.sort_unstable();
        let mut track_list: Vec<_> = tracks.iter().copied().collect();
        track_list.sort_unstable();
        let mut lines = vec![
            "TARGETED UPDATE — parameter-only (do not add, remove, or move hits):".to_string(),
            format!(
                "  ADJUST {} on: {}{param_range_hint}",
                labels.join(", "),
                track_list.join(", ")
            ),
            "  Keep every existing hit position on those tracks; change only the requested parameter."
                .to_string(),
        ];
        if !preserve.is_empty() {
            let mut p: Vec<_> = preserve.iter().copied().collect();
            p.sort_unstable();
            lines.push(format!(
                "  PRESERVE EXACTLY (copy steps and all params from previous pattern): {}",
                p.join(", ")
            ));
        }
        if !tracks.is_empty() {
            lines.push(format!(
                "  PRESERVE STEP POSITIONS on adjusted tracks (hits only): {}",
                track_list.join(", ")
            ));
        }
        lines.push(String::new());
        return lines.join("\n");
    }

    let mut lines = vec!["TARGETED UPDATE — only modify the listed tracks:".to_string()];
    if !modify.is_empty() {
        let mut m: Vec<_> = modify.iter().copied().collect();
        m.sort_unstable();
        lines.push(format!("  MODIFY: {}", m.join(", ")));
    } else {
        lines.push(
            "  MODIFY: (none — adjust global swing/CC/prob only; do not add hits to silent tracks unless the request explicitly asks for them)".to_string(),
        );
    }
    if !preserve.is_empty() {
        let mut p: Vec<_> = preserve.iter().copied().collect();
        p.sort_unstable();
        lines.push(format!(
            "  PRESERVE EXACTLY (copy steps verbatim from previous pattern): {}",
            p.join(", ")
        ));
    }
    lines.push(String::new());
    lines.join("\n")
}

pub fn merge_preserved_tracks(
    pattern: &mut Pattern,
    existing: &Pattern,
    preserve: &HashSet<&'static str>,
    steps: usize,
) {
    if preserve.is_empty() {
        return;
    }
    let st = AppState::new();
    let ex = st.normalize_pattern_length(existing.clone(), Some(steps as i64));
    for track in preserve {
        if let Some(v) = ex.get(*track) {
            pattern.insert(track.to_string(), v.clone());
        }
    }
    for key in ["prob", "gate", "cond", "note"] {
        let Some(ex_sub) = ex.get(key).and_then(|v| v.as_object()) else {
            continue;
        };
        let pat_sub = pattern
            .entry(key.to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap();
        for track in preserve {
            if let Some(v) = ex_sub.get(*track) {
                pat_sub.insert(track.to_string(), v.clone());
            }
        }
    }
    if let Some(ex_sc) = ex.get("step_cc").and_then(|v| v.as_object()) {
        let pat_sc = pattern
            .entry("step_cc".to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap();
        for track in preserve {
            if let Some(v) = ex_sc.get(*track) {
                pat_sc.insert(track.to_string(), v.clone());
            }
        }
    }
    if let Some(ex_eu) = ex.get("euclid").and_then(|v| v.as_object()) {
        let pat_eu = pattern
            .entry("euclid".to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap();
        for track in preserve {
            if let Some(v) = ex_eu.get(*track) {
                pat_eu.insert(track.to_string(), v.clone());
            }
        }
    }
}

pub fn merge_preserved_steps_only(
    pattern: &mut Pattern,
    existing: &Pattern,
    tracks: &HashSet<&'static str>,
    steps: usize,
) {
    if tracks.is_empty() {
        return;
    }
    let st = AppState::new();
    let ex = st.normalize_pattern_length(existing.clone(), Some(steps as i64));
    for track in tracks {
        if let Some(v) = ex.get(*track) {
            pattern.insert(track.to_string(), v.clone());
        }
    }
}

pub fn coerce_pattern_dict(
    data: &Map<String, Value>,
    steps: usize,
) -> Option<(Pattern, Option<i64>, HashMap<String, HashMap<String, i64>>, Option<String>)> {
    if !TRACK_NAMES.iter().all(|t| data.contains_key(*t)) {
        return None;
    }
    for t in TRACK_NAMES {
        let arr = data.get(t)?.as_array()?;
        if arr.len() != steps {
            return None;
        }
        if !arr.iter().all(|v| v.as_i64().is_some_and(|n| (0..=127).contains(&n))) {
            return None;
        }
    }
    let producer_notes = data
        .get("producer_notes")
        .and_then(|v| v.as_str())
        .and_then(|s| normalize_producer_notes(s));
    if data.contains_key("producer_notes") && producer_notes.is_none() {
        return None;
    }
    let bpm = data.get("bpm").and_then(|v| v.as_i64()).filter(|b| (20..=400).contains(b));
    let mut pattern = Map::new();
    for t in TRACK_NAMES {
        pattern.insert(t.to_string(), data.get(t)?.clone());
    }
    if let Some(prob) = data.get("prob") {
        if !prob.is_object() {
            return None;
        }
        pattern.insert("prob".into(), prob.clone());
    }
    if let Some(swing) = data.get("swing").and_then(|v| v.as_i64()) {
        if !(0..=100).contains(&swing) {
            return None;
        }
        pattern.insert("swing".into(), json!(swing));
    }
    if let Some(sm) = data.get("seq_mode").and_then(|v| v.as_str()) {
        if sm == SEQ_MODE_EUCLIDEAN {
            pattern.insert("seq_mode".into(), json!(SEQ_MODE_EUCLIDEAN));
        } else if sm == SEQ_MODE_STANDARD {
            pattern.insert("seq_mode".into(), json!(SEQ_MODE_STANDARD));
        }
    }
    if let Some(eu) = data.get("euclid").and_then(|v| v.as_object()) {
        let mut merged = Map::new();
        for t in TRACK_NAMES {
            if let Some(row) = eu.get(t).and_then(|v| v.as_object()) {
                let k = row.get("k")?.as_i64()?;
                let n = row.get("n")?.as_i64()?;
                let r = row.get("r")?.as_i64()?;
                let (k, n, r) = clamp_euclid_triplet(k, n, r);
                merged.insert(
                    t.to_string(),
                    json!({"k": k, "n": n, "r": r}),
                );
            }
        }
        if !merged.is_empty() {
            pattern.insert("euclid".into(), Value::Object(merged));
        }
    }
    if let Some(lfo) = data.get("lfo") {
        pattern.insert("lfo".into(), lfo.clone());
        sanitize_lfo_in_pattern(&mut pattern, steps as i64);
    }
    let mut cc_changes: HashMap<String, HashMap<String, i64>> = HashMap::new();
    if let Some(raw_cc) = data.get("cc").and_then(|v| v.as_object()) {
        for (track, params) in raw_cc {
            if !TRACK_NAMES.contains(&track.as_str()) {
                continue;
            }
            let Some(params) = params.as_object() else {
                continue;
            };
            for (param, value) in params {
                let Some(v) = value.as_i64() else {
                    continue;
                };
                if !(0..=127).contains(&v) {
                    continue;
                }
                cc_changes
                    .entry(track.clone())
                    .or_default()
                    .insert(param.clone(), v);
            }
        }
    }
    Some((pattern, bpm, cc_changes, producer_notes))
}

pub fn compute_generation_summary(
    prompt: &str,
    pattern: &Pattern,
    latency_ms: i64,
    producer_notes: Option<&str>,
) -> Map<String, Value> {
    let abbrev: HashMap<&str, &str> = HashMap::from([
        ("kick", "BD"),
        ("snare", "SD"),
        ("tom", "LT"),
        ("clap", "CL"),
        ("bell", "BL"),
        ("hihat", "CH"),
        ("openhat", "OH"),
        ("cymbal", "CY"),
    ]);
    let mut parts = Vec::new();
    for track in TRACK_NAMES {
        if let Some(arr) = pattern.get(track).and_then(|v| v.as_array()) {
            let active = arr.iter().filter(|v| v.as_i64().unwrap_or(0) > 0).count();
            if active > 0 {
                parts.push(format!("{}x{active}", abbrev.get(track).unwrap_or(&track)));
            }
        }
    }
    let mut summary = Map::from_iter([
        ("prompt".into(), json!(prompt)),
        (
            "track_summary".into(),
            json!(if parts.is_empty() {
                "empty".to_string()
            } else {
                parts.join("  ")
            }),
        ),
        ("latency_ms".into(), json!(latency_ms)),
    ]);
    if let Some(n) = producer_notes {
        summary.insert("producer_notes".into(), json!(n));
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opus_tokens_scale() {
        assert_eq!(opus_max_output_tokens(16), 2048);
        assert!(opus_max_output_tokens(32) > 2048);
    }

    #[test]
    fn parse_ask_strips_marker() {
        let (ans, imp) = parse_ask_response("Line\nIMPLEMENTABLE: YES");
        assert!(imp);
        assert!(!ans.contains("IMPLEMENTABLE"));
    }

    #[test]
    fn detect_param_only_closed_hat_probability() {
        let prompt =
            "update the probability of the closed hat hits, set it between 40 and 100";
        let result = detect_param_only_update(prompt).expect("param-only");
        assert!(result.0.contains("hihat"));
        assert!(result.1.contains("prob"));
    }

    #[test]
    fn merge_preserved_steps_only_keeps_prob() {
        let mut existing = Map::new();
        existing.insert("hihat".into(), json!([0, 80, 0, 80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        existing.insert("prob".into(), json!({"hihat": vec![100; 16]}));
        let mut incoming = Map::new();
        incoming.insert("hihat".into(), json!(vec![80; 16]));
        incoming.insert("prob".into(), json!({"hihat": vec![50; 16]}));
        let mut tracks = HashSet::new();
        tracks.insert("hihat");
        merge_preserved_steps_only(&mut incoming, &existing, &tracks, 16);
        assert_eq!(
            incoming.get("hihat").and_then(|v| v.as_array()).unwrap()[1],
            json!(80)
        );
        assert_eq!(
            incoming
                .get("prob")
                .and_then(|v| v.get("hihat"))
                .and_then(|v| v.as_array())
                .unwrap()[0],
            json!(50)
        );
    }
}
