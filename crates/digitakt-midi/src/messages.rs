//! MIDI message encoding and send helpers.

use crate::echo::mark_outbound_cc;

pub trait MidiSink {
    fn send(&mut self, bytes: &[u8]) -> Result<(), MidiSendError>;
}

#[derive(Debug, thiserror::Error)]
#[error("midi send failed: {0}")]
pub struct MidiSendError(pub String);

pub fn encode_control_change(channel: u8, cc: u8, value: u8) -> [u8; 3] {
    [0xB0 | (channel & 0x0F), cc & 0x7F, value & 0x7F]
}

pub fn encode_note_on(channel: u8, note: u8, velocity: u8) -> [u8; 3] {
    [0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]
}

pub fn encode_clock() -> [u8; 1] {
    [0xF8]
}

pub fn encode_start() -> [u8; 1] {
    [0xFA]
}

pub fn encode_stop() -> [u8; 1] {
    [0xFC]
}

pub fn send_cc(
    port: &mut dyn MidiSink,
    channel: u8,
    cc_num: u8,
    value: u8,
) -> Result<(), MidiSendError> {
    let msg = encode_control_change(channel, cc_num, value);
    port.send(&msg)?;
    mark_outbound_cc(channel, cc_num, value);
    Ok(())
}

pub fn send_note(
    port: &mut dyn MidiSink,
    note: u8,
    velocity: u8,
    channel: u8,
) -> Result<(), MidiSendError> {
    if velocity == 0 {
        return Ok(());
    }
    port.send(&encode_note_on(channel, note, velocity))
}

pub fn send_note_off(
    port: &mut dyn MidiSink,
    note: u8,
    channel: u8,
) -> Result<(), MidiSendError> {
    port.send(&encode_note_on(channel, note, 0))
}

pub fn send_clock(port: &mut dyn MidiSink) -> Result<(), MidiSendError> {
    port.send(&encode_clock())
}

pub fn send_start(port: &mut dyn MidiSink) -> Result<(), MidiSendError> {
    port.send(&encode_start())
}

pub fn send_stop(port: &mut dyn MidiSink) -> Result<(), MidiSendError> {
    port.send(&encode_stop())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Recorder {
        sent: Vec<Vec<u8>>,
    }

    impl MidiSink for Recorder {
        fn send(&mut self, bytes: &[u8]) -> Result<(), MidiSendError> {
            self.sent.push(bytes.to_vec());
            Ok(())
        }
    }

    #[test]
    fn send_note_sends_note_on() {
        let mut port = Recorder::default();
        send_note(&mut port, 36, 100, 0).unwrap();
        assert_eq!(port.sent.len(), 1);
        assert_eq!(port.sent[0], vec![0x90, 36, 100]);
    }

    #[test]
    fn send_note_off_sends_velocity_zero() {
        let mut port = Recorder::default();
        send_note_off(&mut port, 36, 0).unwrap();
        assert_eq!(port.sent, vec![vec![0x90, 36, 0]]);
    }

    #[test]
    fn send_note_zero_velocity_does_nothing() {
        let mut port = Recorder::default();
        send_note(&mut port, 36, 0, 0).unwrap();
        assert!(port.sent.is_empty());
    }

    #[test]
    fn send_start_stop_clock() {
        let mut port = Recorder::default();
        send_start(&mut port).unwrap();
        send_stop(&mut port).unwrap();
        send_clock(&mut port).unwrap();
        assert_eq!(port.sent[0], vec![0xFA]);
        assert_eq!(port.sent[1], vec![0xFC]);
        assert_eq!(port.sent[2], vec![0xF8]);
    }

    #[test]
    fn send_cc_encodes_and_sends() {
        let mut port = Recorder::default();
        send_cc(&mut port, 0, 74, 64).unwrap();
        assert_eq!(port.sent, vec![vec![0xB0, 74, 64]]);
    }
}
