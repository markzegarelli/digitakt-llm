use serde_json::{json, Map, Value};

pub const TRACK_NAMES: [&str; 8] = [
    "kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal",
];

pub const DEFAULT_GATE_PCT: i64 = 50;

pub const CC_PARAMS: [&str; 9] = [
    "tune", "filter", "resonance", "attack", "hold", "decay", "volume", "reverb", "delay",
];

pub fn cc_defaults() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("tune".into(), json!(64));
    m.insert("filter".into(), json!(127));
    m.insert("resonance".into(), json!(0));
    m.insert("attack".into(), json!(0));
    m.insert("hold".into(), json!(0));
    m.insert("decay".into(), json!(64));
    m.insert("volume".into(), json!(100));
    m.insert("reverb".into(), json!(0));
    m.insert("delay".into(), json!(0));
    m
}

pub fn cc_map_contains(param: &str) -> bool {
    CC_PARAMS.contains(&param)
}

pub fn zeros(n: usize) -> Value {
    Value::Array(vec![Value::from(0); n])
}

pub fn default_pattern() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert(
        "kick".into(),
        json!([100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0]),
    );
    m.insert(
        "snare".into(),
        json!([0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0]),
    );
    m.insert("tom".into(), zeros(16));
    m.insert("clap".into(), zeros(16));
    m.insert("bell".into(), zeros(16));
    m.insert(
        "hihat".into(),
        json!([60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0]),
    );
    m.insert("openhat".into(), zeros(16));
    m.insert("cymbal".into(), zeros(16));
    m
}

pub fn empty_pattern() -> Map<String, Value> {
    let mut m = Map::new();
    for t in TRACK_NAMES {
        m.insert(t.into(), zeros(16));
    }
    m
}
