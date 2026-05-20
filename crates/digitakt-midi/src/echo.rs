//! Outbound CC echo suppression (parity with `core/midi_utils.py`).

use std::collections::{HashMap, VecDeque};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

const OUTBOUND_CC_ECHO_WINDOW: Duration = Duration::from_millis(350);

type EchoKey = (u8, u8, u8);

static OUTBOUND_CC_ECHOES: LazyLock<Mutex<HashMap<EchoKey, VecDeque<Instant>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn prune_locked(now: Instant, echoes: &mut HashMap<EchoKey, VecDeque<Instant>>) {
    let cutoff = now - OUTBOUND_CC_ECHO_WINDOW;
    echoes.retain(|_, times| {
        while times.front().is_some_and(|t| *t < cutoff) {
            times.pop_front();
        }
        !times.is_empty()
    });
}

pub fn mark_outbound_cc(channel: u8, cc_num: u8, value: u8) {
    let now = Instant::now();
    let mut echoes = OUTBOUND_CC_ECHOES.lock();
    prune_locked(now, &mut echoes);
    echoes
        .entry((channel, cc_num, value))
        .or_default()
        .push_back(now);
}

pub fn consume_recent_outbound_cc_echo(channel: u8, cc_num: u8, value: u8) -> bool {
    let now = Instant::now();
    let key = (channel, cc_num, value);
    let mut echoes = OUTBOUND_CC_ECHOES.lock();
    prune_locked(now, &mut echoes);
    let Some(times) = echoes.get_mut(&key) else {
        return false;
    };
    if times.is_empty() {
        echoes.remove(&key);
        return false;
    }
    times.pop_front();
    if times.is_empty() {
        echoes.remove(&key);
    }
    true
}

/// Test-only: clear echo tracker.
pub fn reset_outbound_cc_echo_tracker_for_tests() {
    OUTBOUND_CC_ECHOES.lock().clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Single test — global echo tracker is shared; parallel `#[test]` would flake.
    #[test]
    fn outbound_cc_echo_tracker() {
        reset_outbound_cc_echo_tracker_for_tests();
        mark_outbound_cc(0, 74, 64);
        assert!(consume_recent_outbound_cc_echo(0, 74, 64));
        assert!(!consume_recent_outbound_cc_echo(0, 74, 64));

        mark_outbound_cc(0, 74, 30);
        assert!(consume_recent_outbound_cc_echo(0, 74, 30));
        assert!(!consume_recent_outbound_cc_echo(0, 74, 30));
    }
}
