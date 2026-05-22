//! MIDI channel/note/CC maps (parity with `core/midi_utils.py`).

use std::collections::HashMap;

use digitakt_core::TRACK_NAMES;

/// Default MIDI note per track (chromatic mode base).
pub fn note_map() -> HashMap<&'static str, u8> {
    TRACK_NAMES
        .iter()
        .map(|t| (*t, 60))
        .collect()
}

/// App track name → 0-indexed MIDI channel (Digitakt channels 1–8).
pub fn track_channels() -> HashMap<&'static str, u8> {
    HashMap::from([
        ("kick", 0),
        ("snare", 1),
        ("tom", 2),
        ("clap", 3),
        ("bell", 4),
        ("hihat", 5),
        ("openhat", 6),
        ("cymbal", 7),
    ])
}

struct CcParamDef {
    cc: u8,
    default: u8,
}

const CC_PARAM_DEFS: [(&str, CcParamDef); 9] = [
    ("tune", CcParamDef { cc: 16, default: 64 }),
    ("filter", CcParamDef { cc: 74, default: 127 }),
    ("resonance", CcParamDef { cc: 75, default: 0 }),
    ("attack", CcParamDef { cc: 78, default: 0 }),
    ("hold", CcParamDef { cc: 79, default: 0 }),
    ("decay", CcParamDef { cc: 80, default: 64 }),
    ("volume", CcParamDef { cc: 7, default: 100 }),
    ("reverb", CcParamDef { cc: 83, default: 0 }),
    ("delay", CcParamDef { cc: 82, default: 0 }),
];

pub fn cc_map() -> HashMap<&'static str, u8> {
    CC_PARAM_DEFS
        .iter()
        .map(|(name, def)| (*name, def.cc))
        .collect()
}

pub fn cc_param_defs() -> Vec<(&'static str, u8, u8)> {
    CC_PARAM_DEFS
        .iter()
        .map(|(name, def)| (*name, def.cc, def.default))
        .collect()
}

pub fn cc_defaults_map() -> HashMap<&'static str, u8> {
    CC_PARAM_DEFS
        .iter()
        .map(|(name, def)| (*name, def.default))
        .collect()
}

pub fn cc_number_to_param() -> HashMap<u8, &'static str> {
    CC_PARAM_DEFS
        .iter()
        .map(|(name, def)| (def.cc, *name))
        .collect()
}

pub fn channel_to_track() -> HashMap<u8, &'static str> {
    track_channels().into_iter().map(|(t, ch)| (ch, t)).collect()
}

pub fn note_for_track(track: &str) -> Option<u8> {
    note_map().get(track).copied()
}

pub fn channel_for_track(track: &str) -> Option<u8> {
    track_channels().get(track).copied()
}

pub fn param_for_cc(cc: u8) -> Option<&'static str> {
    cc_number_to_param().get(&cc).copied()
}

pub fn track_for_channel(channel: u8) -> Option<&'static str> {
    channel_to_track().get(&channel).copied()
}

#[cfg(test)]
mod tests {
    use super::*;
    use digitakt_core::TRACK_NAMES;

    #[test]
    fn note_map_has_all_tracks() {
        let m = note_map();
        for track in TRACK_NAMES {
            assert!(m.contains_key(track), "missing {track}");
        }
    }
}
