//! Hardware MIDI CC listener (parity with `core/midi_input.py`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use digitakt_core::AppState;
use digitakt_midi::{
    consume_recent_outbound_cc_echo, find_digitakt_input, list_input_ports, open_input,
    param_for_cc, track_for_channel, MidiPortError,
};
use parking_lot::Mutex;
use serde_json::{json, Map};

use crate::events::EventBus;

const EMIT_INTERVAL: Duration = Duration::from_millis(80);

#[derive(Debug, Clone)]
pub struct ControlChange {
    pub channel: u8,
    pub control: u8,
    pub value: u8,
}

pub struct MidiInputListener {
    state: Arc<AppState>,
    bus: Arc<EventBus>,
    last_emit: Mutex<HashMap<(String, String), Instant>>,
    pending: Mutex<HashMap<(String, String), Map<String, serde_json::Value>>>,
}

impl MidiInputListener {
    pub fn new(state: Arc<AppState>, bus: Arc<EventBus>) -> Self {
        Self {
            state,
            bus,
            last_emit: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub fn handle(&self, msg: &ControlChange) {
        let track = track_for_channel(msg.channel)
            .map(str::to_string)
            .unwrap_or_else(|| self.state.cc_focused_track());
        let Some(param) = param_for_cc(msg.control) else {
            return;
        };
        if consume_recent_outbound_cc_echo(msg.channel, msg.control, msg.value) {
            return;
        }
        if self.state.track_cc_value(&track, param) == Some(msg.value as i64) {
            return;
        }
        self.state.update_cc(&track, param, msg.value as i64);
        let now = Instant::now();
        let key = (track.clone(), param.to_string());
        let payload = Map::from_iter([
            ("track".into(), json!(track)),
            ("param".into(), json!(param)),
            ("value".into(), json!(msg.value)),
            ("source".into(), json!("hardware")),
        ]);
        let mut last = self.last_emit.lock();
        let last_ts = *last.get(&key).unwrap_or(&(now - EMIT_INTERVAL * 2));
        if now.saturating_duration_since(last_ts) >= EMIT_INTERVAL
        {
            last.insert(key.clone(), now);
            self.pending.lock().remove(&key);
            self.bus.emit("cc_changed", Some(payload));
        } else {
            self.pending.lock().insert(key, payload);
        }
    }

    pub fn flush_pending(&self) {
        let now = Instant::now();
        let mut pending = self.pending.lock();
        let mut last = self.last_emit.lock();
        let keys: Vec<_> = pending.keys().cloned().collect();
        for key in keys {
            let last_ts = *last.get(&key).unwrap_or(&(now - EMIT_INTERVAL * 2));
            if now.saturating_duration_since(last_ts) >= EMIT_INTERVAL
            {
                if let Some(payload) = pending.remove(&key) {
                    last.insert(key.clone(), now);
                    self.bus.emit("cc_changed", Some(payload));
                }
            }
        }
    }
}

pub struct HardwareMidiListener {
    inner: Arc<MidiInputListener>,
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl HardwareMidiListener {
    pub fn start(state: Arc<AppState>, bus: Arc<EventBus>) -> Result<Self, MidiPortError> {
        let ports = list_input_ports()?;
        let port_name = find_digitakt_input(&ports).ok_or_else(|| {
            MidiPortError::NotFound("No Digitakt MIDI input found".into())
        })?;
        let input = open_input(&port_name)?;
        let inner = Arc::new(MidiInputListener::new(state, bus));
        let stop = Arc::new(AtomicBool::new(false));
        let inner2 = inner.clone();
        let stop2 = stop.clone();
        let handle = thread::spawn(move || {
            while !stop2.load(Ordering::SeqCst) {
                if let Some((ch, cc, val)) = input.poll() {
                    inner2.handle(&ControlChange {
                        channel: ch,
                        control: cc,
                        value: val,
                    });
                } else {
                    inner2.flush_pending();
                    thread::sleep(POLL_INTERVAL);
                }
            }
        });
        Ok(Self {
            inner,
            stop,
            thread: Mutex::new(Some(handle)),
        })
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.thread.lock().take() {
            let _ = h.join();
        }
    }
}

const POLL_INTERVAL: Duration = Duration::from_millis(5);

pub fn start_hardware_listener(
    state: Arc<AppState>,
    bus: Arc<EventBus>,
) -> Result<HardwareMidiListener, MidiPortError> {
    HardwareMidiListener::start(state, bus)
}

#[cfg(test)]
mod tests {
    use super::*;
    use digitakt_midi::{mark_outbound_cc, reset_outbound_cc_echo_tracker_for_tests};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn duplicate_value_suppressed() {
        reset_outbound_cc_echo_tracker_for_tests();
        let state = Arc::new(AppState::new());
        state.update_cc("kick", "filter", 80);
        let bus = Arc::new(EventBus::new());
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "cc_changed",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        let listener = MidiInputListener::new(state, bus);
        listener.handle(&ControlChange {
            channel: 0,
            control: 74,
            value: 80,
        });
        assert_eq!(n.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn outbound_echo_suppressed() {
        reset_outbound_cc_echo_tracker_for_tests();
        let state = Arc::new(AppState::new());
        state.update_cc("kick", "filter", 80);
        let bus = Arc::new(EventBus::new());
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "cc_changed",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        mark_outbound_cc(0, 74, 64);
        let listener = MidiInputListener::new(state.clone(), bus);
        listener.handle(&ControlChange {
            channel: 0,
            control: 74,
            value: 64,
        });
        assert_eq!(n.load(Ordering::SeqCst), 0);
        assert_eq!(state.track_cc_value("kick", "filter"), Some(80));
    }

    #[test]
    fn different_value_emits_cc_changed() {
        reset_outbound_cc_echo_tracker_for_tests();
        let state = Arc::new(AppState::new());
        state.update_cc("kick", "filter", 80);
        let bus = Arc::new(EventBus::new());
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "cc_changed",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        let listener = MidiInputListener::new(state.clone(), bus);
        listener.handle(&ControlChange {
            channel: 0,
            control: 74,
            value: 64,
        });
        assert_eq!(n.load(Ordering::SeqCst), 1);
        assert_eq!(state.track_cc_value("kick", "filter"), Some(64));
    }

    #[test]
    fn flush_pending_emits_deferred() {
        reset_outbound_cc_echo_tracker_for_tests();
        let state = Arc::new(AppState::new());
        let bus = Arc::new(EventBus::new());
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        bus.subscribe(
            "cc_changed",
            Arc::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
            }),
        );
        let listener = MidiInputListener::new(state.clone(), bus);
        listener.handle(&ControlChange {
            channel: 0,
            control: 74,
            value: 10,
        });
        listener.handle(&ControlChange {
            channel: 0,
            control: 74,
            value: 20,
        });
        assert_eq!(n.load(Ordering::SeqCst), 1);
        std::thread::sleep(Duration::from_millis(85));
        listener.flush_pending();
        assert_eq!(n.load(Ordering::SeqCst), 2);
    }
}
