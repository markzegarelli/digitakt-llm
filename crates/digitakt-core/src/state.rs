use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use serde_json::{json, Map, Value};

use crate::euclidean::normalize_euclid_in_pattern;
use crate::fill_fsm::FillFsm;
use crate::lfo::sanitize_lfo_in_pattern;
use crate::pattern::{deep_copy, Pattern};
use crate::types::{cc_defaults, DEFAULT_GATE_PCT, TRACK_NAMES};

const HISTORY_MAX: usize = 20;

#[derive(Debug, Clone)]
pub struct HistoryEntry {
    pub prompt: String,
    pub pattern: Pattern,
    pub timestamp: f64,
}

#[derive(Debug)]
pub struct AppState {
    inner: RwLock<AppStateInner>,
}

#[derive(Debug)]
struct AppStateInner {
    current_pattern: Pattern,
    pending_pattern: Option<Pattern>,
    chain: Vec<String>,
    chain_patterns: Vec<Pattern>,
    chain_index: i64,
    chain_auto: bool,
    chain_queued_index: Option<usize>,
    chain_queued_pattern: Option<Pattern>,
    chain_armed: bool,
    bpm: f64,
    is_playing: bool,
    midi_port_name: Option<String>,
    last_prompt: Option<String>,
    pattern_history: Vec<HistoryEntry>,
    track_cc: HashMap<String, Map<String, Value>>,
    track_muted: HashMap<String, bool>,
    track_velocity: HashMap<String, i64>,
    track_pitch: HashMap<String, i64>,
    pattern_length: i64,
    fill_pattern: Option<Pattern>,
    pending_mutes: HashMap<String, bool>,
    fill_active: bool,
    cc_focused_track: String,
    fill_fsm: FillFsm,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        let mut track_cc = HashMap::new();
        let mut track_muted = HashMap::new();
        let mut track_velocity = HashMap::new();
        let mut track_pitch = HashMap::new();
        for t in TRACK_NAMES {
            track_cc.insert(t.into(), cc_defaults());
            track_muted.insert(t.into(), false);
            track_velocity.insert(t.into(), 127);
            track_pitch.insert(t.into(), 60);
        }
        Self {
            inner: RwLock::new(AppStateInner {
                current_pattern: Map::new(),
                pending_pattern: None,
                chain: vec![],
                chain_patterns: vec![],
                chain_index: -1,
                chain_auto: false,
                chain_queued_index: None,
                chain_queued_pattern: None,
                chain_armed: false,
                bpm: 120.0,
                is_playing: false,
                midi_port_name: None,
                last_prompt: None,
                pattern_history: vec![],
                track_cc,
                track_muted,
                track_velocity,
                track_pitch,
                pattern_length: 16,
                fill_pattern: None,
                pending_mutes: HashMap::new(),
                fill_active: false,
                cc_focused_track: "kick".into(),
                fill_fsm: FillFsm::new(),
            }),
        }
    }

    pub fn bpm(&self) -> f64 {
        self.inner.read().bpm
    }

    pub fn is_playing(&self) -> bool {
        self.inner.read().is_playing
    }

    pub fn pattern_length(&self) -> i64 {
        self.inner.read().pattern_length
    }

    pub fn current_pattern(&self) -> Pattern {
        self.inner.read().current_pattern.clone()
    }

    pub fn pending_pattern(&self) -> Option<Pattern> {
        self.inner.read().pending_pattern.clone()
    }

    pub fn last_prompt(&self) -> Option<String> {
        self.inner.read().last_prompt.clone()
    }

    pub fn set_last_prompt(&self, prompt: Option<&str>) {
        self.inner.write().last_prompt = prompt.map(String::from);
    }

    pub fn pattern_history_len(&self) -> usize {
        self.inner.read().pattern_history.len()
    }

    pub fn pattern_history_prompt(&self, idx: usize) -> Option<String> {
        self.inner.read().pattern_history.get(idx).map(|e| e.prompt.clone())
    }

    pub fn track_muted(&self, track: &str) -> bool {
        self.inner.read().track_muted.get(track).copied().unwrap_or(false)
    }

    pub fn pending_mutes(&self) -> HashMap<String, bool> {
        self.inner.read().pending_mutes.clone()
    }

    pub fn fill_pattern(&self) -> Option<Pattern> {
        self.inner.read().fill_pattern.clone()
    }

    pub fn track_pitch(&self, track: &str) -> i64 {
        self.inner.read().track_pitch.get(track).copied().unwrap_or(60)
    }

    pub fn track_cc_value(&self, track: &str, param: &str) -> Option<i64> {
        self.inner
            .read()
            .track_cc
            .get(track)?
            .get(param)?
            .as_i64()
    }

    pub fn chain_index(&self) -> i64 {
        self.inner.read().chain_index
    }

    pub fn set_chain_index(&self, idx: i64) {
        self.inner.write().chain_index = idx;
    }

    pub fn queue_fill(&self, pattern: Pattern) {
        let mut s = self.inner.write();
        s.fill_pattern = Some(pattern.clone());
        s.fill_fsm.queue(pattern);
    }

    pub fn queue_fill_from_chain_slot(&self, slot: usize) -> Map<String, Value> {
        let mut s = self.inner.write();
        if s.chain_patterns.is_empty() {
            return json!({"ok": false, "code": "no_chain"}).as_object().unwrap().clone();
        }
        if slot < 1 || slot > s.chain_patterns.len() {
            return json!({"ok": false, "code": "bad_slot"}).as_object().unwrap().clone();
        }
        if s.fill_active {
            return json!({"ok": false, "code": "fill_active"}).as_object().unwrap().clone();
        }
        let pattern_name = s.chain[slot - 1].clone();
        let raw = deep_copy(&s.chain_patterns[slot - 1]);
        let normalized = Self::normalize_pattern_length_inner(&s, raw, None);
        s.fill_pattern = Some(normalized.clone());
        s.fill_fsm.queue(normalized);
        let mut out = Map::new();
        out.insert("ok".into(), json!(true));
        out.insert("slot".into(), json!(slot));
        out.insert("pattern_name".into(), json!(pattern_name));
        out.insert("queued".into(), json!(true));
        out
    }

    pub fn set_bpm(&self, bpm: f64) {
        self.inner.write().bpm = bpm;
    }

    pub fn set_playing(&self, playing: bool) {
        self.inner.write().is_playing = playing;
    }

    pub fn set_pattern_length(&self, steps: i64) {
        self.inner.write().pattern_length = steps;
    }

    pub fn update_pitch(&self, track: &str, value: i64) {
        self.inner.write().track_pitch.insert(track.into(), value);
    }

    pub fn update_velocity(&self, track: &str, value: i64) {
        self.inner.write().track_velocity.insert(track.into(), value);
    }

    pub fn update_mute(&self, track: &str, muted: bool) {
        self.inner.write().track_muted.insert(track.into(), muted);
    }

    pub fn queue_mute(&self, track: &str, muted: bool) {
        self.inner.write().pending_mutes.insert(track.into(), muted);
    }

    pub fn apply_pending_mutes(&self) -> Option<HashMap<String, bool>> {
        let mut s = self.inner.write();
        if s.pending_mutes.is_empty() {
            return None;
        }
        let changes = std::mem::take(&mut s.pending_mutes);
        for (track, muted) in &changes {
            s.track_muted.insert(track.clone(), *muted);
        }
        Some(changes)
    }

    pub fn queue_pattern(&self, pattern: Pattern) {
        self.inner.write().pending_pattern = Some(pattern);
    }

    pub fn replace_current_pattern(&self, pattern: Pattern) {
        let mut s = self.inner.write();
        let pl = s.pattern_length;
        s.current_pattern = pattern;
        s.pending_pattern = None;
        normalize_euclid_in_pattern(
            &mut s.current_pattern,
            pl,
            &TRACK_NAMES.to_vec(),
        );
    }

    pub fn update_pattern(&self, pattern: Pattern, prompt: Option<&str>) {
        let mut s = self.inner.write();
        let pl = s.pattern_length;
        s.current_pattern = pattern;
        normalize_euclid_in_pattern(
            &mut s.current_pattern,
            pl,
            &TRACK_NAMES.to_vec(),
        );
        if let Some(p) = prompt {
            s.last_prompt = Some(p.into());
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs_f64();
            let pat = s.current_pattern.clone();
            s.pattern_history.push(HistoryEntry {
                prompt: p.into(),
                pattern: pat,
                timestamp: ts,
            });
            if s.pattern_history.len() > HISTORY_MAX {
                s.pattern_history.remove(0);
            }
        }
    }

    pub fn undo_pattern(&self) -> Option<Pattern> {
        let mut s = self.inner.write();
        if s.pattern_history.is_empty() {
            return None;
        }
        s.pattern_history.pop();
        let entry = s
            .pattern_history
            .last()
            .map(|e| e.pattern.clone())
            .or_else(|| s.pattern_history.first().map(|e| e.pattern.clone()));
        if let Some(ref last) = s.pattern_history.last() {
            s.last_prompt = Some(last.prompt.clone());
        }
        if let Some(pat) = entry {
            s.pending_pattern = Some(pat.clone());
            Some(pat)
        } else {
            None
        }
    }

    pub fn is_fill_active(&self) -> bool {
        self.inner.read().fill_active
    }

    pub fn reset(&self, pattern: Pattern, bpm: f64, prompt: Option<&str>) {
        let mut s = self.inner.write();
        s.pending_pattern = Some(deep_copy(&pattern));
        s.bpm = bpm;
        s.last_prompt = prompt.map(String::from);
        for t in TRACK_NAMES {
            s.track_muted.insert(t.into(), false);
            s.track_cc.insert(t.into(), cc_defaults());
            s.track_velocity.insert(t.into(), 127);
        }
        s.pending_mutes.clear();
        s.fill_fsm = FillFsm::new();
        s.chain.clear();
        s.chain_patterns.clear();
        s.chain_index = -1;
        s.chain_auto = false;
        s.chain_queued_index = None;
        s.chain_queued_pattern = None;
        s.chain_armed = false;
    }

    pub fn set_chain(&self, names: Vec<String>, patterns: Vec<Pattern>, auto: bool) {
        let mut s = self.inner.write();
        s.chain = names;
        s.chain_patterns = patterns.into_iter().map(|p| deep_copy(&p)).collect();
        s.chain_auto = auto;
        s.chain_index = -1;
        s.chain_queued_index = None;
        s.chain_queued_pattern = None;
        s.chain_armed = false;
    }

    pub fn normalize_pattern_length(&self, pattern: Pattern, steps: Option<i64>) -> Pattern {
        let s = self.inner.read();
        Self::normalize_pattern_length_inner(&s, pattern, steps)
    }

    fn normalize_pattern_length_inner(
        s: &AppStateInner,
        pattern: Pattern,
        steps: Option<i64>,
    ) -> Pattern {
        let target = steps.unwrap_or(s.pattern_length) as usize;
        let mut result = deep_copy(&pattern);

        for track in TRACK_NAMES {
            let mut cur: Vec<i64> = result
                .get(track)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
                .unwrap_or_default();
            if cur.len() < target {
                cur.extend(std::iter::repeat(0).take(target - cur.len()));
            } else {
                cur.truncate(target);
            }
            result.insert((*track).into(), Value::Array(cur.into_iter().map(Value::from).collect()));
        }

        if let Some(prob) = result.get("prob").and_then(|v| v.as_object()).cloned() {
            let mut new_prob = Map::new();
            for (track, vals) in prob {
                if let Some(arr) = vals.as_array() {
                    let mut row: Vec<i64> = arr.iter().filter_map(|v| v.as_i64()).collect();
                    while row.len() < target {
                        row.push(100);
                    }
                    row.truncate(target);
                    new_prob.insert(track, Value::Array(row.into_iter().map(Value::from).collect()));
                }
            }
            result.insert("prob".into(), Value::Object(new_prob));
        }

        if let Some(gate) = result.get("gate").and_then(|v| v.as_object()).cloned() {
            let mut new_gate = Map::new();
            for (track, vals) in gate {
                if let Some(arr) = vals.as_array() {
                    let mut row: Vec<i64> = arr.iter().filter_map(|v| v.as_i64()).collect();
                    while row.len() < target {
                        row.push(DEFAULT_GATE_PCT);
                    }
                    row.truncate(target);
                    new_gate.insert(track, Value::Array(row.into_iter().map(Value::from).collect()));
                }
            }
            result.insert("gate".into(), Value::Object(new_gate));
        }

        if let Some(cond) = result.get("cond").and_then(|v| v.as_object()).cloned() {
            let mut new_cond = Map::new();
            for (track, vals) in cond {
                if let Some(arr) = vals.as_array() {
                    let mut row: Vec<Value> = arr.to_vec();
                    while row.len() < target {
                        row.push(Value::Null);
                    }
                    row.truncate(target);
                    new_cond.insert(track, Value::Array(row));
                }
            }
            result.insert("cond".into(), Value::Object(new_cond));
        }

        normalize_euclid_in_pattern(&mut result, target as i64, &TRACK_NAMES.to_vec());
        sanitize_lfo_in_pattern(&mut result, target as i64);
        result
    }

    pub fn apply_bar_boundary(&self) -> Map<String, Value> {
        let mut s = self.inner.write();

        let mute_changes = if s.pending_mutes.is_empty() {
            None
        } else {
            let changes = std::mem::take(&mut s.pending_mutes);
            for (track, muted) in &changes {
                s.track_muted.insert(track.clone(), *muted);
            }
            Some(changes)
        };

        let chain_armed = Self::prepare_auto_chain(&mut s);

        let mut pattern_changed = false;
        if let Some(pending) = s.pending_pattern.take() {
            s.current_pattern = pending;
            pattern_changed = true;
        }

        let chain_advanced = if pattern_changed {
            Self::finalize_chain_advance_if_needed(&mut s)
        } else {
            None
        };

        let pl = s.pattern_length;
        let current = s.current_pattern.clone();
        let (next_pattern, fill_event) = s.fill_fsm.advance(current);
        if fill_event.is_some() {
            s.current_pattern = next_pattern;
            match fill_event {
                Some("fill_started") => {
                    s.fill_pattern = None;
                    s.fill_active = true;
                }
                Some("fill_ended") => {
                    s.fill_active = false;
                }
                _ => {}
            }
        }

        normalize_euclid_in_pattern(
            &mut s.current_pattern,
            pl,
            &TRACK_NAMES.to_vec(),
        );

        let mut out = Map::new();
        out.insert(
            "mute_changes".into(),
            mute_changes
                .map(|m| {
                    Value::Object(m.into_iter().map(|(k, v)| (k, json!(v))).collect())
                })
                .unwrap_or(Value::Null),
        );
        out.insert("pattern_changed".into(), json!(pattern_changed));
        out.insert(
            "fill_event".into(),
            fill_event.map(|e| json!(e)).unwrap_or(Value::Null),
        );
        out.insert(
            "chain_armed".into(),
            chain_armed.unwrap_or(Value::Null),
        );
        out.insert(
            "chain_advanced".into(),
            chain_advanced.unwrap_or(Value::Null),
        );
        out.insert(
            "current_pattern".into(),
            Value::Object(s.current_pattern.clone()),
        );
        out
    }

    fn prepare_auto_chain(s: &mut AppStateInner) -> Option<Value> {
        if !s.chain_auto || s.chain_patterns.is_empty() || s.pending_pattern.is_some() {
            return None;
        }
        let next_index = if s.chain_index < 0 {
            0
        } else {
            ((s.chain_index as usize + 1) % s.chain_patterns.len()) as usize
        };
        s.chain_queued_index = Some(next_index);
        s.chain_queued_pattern = Some(deep_copy(&s.chain_patterns[next_index]));
        s.pending_pattern = s.chain_queued_pattern.clone();
        s.chain_armed = true;
        Some(json!({
            "chain": s.chain,
            "chain_index": s.chain_index,
            "chain_queued_index": s.chain_queued_index,
            "chain_auto": s.chain_auto,
        }))
    }

    fn finalize_chain_advance_if_needed(s: &mut AppStateInner) -> Option<Value> {
        if !s.chain_armed || s.chain_queued_index.is_none() {
            return None;
        }
        s.chain_index = s.chain_queued_index.unwrap() as i64;
        s.chain_queued_index = None;
        s.chain_queued_pattern = None;
        s.chain_armed = false;
        Some(json!({
            "chain": s.chain,
            "chain_index": s.chain_index,
            "chain_queued_index": Value::Null,
            "chain_auto": s.chain_auto,
            "chain_armed": s.chain_armed,
        }))
    }

    pub fn update_cc(&self, track: &str, param: &str, value: i64) {
        let mut s = self.inner.write();
        if let Some(params) = s.track_cc.get_mut(track) {
            params.insert(param.into(), json!(value));
        }
    }

    pub fn track_cc_map(&self) -> HashMap<String, Map<String, Value>> {
        self.inner.read().track_cc.clone()
    }

    pub fn set_current_pattern_raw(&self, pattern: Pattern) {
        self.inner.write().current_pattern = pattern;
    }

    /// Set live pattern and normalize euclidean rows (mutator path; keeps pending_pattern).
    pub fn assign_current_pattern(&self, pattern: Pattern) {
        let mut s = self.inner.write();
        let pl = s.pattern_length;
        s.current_pattern = pattern;
        normalize_euclid_in_pattern(
            &mut s.current_pattern,
            pl,
            &TRACK_NAMES.to_vec(),
        );
    }

    pub fn cc_focused_track(&self) -> String {
        self.inner.read().cc_focused_track.clone()
    }

    pub fn set_cc_focused_track(&self, track: &str) {
        self.inner.write().cc_focused_track = track.into();
    }

    pub fn track_velocity(&self, track: &str) -> i64 {
        self.inner
            .read()
            .track_velocity
            .get(track)
            .copied()
            .unwrap_or(127)
    }

    pub fn midi_port_name(&self) -> Option<String> {
        self.inner.read().midi_port_name.clone()
    }

    pub fn set_midi_port_name(&self, name: Option<String>) {
        self.inner.write().midi_port_name = name;
    }

    pub fn chain(&self) -> Vec<String> {
        self.inner.read().chain.clone()
    }

    pub fn chain_auto(&self) -> bool {
        self.inner.read().chain_auto
    }

    pub fn chain_queued_index(&self) -> Option<usize> {
        self.inner.read().chain_queued_index
    }

    pub fn chain_armed(&self) -> bool {
        self.inner.read().chain_armed
    }

    pub fn track_muted_map(&self) -> HashMap<String, bool> {
        self.inner.read().track_muted.clone()
    }

    pub fn track_velocity_map(&self) -> HashMap<String, i64> {
        self.inner.read().track_velocity.clone()
    }

    pub fn track_pitch_map(&self) -> HashMap<String, i64> {
        self.inner.read().track_pitch.clone()
    }

    pub fn pattern_history_json(&self) -> Vec<Map<String, Value>> {
        self.inner
            .read()
            .pattern_history
            .iter()
            .map(|e| {
                Map::from_iter([
                    ("prompt".into(), json!(e.prompt)),
                    ("pattern".into(), json!(e.pattern)),
                    ("timestamp".into(), json!(e.timestamp)),
                ])
            })
            .collect()
    }

    pub fn swing(&self) -> i64 {
        self.inner
            .read()
            .current_pattern
            .get("swing")
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
    }

    pub fn clear_chain(&self) {
        let mut s = self.inner.write();
        s.chain.clear();
        s.chain_patterns.clear();
        s.chain_index = -1;
        s.chain_auto = false;
        s.chain_queued_index = None;
        s.chain_queued_pattern = None;
        s.chain_armed = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{default_pattern, empty_pattern, cc_defaults, zeros};

    fn make_pat(val: i64) -> Pattern {
        let mut m = Map::new();
        for t in TRACK_NAMES {
            m.insert(t.into(), Value::Array(vec![Value::from(val); 16]));
        }
        m
    }

    #[test]
    fn test_initial_values() {
        let state = AppState::new();
        assert_eq!(state.bpm(), 120.0);
        assert!(!state.is_playing());
        assert!(state.current_pattern().is_empty());
        assert!(state.pending_pattern().is_none());
    }

    #[test]
    fn test_update_pattern_history_cap() {
        let state = AppState::new();
        let pat = empty_pattern();
        for i in 0..25 {
            state.update_pattern(pat.clone(), Some(&format!("prompt {i}")));
        }
        assert_eq!(state.pattern_history_len(), 20);
        assert_eq!(state.pattern_history_prompt(0).unwrap(), "prompt 5");
    }

    fn track_rows_equal(a: &Pattern, b: &Pattern) -> bool {
        TRACK_NAMES.iter().all(|t| a.get(*t) == b.get(*t))
    }

    #[test]
    fn test_apply_bar_boundary_swaps_pending() {
        let state = AppState::new();
        let old = make_pat(1);
        let new = make_pat(2);
        state.set_current_pattern_raw(old);
        state.queue_pattern(new.clone());
        let result = state.apply_bar_boundary();
        assert_eq!(result["pattern_changed"], true);
        assert!(track_rows_equal(&state.current_pattern(), &new));
    }

    #[test]
    fn test_fill_lifecycle() {
        let state = AppState::new();
        let current = make_pat(1);
        let fill = make_pat(99);
        state.set_current_pattern_raw(current.clone());
        state.queue_fill(fill.clone());
        let r1 = state.apply_bar_boundary();
        assert_eq!(r1["fill_event"], "fill_started");
        let r2 = state.apply_bar_boundary();
        assert_eq!(r2["fill_event"], "fill_ended");
        assert!(track_rows_equal(&state.current_pattern(), &current));
    }

    #[test]
    fn test_queue_fill_from_chain_slot() {
        let state = AppState::new();
        let p1 = make_pat(10);
        let p2 = make_pat(20);
        state.set_chain(vec!["a".into(), "b".into()], vec![p1, p2], false);
        state.set_chain_index(0);
        let res = state.queue_fill_from_chain_slot(2);
        assert_eq!(res["ok"], true);
        assert_eq!(res["pattern_name"], "b");
    }

    #[test]
    fn test_default_and_empty_pattern() {
        let dp = default_pattern();
        assert_eq!(dp.len(), 8);
        let ep = empty_pattern();
        for t in TRACK_NAMES {
            assert_eq!(ep[t], zeros(16));
        }
        let _ = cc_defaults();
    }
}
