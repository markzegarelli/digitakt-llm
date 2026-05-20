//! Request/response types mirroring `api/schemas.py`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Deserialize)]
pub struct GenerateRequest {
    pub prompt: String,
    pub variation: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct BpmRequest {
    pub bpm: f64,
}

#[derive(Debug, Deserialize)]
pub struct CCFocusedTrackRequest {
    pub track: String,
}

#[derive(Debug, Deserialize)]
pub struct CCRequest {
    pub track: String,
    pub param: String,
    pub value: i64,
}

#[derive(Debug, Serialize)]
pub struct CCResponse {
    pub track: String,
    pub param: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct LengthRequest {
    pub steps: i64,
}

#[derive(Debug, Serialize)]
pub struct LengthResponse {
    pub steps: i64,
}

#[derive(Debug, Serialize)]
pub struct StateResponse {
    pub current_pattern: Map<String, Value>,
    pub pending_pattern: Option<Map<String, Value>>,
    pub bpm: f64,
    pub is_playing: bool,
    pub midi_port_name: Option<String>,
    pub last_prompt: Option<String>,
    pub pattern_history: Vec<Map<String, Value>>,
    pub track_cc: Map<String, Value>,
    pub track_muted: Map<String, Value>,
    pub track_velocity: Map<String, Value>,
    pub track_pitch: Map<String, Value>,
    #[serde(default)]
    pub swing: i64,
    #[serde(default = "default_len")]
    pub pattern_length: i64,
    #[serde(default)]
    pub chain: Vec<String>,
    #[serde(default = "default_neg_one")]
    pub chain_index: i64,
    #[serde(default)]
    pub chain_auto: bool,
    pub chain_queued_index: Option<usize>,
    #[serde(default)]
    pub chain_armed: bool,
}

fn default_len() -> i64 {
    16
}
fn default_neg_one() -> i64 {
    -1
}

#[derive(Debug, Deserialize, Default)]
pub struct SavePatternRequest {
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PatternEntry {
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub bpm: Option<f64>,
    pub pattern_length: Option<i64>,
    pub swing: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct PatternListResponse {
    pub patterns: Vec<PatternEntry>,
}

#[derive(Debug, Deserialize)]
pub struct MuteRequest {
    pub track: String,
    pub muted: bool,
}

#[derive(Debug, Serialize)]
pub struct MuteResponse {
    pub track: String,
    pub muted: bool,
}

#[derive(Debug, Deserialize)]
pub struct VelocityRequest {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Serialize)]
pub struct VelocityResponse {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct ProbRequest {
    pub track: String,
    pub step: i64,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct ProbTrackRequest {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct SwingRequest {
    pub amount: i64,
}

#[derive(Debug, Deserialize)]
pub struct VelRequest {
    pub track: String,
    pub step: i64,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct VelTrackRequest {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct RandomRequest {
    pub track: String,
    pub param: String,
    #[serde(default)]
    pub lo: i64,
    #[serde(default = "default_hi")]
    pub hi: i64,
}

fn default_hi() -> i64 {
    127
}

#[derive(Debug, Deserialize)]
pub struct CCStepRequest {
    pub track: String,
    pub param: String,
    pub step: i64,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct GateRequest {
    pub track: String,
    pub step: i64,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct GateTrackRequest {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Serialize)]
pub struct GateResponse {
    pub track: String,
    pub step: i64,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct PitchRequest {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Serialize)]
pub struct PitchResponse {
    pub track: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
pub struct NoteRequest {
    pub track: String,
    pub step: i64,
    pub value: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct NoteResponse {
    pub track: String,
    pub step: i64,
    pub value: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CondRequest {
    pub track: String,
    pub step: i64,
    pub value: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CondResponse {
    pub track: String,
    pub step: i64,
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AskRequest {
    pub question: String,
}

#[derive(Debug, Serialize)]
pub struct AskResponse {
    pub answer: String,
    pub implementable: bool,
}

#[derive(Debug, Deserialize)]
pub struct ChainRequest {
    pub patterns: Vec<String>,
    #[serde(default)]
    pub auto: bool,
}

#[derive(Debug, Deserialize)]
pub struct SeqModeRequest {
    pub mode: String,
    pub euclid: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize)]
pub struct EuclidStripModeRequest {
    pub mode: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct MidiConnectRequest {
    pub port: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MidiConnectResponse {
    pub status: String,
    pub port: String,
}

#[derive(Debug, Serialize)]
pub struct MidiOutputsResponse {
    pub ports: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct LfoSetRequest {
    pub target: String,
    pub lfo: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize)]
pub struct LfoSetResponse {
    pub target: String,
    pub lfo: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize)]
pub struct CCParamEntry {
    pub name: String,
    pub cc: u8,
    pub default: u8,
}

#[derive(Debug, Serialize)]
pub struct CCParamsResponse {
    pub params: Vec<CCParamEntry>,
}

#[derive(Debug, Serialize)]
pub struct WsMessage {
    pub event: String,
    pub data: Map<String, Value>,
}
