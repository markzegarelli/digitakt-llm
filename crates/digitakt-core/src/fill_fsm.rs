use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FillState {
    Idle,
    Active,
}

#[derive(Debug, Clone)]
pub struct FillFsm {
    state: FillState,
    queued: Option<Map<String, Value>>,
    pre_fill: Option<Map<String, Value>>,
}

impl Default for FillFsm {
    fn default() -> Self {
        Self::new()
    }
}

impl FillFsm {
    pub fn new() -> Self {
        Self {
            state: FillState::Idle,
            queued: None,
            pre_fill: None,
        }
    }

    pub fn is_active(&self) -> bool {
        self.state == FillState::Active
    }

    pub fn queue(&mut self, pattern: Map<String, Value>) {
        self.queued = Some(pattern);
    }

    pub fn advance(
        &mut self,
        current_pattern: Map<String, Value>,
    ) -> (Map<String, Value>, Option<&'static str>) {
        if self.state == FillState::Active {
            let restored = self.pre_fill.take().unwrap_or(current_pattern);
            self.state = FillState::Idle;
            return (restored, Some("fill_ended"));
        }

        if let Some(fill) = self.queued.take() {
            self.pre_fill = Some(current_pattern);
            self.state = FillState::Active;
            return (fill, Some("fill_started"));
        }

        (current_pattern, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TRACK_NAMES;

    fn make_pattern(val: i64) -> Map<String, Value> {
        let mut m = Map::new();
        for t in TRACK_NAMES {
            m.insert(t.into(), Value::Array(vec![Value::from(val); 16]));
        }
        m
    }

    #[test]
    fn test_initially_idle() {
        let fsm = FillFsm::new();
        assert!(!fsm.is_active());
    }

    #[test]
    fn test_no_fill_queued_initially() {
        let mut fsm = FillFsm::new();
        let current = make_pattern(1);
        let (result, event) = fsm.advance(current.clone());
        assert_eq!(result, current);
        assert!(event.is_none());
    }

    #[test]
    fn test_queue_then_advance_starts_fill() {
        let mut fsm = FillFsm::new();
        let current = make_pattern(1);
        let fill = make_pattern(99);
        fsm.queue(fill.clone());
        let (result, event) = fsm.advance(current);
        assert_eq!(result, fill);
        assert_eq!(event, Some("fill_started"));
        assert!(fsm.is_active());
    }

    #[test]
    fn test_second_advance_ends_fill() {
        let mut fsm = FillFsm::new();
        let current = make_pattern(1);
        let fill = make_pattern(99);
        fsm.queue(fill.clone());
        fsm.advance(current.clone());
        let (result, event) = fsm.advance(fill);
        assert_eq!(result, current);
        assert_eq!(event, Some("fill_ended"));
        assert!(!fsm.is_active());
    }

    #[test]
    fn test_returns_to_idle_after_fill() {
        let mut fsm = FillFsm::new();
        let current = make_pattern(1);
        let fill = make_pattern(99);
        fsm.queue(fill.clone());
        fsm.advance(current.clone());
        fsm.advance(fill);
        let (result, event) = fsm.advance(current.clone());
        assert_eq!(result, current);
        assert!(event.is_none());
        assert!(!fsm.is_active());
    }
}
