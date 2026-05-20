//! Pub/sub event bus (parity with `core/events.py`).

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use serde_json::Map;

/// All event names subscribed by the API WebSocket broadcaster (`api/server.py`).
pub const ALL_EVENTS: &[&str] = &[
    "pattern_changed",
    "bpm_changed",
    "playback_started",
    "playback_stopped",
    "generation_started",
    "generation_complete",
    "generation_failed",
    "midi_disconnected",
    "midi_connected",
    "cc_changed",
    "cc_step_changed",
    "mute_changed",
    "velocity_changed",
    "swing_changed",
    "prob_changed",
    "vel_changed",
    "random_applied",
    "randbeat_applied",
    "step_changed",
    "length_changed",
    "fill_started",
    "fill_ended",
    "gate_changed",
    "pitch_changed",
    "note_changed",
    "cond_changed",
    "state_reset",
    "ask_complete",
    "pattern_loaded",
    "chain_updated",
    "chain_queued",
    "chain_armed",
    "chain_advanced",
    "lfo_changed",
    "lfo_value",
];

pub type EventPayload = Map<String, serde_json::Value>;
pub type EventHandler = Arc<dyn Fn(EventPayload) + Send + Sync>;

#[derive(Default)]
pub struct EventBus {
    subscribers: RwLock<HashMap<String, Vec<EventHandler>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, event: &str, callback: EventHandler) {
        self.subscribers
            .write()
            .entry(event.into())
            .or_default()
            .push(callback);
    }

    pub fn emit(&self, event: &str, payload: Option<EventPayload>) {
        let payload = payload.unwrap_or_default();
        let callbacks: Vec<_> = self
            .subscribers
            .read()
            .get(event)
            .cloned()
            .unwrap_or_default();
        for cb in callbacks {
            cb(payload.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn emit_delivers_payload() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        let c2 = count.clone();
        bus.subscribe(
            "bpm_changed",
            Arc::new(move |p| {
                if p.get("bpm").and_then(|v| v.as_f64()) == Some(140.0) {
                    c2.fetch_add(1, Ordering::SeqCst);
                }
            }),
        );
        let mut payload = Map::new();
        payload.insert("bpm".into(), serde_json::json!(140.0));
        bus.emit("bpm_changed", Some(payload));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn all_events_count_matches_python() {
        assert_eq!(ALL_EVENTS.len(), 35);
    }
}
