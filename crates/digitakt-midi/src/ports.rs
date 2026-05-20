//! Port discovery and optional hardware connections.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MidiPortError {
    #[error("midir init: {0}")]
    Init(String),
    #[error("port not found: {0}")]
    NotFound(String),
    #[error("connect: {0}")]
    Connect(String),
}

pub fn find_digitakt(ports: &[String]) -> Option<String> {
    ports
        .iter()
        .find(|p| p.contains("Digitakt"))
        .cloned()
}

pub fn find_digitakt_input(ports: &[String]) -> Option<String> {
    find_digitakt(ports)
}

#[cfg(feature = "hardware_midi")]
pub fn list_ports() -> Result<Vec<String>, MidiPortError> {
    list_output_ports()
}

#[cfg(feature = "hardware_midi")]
pub fn list_input_ports() -> Result<Vec<String>, MidiPortError> {
    list_input_port_names()
}

#[cfg(not(feature = "hardware_midi"))]
pub fn list_ports() -> Result<Vec<String>, MidiPortError> {
    Ok(Vec::new())
}

#[cfg(not(feature = "hardware_midi"))]
pub fn list_input_ports() -> Result<Vec<String>, MidiPortError> {
    Ok(Vec::new())
}

#[cfg(feature = "hardware_midi")]
pub fn list_output_ports() -> Result<Vec<String>, MidiPortError> {
    let midi_out =
        midir::MidiOutput::new("digitakt-list").map_err(|e| MidiPortError::Init(e.to_string()))?;
    Ok(midi_out
        .ports()
        .iter()
        .filter_map(|p| midi_out.port_name(p).ok())
        .collect())
}

#[cfg(feature = "hardware_midi")]
pub fn list_input_port_names() -> Result<Vec<String>, MidiPortError> {
    let midi_in =
        midir::MidiInput::new("digitakt-list-in").map_err(|e| MidiPortError::Init(e.to_string()))?;
    Ok(midi_in
        .ports()
        .iter()
        .filter_map(|p| midi_in.port_name(p).ok())
        .collect())
}

#[cfg(feature = "hardware_midi")]
pub struct OutputConnection {
    inner: midir::MidiOutputConnection,
}

#[cfg(feature = "hardware_midi")]
impl crate::messages::MidiSink for OutputConnection {
    fn send(&mut self, bytes: &[u8]) -> Result<(), crate::messages::MidiSendError> {
        self.inner
            .send(bytes)
            .map_err(|e| crate::messages::MidiSendError(e.to_string()))
    }
}

#[cfg(feature = "hardware_midi")]
pub fn open_port(name: &str) -> Result<OutputConnection, MidiPortError> {
    let midi_out =
        midir::MidiOutput::new("digitakt-out").map_err(|e| MidiPortError::Init(e.to_string()))?;
    let ports = midi_out.ports();
    let port = ports
        .into_iter()
        .find(|p| midi_out.port_name(p).ok().as_deref() == Some(name))
        .ok_or_else(|| MidiPortError::NotFound(name.to_string()))?;
    let conn = midi_out
        .connect(&port, "digitakt")
        .map_err(|e| MidiPortError::Connect(e.to_string()))?;
    Ok(OutputConnection { inner: conn })
}

#[cfg(feature = "hardware_midi")]
pub fn open_input(name: &str) -> Result<InputConnection, MidiPortError> {
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();
    let midi_in =
        midir::MidiInput::new("digitakt-in").map_err(|e| MidiPortError::Init(e.to_string()))?;
    let ports = midi_in.ports();
    let port = ports
        .into_iter()
        .find(|p| midi_in.port_name(p).ok().as_deref() == Some(name))
        .ok_or_else(|| MidiPortError::NotFound(name.to_string()))?;
    let conn = midi_in
        .connect(
            &port,
            "digitakt-input",
            move |_ts, msg, _| {
                if msg.len() >= 3 && (msg[0] & 0xF0) == 0xB0 {
                    let _ = tx.send((msg[0] & 0x0F, msg[1], msg[2]));
                }
            },
            (),
        )
        .map_err(|e| MidiPortError::Connect(e.to_string()))?;
    Ok(InputConnection { conn, rx })
}

#[cfg(feature = "hardware_midi")]
pub struct InputConnection {
    conn: midir::MidiInputConnection<()>,
    rx: std::sync::mpsc::Receiver<(u8, u8, u8)>,
}

#[cfg(feature = "hardware_midi")]
impl InputConnection {
    pub fn poll(&self) -> Option<(u8, u8, u8)> {
        self.rx.try_recv().ok()
    }
}

#[cfg(not(feature = "hardware_midi"))]
pub fn open_input(_name: &str) -> Result<(), MidiPortError> {
    Err(MidiPortError::NotFound("hardware_midi feature disabled".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_digitakt_returns_matching_port() {
        let ports = vec![
            "USB MIDI Interface".into(),
            "Elektron Digitakt MIDI 1".into(),
            "IAC Driver Bus 1".into(),
        ];
        assert_eq!(
            find_digitakt(&ports),
            Some("Elektron Digitakt MIDI 1".into())
        );
    }

    #[test]
    fn find_digitakt_returns_none_when_absent() {
        let ports = vec!["USB MIDI Interface".into(), "IAC Driver Bus 1".into()];
        assert_eq!(find_digitakt(&ports), None);
    }

    #[test]
    fn find_digitakt_empty_list() {
        assert_eq!(find_digitakt(&[]), None);
    }
}
