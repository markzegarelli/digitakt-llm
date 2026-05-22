//! Transport / step playback (parity with `core/player.py`).

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use digitakt_core::{
    apply_depth_clamp, lfo_mod_w, track_euclidean_hit, AppState, Pattern, SEQ_MODE_EUCLIDEAN,
    DEFAULT_GATE_PCT, TRACK_NAMES,
};
use digitakt_midi::{
    cc_map, channel_for_track, send_cc, send_clock, send_note, send_note_off, send_start, send_stop,
    MidiSink,
};
use parking_lot::Mutex;
use rand::Rng;
use serde_json::{json, Map, Value};

use crate::events::EventBus;

struct ScheduledNoteOff {
    at: Instant,
    note: u8,
    channel: u8,
}

impl PartialEq for ScheduledNoteOff {
    fn eq(&self, other: &Self) -> bool {
        self.at == other.at
    }
}
impl Eq for ScheduledNoteOff {}
impl PartialOrd for ScheduledNoteOff {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for ScheduledNoteOff {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.at.cmp(&other.at)
    }
}

pub struct Player {
    pub(crate) state: Arc<AppState>,
    bus: Arc<EventBus>,
    port: Arc<Mutex<Option<Arc<Mutex<dyn MidiSink + Send>>>>>,
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    pub(crate) loop_count: Arc<AtomicU64>,
    gate_heap: Arc<Mutex<BinaryHeap<Reverse<ScheduledNoteOff>>>>,
    random_unit: Arc<dyn Fn() -> f64 + Send + Sync>,
}

impl Player {
    pub fn new(
        state: Arc<AppState>,
        bus: Arc<EventBus>,
        port: Option<Arc<Mutex<dyn MidiSink + Send>>>,
    ) -> Self {
        Self::with_random(state, bus, port, Arc::new(|| rand::thread_rng().gen::<f64>()))
    }

    pub fn with_random(
        state: Arc<AppState>,
        bus: Arc<EventBus>,
        port: Option<Arc<Mutex<dyn MidiSink + Send>>>,
        random_unit: Arc<dyn Fn() -> f64 + Send + Sync>,
    ) -> Self {
        Self {
            state,
            bus,
            port: Arc::new(Mutex::new(port)),
            stop: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
            loop_count: Arc::new(AtomicU64::new(0)),
            gate_heap: Arc::new(Mutex::new(BinaryHeap::new())),
            random_unit,
        }
    }

    pub fn port(&self) -> Option<Arc<Mutex<dyn MidiSink + Send>>> {
        self.port.lock().clone()
    }

    pub fn set_port(&self, port: Option<Arc<Mutex<dyn MidiSink + Send>>>) {
        *self.port.lock() = port;
    }

    fn port_ref(&self) -> Option<Arc<Mutex<dyn MidiSink + Send>>> {
        self.port.lock().clone()
    }

    pub fn queue_pattern(&self, pattern: Pattern) {
        self.state.queue_pattern(pattern);
    }

    pub fn set_bpm(&self, bpm: f64) {
        self.state.set_bpm(bpm);
        let mut p = Map::new();
        p.insert("bpm".into(), json!(bpm));
        self.bus.emit("bpm_changed", Some(p));
    }

    pub fn step_duration(&self) -> f64 {
        60.0 / self.state.bpm() / 4.0
    }

    pub fn tick_duration(&self) -> f64 {
        60.0 / self.state.bpm() / 24.0
    }

    pub fn swing_delay(&self) -> f64 {
        let pattern = self.state.current_pattern();
        let swing = pattern
            .get("swing")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if swing == 0 {
            return 0.0;
        }
        (swing as f64 / 100.0) * self.step_duration() / 3.0
    }

    fn drain_gate_offs(&self) {
        let now = Instant::now();
        let Some(port) = self.port_ref() else {
            self.gate_heap.lock().clear();
            return;
        };
        let mut heap = self.gate_heap.lock();
        while heap.peek().is_some_and(|Reverse(off)| off.at <= now) {
            let Reverse(off) = heap.pop().unwrap();
            let _ = send_note_off(&mut *port.lock(), off.note, off.channel);
        }
    }

    fn schedule_gate_off(&self, gate_pct: i64, note: u8, channel: u8) {
        if gate_pct >= 100 {
            return;
        }
        let delay = (gate_pct as f64 / 100.0 * self.step_duration()).max(0.001);
        self.gate_heap.lock().push(Reverse(ScheduledNoteOff {
            at: Instant::now() + Duration::from_secs_f64(delay),
            note,
            channel,
        }));
    }

    pub fn play_step(&self, step: usize) {
        let mut dirty = HashSet::new();
        self.play_step_with_dirty(step, &mut dirty);
    }

    pub fn play_step_with_dirty(&self, step: usize, dirty_cc: &mut HashSet<(String, String)>) {
        self.drain_gate_offs();
        let pattern = self.state.current_pattern();
        let pl = self.state.pattern_length() as usize;
        if step >= pl {
            return;
        }
        let loop_count = self.loop_count.load(Ordering::SeqCst);
        let global_step = loop_count as i64 * self.state.pattern_length() + step as i64;
        let mut step_payload = Map::new();
        step_payload.insert("step".into(), json!(step));
        step_payload.insert("global_step".into(), json!(global_step));
        self.bus.emit("step_changed", Some(step_payload));

        let lfo_map = pattern.get("lfo").and_then(|v| v.as_object()).cloned();
        let cc_lookup = cc_map();

        for track in TRACK_NAMES {
            let mut base_note = self.state.track_pitch(track);
            if let Some(lfo) = lfo_map.as_ref() {
                let pk = format!("pitch:{track}:main");
                if let Some(ldef) = lfo.get(&pk).and_then(|v| v.as_object()) {
                    if let Some((w, depth)) = lfo_mod_w(ldef, self.state.pattern_length(), global_step)
                    {
                        base_note = apply_depth_clamp(base_note, w, depth, 0, 127);
                    }
                }
            }
            let mut note = base_note;
            if let Some(note_row) = pattern
                .get("note")
                .and_then(|v| v.get(track))
                .and_then(|v| v.as_array())
            {
                if let Some(v) = note_row.get(step) {
                    if !v.is_null() {
                        note = v.as_i64().unwrap_or(note);
                    }
                }
            }
            if !pattern.contains_key(track) {
                continue;
            }
            let ntk = format!("trig:{track}:note");
            if let Some(ldef) = lfo_map
                .as_ref()
                .and_then(|m| m.get(&ntk))
                .and_then(|v| v.as_object())
            {
                if let Some((w, depth)) = lfo_mod_w(ldef, self.state.pattern_length(), global_step) {
                    note = apply_depth_clamp(note, w, depth, 0, 127);
                }
            }
            if self.state.track_muted(track) {
                continue;
            }
            let prob_track = pattern
                .get("prob")
                .and_then(|v| v.get(track))
                .and_then(|v| v.as_array());
            let prk = format!("trig:{track}:prob");
            let lfo_prob = lfo_map
                .as_ref()
                .and_then(|m| m.get(&prk))
                .is_some_and(|v| v.is_object());
            if prob_track.is_some() || lfo_prob {
                let mut step_prob = prob_track
                    .and_then(|row| row.get(step))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(100);
                if lfo_prob {
                    if let Some(ldef) = lfo_map.as_ref().and_then(|m| m.get(&prk)).and_then(|v| v.as_object())
                    {
                        if let Some((w, depth)) =
                            lfo_mod_w(ldef, self.state.pattern_length(), global_step)
                        {
                            step_prob = apply_depth_clamp(step_prob, w, depth, 0, 100);
                        }
                    }
                }
                if (self.random_unit)() * 100.0 >= step_prob as f64 {
                    continue;
                }
            }
            if let Some(cond_row) = pattern
                .get("cond")
                .and_then(|v| v.get(track))
                .and_then(|v| v.as_array())
            {
                if let Some(cond) = cond_row.get(step).and_then(|v| v.as_str()) {
                    match cond {
                        "1:2" if loop_count % 2 != 0 => continue,
                        "not:2" if loop_count % 2 == 0 => continue,
                        "fill" if !self.state.is_fill_active() => continue,
                        _ => {}
                    }
                }
            }
            let euclidean = pattern.get("seq_mode").and_then(|v| v.as_str()) == Some(SEQ_MODE_EUCLIDEAN);
            if euclidean && !track_euclidean_hit(&pattern, track, step as i64) {
                continue;
            }
            let mut velocity = pattern
                .get(track)
                .and_then(|v| v.as_array())
                .and_then(|row| row.get(step))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            if euclidean && velocity <= 0 {
                velocity = 127;
            }
            let vtk = format!("trig:{track}:vel");
            if let Some(ldef) = lfo_map
                .as_ref()
                .and_then(|m| m.get(&vtk))
                .and_then(|v| v.as_object())
            {
                if let Some((w, depth)) = lfo_mod_w(ldef, self.state.pattern_length(), global_step) {
                    velocity = apply_depth_clamp(velocity, w, depth, 0, 127);
                }
            }
            if velocity <= 0 {
                continue;
            }
            let scale = self.state.track_velocity(track);
            velocity = ((velocity * scale) / 127).max(1);
            let channel = channel_for_track(track).unwrap_or(0);
            if let Some(port) = self.port_ref() {
                if send_note(&mut *port.lock(), note as u8, velocity as u8, channel).is_err() {
                    self.handle_midi_disconnect();
                    return;
                }
                let mut gate_pct = pattern
                    .get("gate")
                    .and_then(|v| v.get(track))
                    .and_then(|v| v.as_array())
                    .and_then(|row| row.get(step))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(DEFAULT_GATE_PCT);
                let gtk = format!("trig:{track}:gate");
                if let Some(ldef) = lfo_map
                    .as_ref()
                    .and_then(|m| m.get(&gtk))
                    .and_then(|v| v.as_object())
                {
                    if let Some((w, depth)) = lfo_mod_w(ldef, self.state.pattern_length(), global_step)
                    {
                        gate_pct = apply_depth_clamp(gate_pct, w, depth, 0, 100);
                    }
                }
                self.schedule_gate_off(gate_pct, note as u8, channel);
            }
        }

        // Tempo-synced LFO on CC targets
        let step_cc = pattern.get("step_cc").and_then(|v| v.as_object());
        let mut cc_lfo_handled: HashSet<(String, String)> = HashSet::new();
        if let Some(lfo) = lfo_map.as_ref() {
            for (key, ldef) in lfo {
                if !key.starts_with("cc:") || !ldef.is_object() {
                    continue;
                }
                let parts: Vec<&str> = key.splitn(3, ':').collect();
                if parts.len() != 3 {
                    continue;
                }
                let track = parts[1];
                let param = parts[2];
                if !TRACK_NAMES.contains(&track) || !cc_lookup.contains_key(param) {
                    continue;
                }
                let Some((w, depth)) =
                    lfo_mod_w(ldef.as_object().unwrap(), self.state.pattern_length(), global_step)
                else {
                    continue;
                };
                let base_cc = step_cc
                    .and_then(|sc| sc.get(track))
                    .and_then(|v| v.as_object())
                    .and_then(|row| row.get(param))
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.get(step))
                    .and_then(|v| {
                        if v.is_null() {
                            None
                        } else {
                            v.as_i64()
                        }
                    })
                    .unwrap_or_else(|| self.state.track_cc_value(track, param).unwrap_or(0));
                let val = apply_depth_clamp(base_cc, w, depth, 0, 127);
                let mut lfo_payload = Map::new();
                lfo_payload.insert("target".into(), json!(key));
                lfo_payload.insert("value".into(), json!(val));
                lfo_payload.insert("base".into(), json!(base_cc));
                lfo_payload.insert("step".into(), json!(step));
                self.bus.emit("lfo_value", Some(lfo_payload));
                let channel = channel_for_track(track).unwrap_or(0);
                cc_lfo_handled.insert((track.to_string(), param.to_string()));
                dirty_cc.insert((track.to_string(), param.to_string()));
                if let Some(port) = self.port_ref() {
                    if let Some(cc_num) = cc_lookup.get(param) {
                        if send_cc(&mut *port.lock(), channel, *cc_num, val as u8).is_err() {
                            self.handle_midi_disconnect();
                            return;
                        }
                    }
                }
            }
        }

        // Per-step CC overrides (skip params already handled by LFO)
        if let Some(sc) = step_cc {
            for track in TRACK_NAMES {
                let channel = channel_for_track(track).unwrap_or(0);
                let Some(track_row) = sc.get(track).and_then(|v| v.as_object()) else {
                    continue;
                };
                for (param, steps) in track_row {
                    let key = (track.to_string(), param.clone());
                    if cc_lfo_handled.contains(&key) {
                        continue;
                    }
                    let Some(arr) = steps.as_array() else {
                        continue;
                    };
                    let Some(override_val) = arr.get(step).and_then(|v| {
                        if v.is_null() {
                            None
                        } else {
                            v.as_i64()
                        }
                    }) else {
                        continue;
                    };
                    if !cc_lookup.contains_key(param.as_str()) {
                        continue;
                    }
                    dirty_cc.insert(key);
                    if let Some(port) = self.port_ref() {
                        if let Some(cc_num) = cc_lookup.get(param.as_str()) {
                            if send_cc(
                                &mut *port.lock(),
                                channel,
                                *cc_num,
                                override_val as u8,
                            )
                            .is_err()
                            {
                                self.handle_midi_disconnect();
                                return;
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn restore_global_cc(&self, dirty_cc: &HashSet<(String, String)>) {
        let Some(port) = self.port_ref() else {
            return;
        };
        let pattern = self.state.current_pattern();
        let lfo_skip = pattern
            .get("lfo")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        let cc_lookup = cc_map();
        for (track, param) in dirty_cc {
            let cc_key = format!("cc:{track}:{param}");
            if lfo_skip.get(&cc_key).is_some_and(|v| v.is_object()) {
                continue;
            }
            if let Some(global_val) = self.state.track_cc_value(&track, &param) {
                if let Some(cc_num) = cc_lookup.get(param.as_str()) {
                    let channel = channel_for_track(&track).unwrap_or(0);
                    let _ = send_cc(&mut *port.lock(), channel, *cc_num, global_val as u8);
                }
            }
        }
    }

    fn handle_midi_disconnect(&self) {
        self.state.set_playing(false);
        self.bus.emit("playback_stopped", None);
        let mut p = Map::new();
        p.insert("port".into(), Value::Null);
        self.bus.emit("midi_disconnected", Some(p));
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn start(&self) -> bool {
        if self
            .thread
            .lock()
            .as_ref()
            .is_some_and(|h| !h.is_finished())
        {
            return true;
        }
        if let Some(port) = self.port_ref() {
            let mut p = port.lock();
            let _ = send_start(&mut *p);
            let cc = cc_map();
            for (track, params) in self.state.track_cc_map() {
                let channel = channel_for_track(&track).unwrap_or(0);
                for (param, value) in params {
                    if let (Some(cc_num), Some(v)) = (cc.get(param.as_str()), value.as_i64()) {
                        let _ = send_cc(&mut *p, channel, *cc_num, v as u8);
                    }
                }
            }
            let _ = cc;
        }
        self.stop.store(false, Ordering::SeqCst);
        let state = self.state.clone();
        let bus = self.bus.clone();
        let stop = self.stop.clone();
        let port = self.port.clone();
        let gate_heap = self.gate_heap.clone();
        let player = PlayerLoopCtx {
            state: state.clone(),
            bus,
            stop: stop.clone(),
            port,
            gate_heap,
            loop_count: self.loop_count.clone(),
            random_unit: self.random_unit.clone(),
        };
        let handle = thread::spawn(move || player.run());
        *self.thread.lock() = Some(handle);
        self.state.set_playing(true);
        self.bus.emit("playback_started", None);
        true
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.state.set_playing(false);
        if let Some(port) = self.port_ref() {
            let _ = send_stop(&mut *port.lock());
        }
        if let Some(h) = self.thread.lock().take() {
            let _ = h.join();
        }
        self.bus.emit("playback_stopped", None);
    }

    pub fn thread_alive(&self) -> bool {
        self.thread
            .lock()
            .as_ref()
            .is_some_and(|h| !h.is_finished())
    }
}

struct PlayerLoopCtx {
    state: Arc<AppState>,
    bus: Arc<EventBus>,
    stop: Arc<AtomicBool>,
    port: Arc<Mutex<Option<Arc<Mutex<dyn MidiSink + Send>>>>>,
    gate_heap: Arc<Mutex<BinaryHeap<Reverse<ScheduledNoteOff>>>>,
    pub(crate) loop_count: Arc<AtomicU64>,
    random_unit: Arc<dyn Fn() -> f64 + Send + Sync>,
}

impl PlayerLoopCtx {
    fn port_ref(&self) -> Option<Arc<Mutex<dyn MidiSink + Send>>> {
        self.port.lock().clone()
    }

    fn step_duration(&self) -> f64 {
        60.0 / self.state.bpm() / 4.0
    }

    fn tick_duration(&self) -> f64 {
        60.0 / self.state.bpm() / 24.0
    }

    fn swing_delay(&self, pattern: &Pattern) -> f64 {
        let swing = pattern.get("swing").and_then(|v| v.as_i64()).unwrap_or(0);
        if swing == 0 {
            return 0.0;
        }
        (swing as f64 / 100.0) * self.step_duration() / 3.0
    }

    fn drain_gate_offs(&self) {
        let now = Instant::now();
        let Some(port) = self.port_ref() else {
            self.gate_heap.lock().clear();
            return;
        };
        let mut heap = self.gate_heap.lock();
        while heap.peek().is_some_and(|Reverse(off)| off.at <= now) {
            let Reverse(off) = heap.pop().unwrap();
            let _ = send_note_off(&mut *port.lock(), off.note, off.channel);
        }
    }

    fn run(self) {
        let player = Player {
            state: self.state.clone(),
            bus: self.bus.clone(),
            port: self.port.clone(),
            stop: self.stop.clone(),
            thread: Mutex::new(None),
            loop_count: self.loop_count.clone(),
            gate_heap: self.gate_heap.clone(),
            random_unit: self.random_unit.clone(),
        };
        while !self.stop.load(Ordering::SeqCst) {
            let pl = self.state.pattern_length() as usize;
            let mut dirty_cc = HashSet::new();
            let mut next_tick = Instant::now();
            for step in 0..pl {
                if self.stop.load(Ordering::SeqCst) {
                    break;
                }
                for tick in 0..6 {
                    if self.stop.load(Ordering::SeqCst) {
                        break;
                    }
                    player.drain_gate_offs();
                    if tick == 0 {
                        if step % 2 == 1 {
                            let delay = self.swing_delay(&self.state.current_pattern());
                            if delay > 0.0 {
                                thread::sleep(Duration::from_secs_f64(delay));
                            }
                        }
                        player.play_step_with_dirty(step, &mut dirty_cc);
                    }
                    if self.stop.load(Ordering::SeqCst) {
                        break;
                    }
                    if let Some(port) = self.port_ref() {
                        if send_clock(&mut *port.lock()).is_err() {
                            player.handle_midi_disconnect();
                            return;
                        }
                    }
                    next_tick += Duration::from_secs_f64(self.tick_duration());
                    let sleep = next_tick.saturating_duration_since(Instant::now());
                    if sleep > Duration::ZERO {
                        thread::sleep(sleep);
                    }
                }
            }
            player.restore_global_cc(&dirty_cc);

            let boundary = self.state.apply_bar_boundary();
            if let Some(mutes) = boundary.get("mute_changes").and_then(|v| v.as_object()) {
                if !mutes.is_empty() {
                    for (track, muted) in mutes {
                        let mut p = Map::new();
                        p.insert("track".into(), json!(track));
                        p.insert("muted".into(), muted.clone());
                        self.bus.emit("mute_changed", Some(p));
                    }
                }
            }
            if boundary.get("chain_armed").map(|v| !v.is_null()) == Some(true) {
                if let Some(payload) = boundary.get("chain_armed").and_then(|v| v.as_object()) {
                    self.bus.emit("chain_armed", Some(payload.clone()));
                }
            }
            if boundary.get("pattern_changed").and_then(|v| v.as_bool()) == Some(true) {
                let mut p = Map::new();
                p.insert(
                    "pattern".into(),
                    boundary
                        .get("current_pattern")
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                p.insert(
                    "prompt".into(),
                    json!(self.state.last_prompt().unwrap_or_default()),
                );
                self.bus.emit("pattern_changed", Some(p));
            }
            if boundary.get("chain_advanced").map(|v| !v.is_null()) == Some(true) {
                if let Some(payload) = boundary.get("chain_advanced").and_then(|v| v.as_object()) {
                    self.bus.emit("chain_advanced", Some(payload.clone()));
                }
            }
            if let Some(fill_ev) = boundary.get("fill_event").and_then(|v| v.as_str()) {
                if fill_ev == "fill_started" || fill_ev == "fill_ended" {
                    let mut p = Map::new();
                    p.insert(
                        "pattern".into(),
                        boundary
                            .get("current_pattern")
                            .cloned()
                            .unwrap_or(Value::Null),
                    );
                    self.bus.emit(fill_ev, Some(p));
                }
            }
            self.loop_count.fetch_add(1, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use digitakt_core::default_pattern;
    use digitakt_midi::MidiSink;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Recorder {
        sent: Mutex<Vec<Vec<u8>>>,
    }

    impl MidiSink for Recorder {
        fn send(&mut self, bytes: &[u8]) -> Result<(), digitakt_midi::MidiSendError> {
            self.sent.lock().push(bytes.to_vec());
            Ok(())
        }
    }

    fn make_player() -> (Arc<Player>, Arc<AppState>, Arc<EventBus>, Arc<Mutex<Recorder>>) {
        let state = Arc::new(AppState::new());
        let mut pat = default_pattern();
        state.assign_current_pattern(pat.clone());
        let bus = Arc::new(EventBus::new());
        let rec = Arc::new(Mutex::new(Recorder::default()));
        let port: Arc<Mutex<dyn MidiSink + Send>> = rec.clone();
        let player = Arc::new(Player::with_random(
            state.clone(),
            bus.clone(),
            Some(port),
            Arc::new(|| 0.0),
        ));
        (player, state, bus, rec)
    }

    #[test]
    fn queue_pattern_sets_pending() {
        let (player, state, _, _) = make_player();
        let mut empty = Map::new();
        for t in TRACK_NAMES {
            empty.insert(t.into(), json!(vec![0; 16]));
        }
        player.queue_pattern(empty.clone());
        assert_eq!(state.pending_pattern().unwrap(), empty);
    }

    #[test]
    fn set_bpm_emits() {
        let (player, state, bus, _) = make_player();
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "bpm_changed",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        player.set_bpm(140.0);
        assert_eq!(state.bpm(), 140.0);
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn step_duration_formula() {
        let (player, state, _, _) = make_player();
        state.set_bpm(120.0);
        assert!((player.step_duration() - 0.125).abs() < 1e-9);
        state.set_bpm(60.0);
        assert!((player.step_duration() - 0.25).abs() < 1e-9);
    }

    #[test]
    fn muted_track_skips_note_on() {
        let (player, state, _, rec) = make_player();
        state.update_mute("kick", true);
        player.play_step(0);
        let sent = rec.lock().sent.lock().clone();
        assert!(!sent.iter().any(|m| m.len() >= 3 && m[0] == 0x90 && m[1] == 60));
    }

    #[test]
    fn gate_under_100_schedules_note_off() {
        let (player, state, _, rec) = make_player();
        let mut pat = state.current_pattern();
        pat.insert(
            "gate".into(),
            json!({"kick": [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]}),
        );
        state.assign_current_pattern(pat);
        player.play_step(0);
        std::thread::sleep(Duration::from_millis(80));
        player.drain_gate_offs();
        let sent = rec.lock().sent.lock().clone();
        assert!(sent.iter().any(|m| m.len() >= 3 && m[0] == 0x90 && m[2] == 0));
    }

    fn pattern_with_cc_lfo() -> Pattern {
        let mut pat = default_pattern();
        pat.insert(
            "lfo".into(),
            json!({
                "cc:kick:filter": {
                    "shape": "square",
                    "depth": 100,
                    "phase": 0.0,
                    "rate": {"num": 1, "den": 8}
                }
            }),
        );
        pat
    }

    #[test]
    fn cc_lfo_emits_lfo_value_per_step() {
        let state = Arc::new(AppState::new());
        state.assign_current_pattern(pattern_with_cc_lfo());
        state.update_cc("kick", "filter", 64);
        let bus = Arc::new(EventBus::new());
        let seen = Arc::new(Mutex::new(Vec::<Map<String, Value>>::new()));
        let s2 = seen.clone();
        bus.subscribe(
            "lfo_value",
            Arc::new(move |p| s2.lock().push(p)),
        );
        let rec = Arc::new(Mutex::new(Recorder::default()));
        let port: Arc<Mutex<dyn MidiSink + Send>> = rec.clone();
        let player = Player::new(state, bus, Some(port));
        player.play_step(0);
        let events = seen.lock().clone();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].get("target").and_then(|v| v.as_str()),
            Some("cc:kick:filter")
        );
        assert_eq!(events[0].get("base").and_then(|v| v.as_i64()), Some(64));
    }

    #[test]
    fn cc_lfo_emits_without_midi_port() {
        let state = Arc::new(AppState::new());
        state.assign_current_pattern(pattern_with_cc_lfo());
        state.update_cc("kick", "filter", 64);
        let bus = Arc::new(EventBus::new());
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "lfo_value",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        let player = Player::new(state, bus, None);
        player.play_step(0);
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn lfo_marks_dirty_cc_for_bar_restore() {
        let state = Arc::new(AppState::new());
        state.assign_current_pattern(pattern_with_cc_lfo());
        state.update_cc("kick", "filter", 64);
        let bus = Arc::new(EventBus::new());
        let rec = Arc::new(Mutex::new(Recorder::default()));
        let port: Arc<Mutex<dyn MidiSink + Send>> = rec.clone();
        let player = Player::new(state, bus, Some(port));
        let mut dirty = HashSet::new();
        player.play_step_with_dirty(0, &mut dirty);
        assert!(dirty.contains(&("kick".into(), "filter".into())));
    }

    #[test]
    fn lfo_cc_not_restored_at_pattern_end() {
        let state = Arc::new(AppState::new());
        state.assign_current_pattern(pattern_with_cc_lfo());
        state.update_cc("kick", "filter", 64);
        let bus = Arc::new(EventBus::new());
        let rec = Arc::new(Mutex::new(Recorder::default()));
        let port: Arc<Mutex<dyn MidiSink + Send>> = rec.clone();
        let player = Player::new(state, bus, Some(port));
        let mut dirty = HashSet::new();
        for step in 0..16 {
            player.play_step_with_dirty(step, &mut dirty);
        }
        rec.lock().sent.lock().clear();
        player.restore_global_cc(&dirty);
        let sent = rec.lock().sent.lock().clone();
        assert!(sent.is_empty());
    }

    #[test]
    fn non_lfo_step_cc_restored_at_pattern_end() {
        let state = Arc::new(AppState::new());
        let mut pat: Pattern = TRACK_NAMES
            .iter()
            .map(|t| (t.to_string(), json!(vec![0; 16])))
            .collect();
        pat.insert(
            "step_cc".into(),
            json!({"kick": {"filter": [80, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}}),
        );
        state.assign_current_pattern(pat);
        state.update_cc("kick", "filter", 64);
        let bus = Arc::new(EventBus::new());
        let rec = Arc::new(Mutex::new(Recorder::default()));
        let port: Arc<Mutex<dyn MidiSink + Send>> = rec.clone();
        let player = Player::new(state, bus, Some(port));
        let mut dirty = HashSet::new();
        player.play_step_with_dirty(0, &mut dirty);
        rec.lock().sent.lock().clear();
        player.restore_global_cc(&dirty);
        let sent = rec.lock().sent.lock().clone();
        assert!(sent.iter().any(|m| m.len() >= 3 && m[0] == 0xB0 && m[2] == 64));
    }

    #[test]
    fn step_with_0_prob_never_fires() {
        let (player, state, _, rec) = make_player();
        let mut pat = state.current_pattern();
        pat.insert(
            "prob".into(),
            json!({"kick": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]}),
        );
        state.assign_current_pattern(pat);
        player.play_step(0);
        let sent = rec.lock().sent.lock().clone();
        assert!(!sent.iter().any(|m| m.len() >= 3 && m[0] == 0x90));
    }

    #[test]
    fn swing_delay_positive_when_swing_set() {
        let (player, state, _, _) = make_player();
        state.set_bpm(120.0);
        let mut pat = state.current_pattern();
        pat.insert("swing".into(), json!(50));
        state.assign_current_pattern(pat);
        assert!(player.swing_delay() > 0.0);
    }

    #[test]
    fn swing_delay_zero_when_swing_absent() {
        let (player, state, _, _) = make_player();
        state.set_bpm(120.0);
        assert_eq!(player.swing_delay(), 0.0);
    }

    #[test]
    fn step_changed_includes_global_step() {
        let state = Arc::new(AppState::new());
        let pat: Pattern = TRACK_NAMES
            .iter()
            .map(|t| (t.to_string(), json!(vec![0; 16])))
            .collect();
        state.assign_current_pattern(pat);
        let bus = Arc::new(EventBus::new());
        let last = Arc::new(Mutex::new(Map::new()));
        let l2 = last.clone();
        bus.subscribe(
            "step_changed",
            Arc::new(move |p| *l2.lock() = p),
        );
        let player = Player::new(state.clone(), bus, None);
        player.loop_count.store(2, Ordering::SeqCst);
        player.play_step(3);
        let ev = last.lock().clone();
        assert_eq!(ev.get("step").and_then(|v| v.as_i64()), Some(3));
        assert_eq!(ev.get("global_step").and_then(|v| v.as_i64()), Some(35));
    }

    #[test]
    fn condition_1_2_fires_on_even_loops() {
        let state = Arc::new(AppState::new());
        let mut pat = default_pattern();
        pat.insert(
            "cond".into(),
            json!({"kick": ["1:2", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}),
        );
        state.assign_current_pattern(pat);
        let bus = Arc::new(EventBus::new());
        let rec = Arc::new(Mutex::new(Recorder::default()));
        let port: Arc<Mutex<dyn MidiSink + Send>> = rec.clone();
        let player = Player::with_random(state, bus, Some(port), Arc::new(|| 0.0));
        player.loop_count.store(0, Ordering::SeqCst);
        player.play_step(0);
        let sent_even = rec.lock().sent.lock().clone();
        assert!(sent_even.iter().any(|m| m.len() >= 3 && m[0] == 0x90));
        rec.lock().sent.lock().clear();
        player.loop_count.store(1, Ordering::SeqCst);
        player.play_step(0);
        let sent_odd = rec.lock().sent.lock().clone();
        assert!(!sent_odd.iter().any(|m| m.len() >= 3 && m[0] == 0x90));
    }
}
