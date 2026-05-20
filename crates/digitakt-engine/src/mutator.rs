//! Pattern mutation write path (parity with `core/mutator.py`).

use std::sync::Arc;

use digitakt_core::{AppState, Pattern};
use crate::events::{EventBus, EventPayload};
use crate::player::Player;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApplyMode {
    Queue,
    Immediate,
    None,
}

pub struct PatternMutator {
    state: Arc<AppState>,
    player: Arc<Player>,
    bus: Arc<EventBus>,
}

impl PatternMutator {
    pub fn new(state: Arc<AppState>, player: Arc<Player>, bus: Arc<EventBus>) -> Self {
        Self { state, player, bus }
    }

    pub fn apply<F>(
        &self,
        f: F,
        event: Option<&str>,
        payload: Option<EventPayload>,
        mode: ApplyMode,
    ) -> Pattern
    where
        F: FnOnce(Pattern) -> Pattern,
    {
        let new_pattern = f(self.state.current_pattern());
        self.state.assign_current_pattern(new_pattern.clone());
        if mode == ApplyMode::Queue {
            self.player.queue_pattern(new_pattern.clone());
        }
        if let Some(ev) = event {
            self.bus.emit(ev, payload);
        }
        new_pattern
    }
}
