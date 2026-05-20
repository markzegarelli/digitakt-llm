//! MIDI port discovery, CC map, echo suppression (parity with `core/midi_utils.py`).

mod echo;
mod maps;
mod messages;
mod ports;

pub use echo::{
    consume_recent_outbound_cc_echo, mark_outbound_cc, reset_outbound_cc_echo_tracker_for_tests,
};
pub use maps::{
    cc_defaults_map, cc_map, cc_number_to_param, cc_param_defs, channel_for_track, channel_to_track, note_for_track,
    note_map, param_for_cc, track_channels, track_for_channel,
};
pub use messages::{
    encode_clock, encode_control_change, encode_note_on, encode_start, encode_stop, send_cc,
    send_clock, send_note, send_note_off, send_start, send_stop, MidiSendError, MidiSink,
};
pub use ports::{find_digitakt, find_digitakt_input, list_input_ports, list_ports, MidiPortError};

#[cfg(feature = "hardware_midi")]
pub use ports::{list_input_port_names, list_output_ports, open_input, open_port, InputConnection, OutputConnection};

pub use digitakt_core::TRACK_NAMES;
