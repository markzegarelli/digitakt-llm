//! Server application state and router.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::{Path as AxPath, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use digitakt_core::{
    apply_cc_step, apply_cond_step, apply_gate_step, apply_gate_track, apply_note_step,
    apply_prob_step, apply_prob_track, apply_random_prob, apply_random_velocity, apply_swing,
    apply_vel_step, apply_vel_track, empty_pattern, generate_random_beat, set_lfo,
    validate_lfo_target_key, AppState, Pattern, TRACK_NAMES,
};
use digitakt_engine::{
    ApplyMode, EventBus, HardwareMidiListener, PatternMutator, Player, ALL_EVENTS,
};
use digitakt_generator::{global_tracer, AnthropicClient, Generator, LlmClient};
use digitakt_midi::{cc_map, channel_for_track, find_digitakt, list_ports, open_port, send_cc};
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::schemas::*;

pub const DEFAULT_PORT: u16 = 8000;

/// Resolve `web/dist` for SPA static hosting (mirrors Python `api/server.py`).
pub fn resolve_web_dist() -> Option<PathBuf> {
    if let Ok(raw) = std::env::var("DIGITAKT_WEB_DIST") {
        let path = PathBuf::from(raw);
        if path.join("index.html").is_file() {
            return Some(path);
        }
    }
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("web/dist"),
        PathBuf::from("../web/dist"),
    ];
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("web/dist"));
        candidates.push(cwd.join("../web/dist"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(mac_os) = exe.parent() {
            if let Some(contents) = mac_os.parent() {
                candidates.push(contents.join("Resources/web/dist"));
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| p.join("index.html").is_file())
}

pub struct App {
    pub state: Arc<AppState>,
    pub bus: Arc<EventBus>,
    pub player: Arc<Player>,
    pub generator: Arc<Generator>,
    pub mutator: Arc<PatternMutator>,
    pub patterns_dir: PathBuf,
    pub ws_tx: broadcast::Sender<String>,
    pub _midi_listener: Mutex<Option<HardwareMidiListener>>,
    /// Unique per process; exposed in `/state` so embedders can detect a stale listener.
    pub instance_id: u64,
}

impl App {
    pub fn new(patterns_dir: impl AsRef<Path>, instance_id: u64) -> Result<Self, String> {
        let patterns_dir = patterns_dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&patterns_dir).map_err(|e| e.to_string())?;
        crate::env_file::load_env_files(&patterns_dir);
        let state = Arc::new(AppState::new());
        let bus = Arc::new(EventBus::new());
        let player = Arc::new(Player::new(state.clone(), bus.clone(), None));
        let client: Arc<dyn LlmClient> = match AnthropicClient::from_env() {
            Ok(c) => Arc::new(c),
            Err(_) => Arc::new(NoopClient),
        };
        let generator = Arc::new(Generator::new(state.clone(), bus.clone(), client));
        let mutator = Arc::new(PatternMutator::new(state.clone(), player.clone(), bus.clone()));
        let (ws_tx, _) = broadcast::channel(256);
        let app = Self {
            state,
            bus: bus.clone(),
            player,
            generator,
            mutator,
            patterns_dir,
            ws_tx: ws_tx.clone(),
            _midi_listener: Mutex::new(None),
            instance_id,
        };
        for event in ALL_EVENTS {
            let tx = ws_tx.clone();
            let ev = event.to_string();
            bus.subscribe(
                event,
                Arc::new(move |payload| {
                    let msg = json!({"event": ev, "data": payload});
                    let _ = tx.send(msg.to_string());
                }),
            );
        }
        if let Ok(ports) = list_ports() {
            if let Some(port_name) = find_digitakt(&ports) {
                match open_port(&port_name) {
                    Ok(conn) => {
                        let sink: Arc<Mutex<dyn digitakt_midi::MidiSink + Send>> =
                            Arc::new(Mutex::new(conn));
                        app.player.set_port(Some(sink));
                        app.state.set_midi_port_name(Some(port_name.clone()));
                        app.bus.emit(
                            "midi_connected",
                            Some(Map::from_iter([("port".into(), json!(port_name.clone()))])),
                        );
                    }
                    Err(_) => {}
                }
            }
        }
        if let Ok(l) = HardwareMidiListener::start(app.state.clone(), app.bus.clone()) {
            *app._midi_listener.lock() = Some(l);
        }
        Ok(app)
    }

    pub fn with_mock_generator(
        patterns_dir: impl AsRef<Path>,
        client: Arc<dyn LlmClient>,
    ) -> Self {
        let patterns_dir = patterns_dir.as_ref().to_path_buf();
        let _ = std::fs::create_dir_all(&patterns_dir);
        let state = Arc::new(AppState::new());
        let bus = Arc::new(EventBus::new());
        let player = Arc::new(Player::new(state.clone(), bus.clone(), None));
        let generator = Arc::new(Generator::new(state.clone(), bus.clone(), client));
        let mutator = Arc::new(PatternMutator::new(state.clone(), player.clone(), bus.clone()));
        let (ws_tx, _) = broadcast::channel(256);
        for event in ALL_EVENTS {
            let tx = ws_tx.clone();
            let ev = event.to_string();
            bus.subscribe(
                event,
                Arc::new(move |payload| {
                    let msg = json!({"event": ev, "data": payload});
                    let _ = tx.send(msg.to_string());
                }),
            );
        }
        Self {
            state,
            bus,
            player,
            generator,
            mutator,
            patterns_dir,
            ws_tx,
            _midi_listener: Mutex::new(None),
            instance_id: 0,
        }
    }

    pub fn router(self: Arc<Self>, web_dist: Option<PathBuf>) -> Router {
        let cors = CorsLayer::new()
            .allow_origin([
                "http://localhost:5173".parse().unwrap(),
                "http://127.0.0.1:5173".parse().unwrap(),
                "http://localhost:8000".parse().unwrap(),
                "http://127.0.0.1:8000".parse().unwrap(),
            ])
            .allow_methods(Any)
            .allow_headers(Any);
        let api = Router::new()
            .route("/state", get(get_state))
            .route("/generate", post(post_generate))
            .route("/bpm", post(post_bpm))
            .route("/play", post(post_play))
            .route("/stop", post(post_stop))
            .route("/midi/outputs", get(get_midi_outputs))
            .route("/midi/connect", post(post_midi_connect))
            .route("/new", post(post_new))
            .route("/undo", post(post_undo))
            .route("/lfo", post(post_lfo))
            .route("/cc", post(post_cc))
            .route("/cc-focused-track", post(post_cc_focused))
            .route("/cc-params", get(get_cc_params))
            .route("/cc", get(get_cc))
            .route("/cc-step", post(post_cc_step))
            .route("/ask", post(post_ask))
            .route("/mute", post(post_mute))
            .route("/mute-queued", post(post_mute_queued))
            .route("/velocity", post(post_velocity))
            .route("/prob", post(post_prob))
            .route("/prob-track", post(post_prob_track))
            .route("/swing", post(post_swing))
            .route("/length", post(post_length))
            .route("/seq-mode", post(post_seq_mode))
            .route("/euclid-strip-mode", post(post_euclid_strip))
            .route("/vel", post(post_vel))
            .route("/vel-track", post(post_vel_track))
            .route("/gate", post(post_gate))
            .route("/gate-track", post(post_gate_track))
            .route("/pitch", post(post_pitch))
            .route("/note", post(post_note))
            .route("/cond", post(post_cond))
            .route("/random", post(post_random))
            .route("/randbeat", post(post_randbeat))
            .route("/patterns", get(list_patterns))
            .route("/patterns/{name}", post(save_pattern).get(load_pattern).delete(delete_pattern))
            .route("/fill/{name}", post(post_fill))
            .route("/chain", post(post_chain).delete(delete_chain))
            .route("/chain/next", post(chain_next))
            .route("/chain/fire", post(chain_fire))
            .route("/chain/slot/{slot}/fill", post(chain_slot_fill))
            .route("/traces", get(get_traces))
            .route("/ws", get(ws_handler))
            .with_state(self.clone());
        let api = api.layer(cors);
        if let Some(dist) = web_dist.filter(|d| d.join("index.html").is_file()) {
            let index = dist.join("index.html");
            api.fallback_service(
                ServeDir::new(dist).not_found_service(ServeFile::new(index)),
            )
        } else {
            api
        }
    }
}

struct NoopClient;

impl LlmClient for NoopClient {
    fn messages_with_tool(
        &self,
        _: &str,
        _: usize,
        _: &str,
        _: &str,
        _: &str,
        _: Map<String, Value>,
    ) -> Result<(String, Option<Map<String, Value>>), String> {
        Err("ANTHROPIC_API_KEY not set".into())
    }

    fn messages_text(
        &self,
        _: &str,
        _: usize,
        _: &str,
        _: &[(String, String)],
    ) -> Result<String, String> {
        Ok("API key not configured".into())
    }
}

pub async fn run_server(
    host: &str,
    port: u16,
    patterns_dir: impl AsRef<Path>,
    web_dist: Option<PathBuf>,
    instance_id: u64,
    bound: Option<std::sync::mpsc::Sender<u64>>,
) -> Result<(), String> {
    let app = Arc::new(App::new(patterns_dir, instance_id)?);
    let router = app.router(web_dist.or_else(resolve_web_dist));
    let addr: SocketAddr = format!("{host}:{port}").parse().map_err(|e: std::net::AddrParseError| e.to_string())?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(tx) = bound {
        let _ = tx.send(instance_id);
    }
    axum::serve(listener, router).await.map_err(|e| e.to_string())
}

fn state_response(app: &App) -> StateResponse {
    let state = &app.state;
    let track_cc: Map<String, Value> = state
        .track_cc_map()
        .into_iter()
        .map(|(k, v)| (k, Value::Object(v)))
        .collect();
    StateResponse {
        current_pattern: state.current_pattern(),
        pending_pattern: state.pending_pattern(),
        bpm: state.bpm(),
        is_playing: state.is_playing(),
        midi_port_name: state.midi_port_name(),
        last_prompt: state.last_prompt(),
        pattern_history: state.pattern_history_json(),
        track_cc,
        track_muted: state.track_muted_map().into_iter().map(|(k, v)| (k, json!(v))).collect(),
        track_velocity: state
            .track_velocity_map()
            .into_iter()
            .map(|(k, v)| (k, json!(v)))
            .collect(),
        track_pitch: state
            .track_pitch_map()
            .into_iter()
            .map(|(k, v)| (k, json!(v)))
            .collect(),
        swing: state.swing(),
        pattern_length: state.pattern_length(),
        chain: state.chain(),
        chain_index: state.chain_index(),
        chain_auto: state.chain_auto(),
        chain_queued_index: state.chain_queued_index(),
        chain_armed: state.chain_armed(),
        server_instance_id: Some(app.instance_id),
    }
}

async fn get_state(State(app): State<Arc<App>>) -> Json<StateResponse> {
    Json(state_response(&app))
}

async fn post_generate(
    State(app): State<Arc<App>>,
    Json(req): Json<GenerateRequest>,
) -> Result<(StatusCode, Json<Map<String, Value>>), ApiError> {
    if req.prompt.trim().is_empty() {
        return Err(ApiError::unprocessable("prompt must not be empty"));
    }
    let variation = req.variation.unwrap_or_else(|| app.state.last_prompt().is_some());
    app.generator.generate(req.prompt.trim(), variation);
    Ok((StatusCode::ACCEPTED, Json(Map::from_iter([("status".into(), json!("queued"))]))))
}

async fn post_bpm(State(app): State<Arc<App>>, Json(req): Json<BpmRequest>) -> Json<Map<String, Value>> {
    app.player.set_bpm(req.bpm);
    Json(Map::from_iter([("bpm".into(), json!(req.bpm))]))
}

async fn post_play(State(app): State<Arc<App>>) -> Result<Json<Map<String, Value>>, ApiError> {
    if !app.player.start() {
        return Err(ApiError::service_unavailable("Playback could not start"));
    }
    Ok(Json(Map::from_iter([("status".into(), json!("playing"))])))
}

async fn post_stop(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    app.player.stop();
    Json(Map::from_iter([("status".into(), json!("stopped"))]))
}

async fn get_midi_outputs(State(_app): State<Arc<App>>) -> Result<Json<MidiOutputsResponse>, ApiError> {
    let ports = list_ports().map_err(|e| ApiError::service_unavailable(e.to_string()))?;
    Ok(Json(MidiOutputsResponse { ports }))
}

async fn post_midi_connect(
    State(app): State<Arc<App>>,
    Json(req): Json<MidiConnectRequest>,
) -> Result<Json<MidiConnectResponse>, ApiError> {
    let available = list_ports().map_err(|e| ApiError::service_unavailable(e.to_string()))?;
    let port_name = match req.port {
        Some(ref p) if available.iter().any(|x| x == p) => p.clone(),
        Some(p) => {
            return Err(ApiError::not_found(json!({"message": format!("No output named '{p}'"), "available": available})));
        }
        None => find_digitakt(&available).ok_or_else(|| {
            ApiError::not_found(json!({"message": "No Digitakt MIDI output found", "available": available}))
        })?,
    };
    let conn = open_port(&port_name).map_err(|e| ApiError::service_unavailable(e.to_string()))?;
    let sink: Arc<Mutex<dyn digitakt_midi::MidiSink + Send>> = Arc::new(Mutex::new(conn));
    app.player.set_port(Some(sink));
    app.state.set_midi_port_name(Some(port_name.clone()));
    app.bus.emit(
        "midi_connected",
        Some(Map::from_iter([("port".into(), json!(port_name.clone()))])),
    );
    Ok(Json(MidiConnectResponse {
        status: "connected".into(),
        port: port_name,
    }))
}

async fn post_new(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    app.state.reset(empty_pattern(), 120.0, None);
    if app.state.is_playing() {
        app.player.stop();
    }
    app.bus.emit("bpm_changed", Some(Map::from_iter([("bpm".into(), json!(120.0))])));
    app.bus.emit(
        "pattern_changed",
        Some(Map::from_iter([
            ("pattern".into(), json!(app.state.pending_pattern())),
            ("prompt".into(), json!("")),
        ])),
    );
    app.bus.emit("state_reset", None);
    Json(Map::from_iter([("status".into(), json!("ok"))]))
}

async fn post_undo(State(app): State<Arc<App>>) -> Result<Json<Map<String, Value>>, ApiError> {
    if app.state.undo_pattern().is_none() {
        return Err(ApiError::not_found_simple("No pattern history to undo"));
    }
    app.bus.emit("pattern_changed", None);
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_cc(State(app): State<Arc<App>>, Json(req): Json<CCRequest>) -> Result<Json<CCResponse>, ApiError> {
    validate_track(&req.track)?;
    validate_cc_param(&req.param)?;
    app.state.update_cc(&req.track, &req.param, req.value);
    if let Some(port) = app.player.port() {
        if let (Some(ch), Some(cc)) = (channel_for_track(&req.track), cc_map().get(req.param.as_str())) {
            let _ = send_cc(&mut *port.lock(), ch, *cc, req.value as u8);
        }
    }
    app.bus.emit(
        "cc_changed",
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("param".into(), json!(req.param)),
            ("value".into(), json!(req.value)),
        ])),
    );
    Ok(Json(CCResponse {
        track: req.track,
        param: req.param,
        value: req.value,
    }))
}

async fn post_cc_focused(
    State(app): State<Arc<App>>,
    Json(req): Json<CCFocusedTrackRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    app.state.set_cc_focused_track(&req.track);
    Ok(Json(Map::from_iter([("track".into(), json!(req.track))])))
}

async fn get_cc_params(_app: State<Arc<App>>) -> Json<CCParamsResponse> {
    let defs = digitakt_midi::cc_param_defs();
    Json(CCParamsResponse {
        params: defs
            .into_iter()
            .map(|(name, cc, default)| CCParamEntry {
                name: name.to_string(),
                cc,
                default,
            })
            .collect(),
    })
}

async fn get_cc(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    Json(
        app.state
            .track_cc_map()
            .into_iter()
            .map(|(k, v)| (k, Value::Object(v)))
            .collect(),
    )
}

async fn post_cc_step(
    State(app): State<Arc<App>>,
    Json(req): Json<CCStepRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    validate_cc_param(&req.param)?;
    validate_step(&app.state, req.step)?;
    let value = if req.value == -1 { None } else { Some(req.value) };
    app.mutator.apply(
        |p| apply_cc_step(&p, &req.track, &req.param, (req.step - 1) as usize, value),
        Some("cc_step_changed"),
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("param".into(), json!(req.param)),
            ("step".into(), json!(req.step)),
            ("value".into(), json!(value)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_ask(
    State(app): State<Arc<App>>,
    Json(req): Json<AskRequest>,
) -> Result<Json<AskResponse>, ApiError> {
    let question = req.question.clone();
    let generator = app.generator.clone();
    let bus = app.bus.clone();
    let (answer, implementable) = tokio::task::spawn_blocking(move || {
        generator.answer_question_with_classify(&question)
    })
    .await
    .map_err(|e| ApiError::internal(format!("ask task failed: {e}")))?
    .map_err(ApiError::service_unavailable)?;
    bus.emit(
        "ask_complete",
        Some(Map::from_iter([
            ("question".into(), json!(req.question)),
            ("answer".into(), json!(answer)),
            ("implementable".into(), json!(implementable)),
        ])),
    );
    Ok(Json(AskResponse {
        answer,
        implementable,
    }))
}

async fn post_mute(
    State(app): State<Arc<App>>,
    Json(req): Json<MuteRequest>,
) -> Result<Json<MuteResponse>, ApiError> {
    validate_track(&req.track)?;
    app.state.update_mute(&req.track, req.muted);
    app.bus.emit(
        "mute_changed",
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("muted".into(), json!(req.muted)),
        ])),
    );
    Ok(Json(MuteResponse {
        track: req.track,
        muted: req.muted,
    }))
}

async fn post_mute_queued(
    State(app): State<Arc<App>>,
    Json(req): Json<MuteRequest>,
) -> Result<Json<MuteResponse>, ApiError> {
    validate_track(&req.track)?;
    app.state.queue_mute(&req.track, req.muted);
    Ok(Json(MuteResponse {
        track: req.track,
        muted: req.muted,
    }))
}

async fn post_velocity(
    State(app): State<Arc<App>>,
    Json(req): Json<VelocityRequest>,
) -> Result<Json<VelocityResponse>, ApiError> {
    validate_track(&req.track)?;
    app.state.update_velocity(&req.track, req.value);
    app.bus.emit(
        "velocity_changed",
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("value".into(), json!(req.value)),
        ])),
    );
    Ok(Json(VelocityResponse {
        track: req.track,
        value: req.value,
    }))
}

async fn post_prob(
    State(app): State<Arc<App>>,
    Json(req): Json<ProbRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    validate_step(&app.state, req.step)?;
    app.mutator.apply(
        |p| apply_prob_step(&p, &req.track, (req.step - 1) as usize, req.value),
        Some("prob_changed"),
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("step".into(), json!(req.step)),
            ("value".into(), json!(req.value)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_prob_track(
    State(app): State<Arc<App>>,
    Json(req): Json<ProbTrackRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    let new = app.mutator.apply(
        |p| apply_prob_track(&p, &req.track, req.value).unwrap(),
        None,
        None,
        ApplyMode::Queue,
    );
    app.bus.emit(
        "pattern_changed",
        Some(Map::from_iter([
            ("pattern".into(), json!(new)),
            ("prompt".into(), json!(app.state.last_prompt())),
        ])),
    );
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_swing(
    State(app): State<Arc<App>>,
    Json(req): Json<SwingRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    app.mutator.apply(
        |p| apply_swing(&p, req.amount),
        Some("swing_changed"),
        Some(Map::from_iter([("amount".into(), json!(req.amount))])),
        ApplyMode::Queue,
    );
    Ok(Json(Map::from_iter([("amount".into(), json!(req.amount))])))
}

async fn post_length(
    State(app): State<Arc<App>>,
    Json(req): Json<LengthRequest>,
) -> Result<Json<LengthResponse>, ApiError> {
    if ![8, 16, 32].contains(&req.steps) {
        return Err(ApiError::unprocessable("steps must be 8, 16, or 32"));
    }
    app.state.set_pattern_length(req.steps);
    app.bus.emit(
        "length_changed",
        Some(Map::from_iter([("steps".into(), json!(req.steps))])),
    );
    Ok(Json(LengthResponse { steps: req.steps }))
}

async fn post_seq_mode(
    State(app): State<Arc<App>>,
    Json(req): Json<SeqModeRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    if req.mode != "standard" && req.mode != "euclidean" {
        return Err(ApiError::unprocessable("mode must be standard or euclidean"));
    }
    let new = app.mutator.apply(
        |mut p| {
            p.insert("seq_mode".into(), json!(req.mode));
            if let Some(eu) = req.euclid {
                p.insert("euclid".into(), Value::Object(eu));
            }
            p
        },
        Some("pattern_changed"),
        None,
        ApplyMode::Queue,
    );
    Ok(Json(Map::from_iter([
        ("seq_mode".into(), json!(req.mode)),
        ("euclid".into(), new.get("euclid").cloned().unwrap_or(json!({}))),
    ])))
}

async fn post_euclid_strip(
    State(app): State<Arc<App>>,
    Json(req): Json<EuclidStripModeRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    if req.mode != "grid" && req.mode != "fractional" {
        return Err(ApiError::unprocessable("mode must be grid or fractional"));
    }
    app.mutator.apply(
        |mut p| {
            p.insert("euclid_strip_mode".into(), json!(req.mode));
            p
        },
        Some("pattern_changed"),
        None,
        ApplyMode::None,
    );
    Ok(Json(Map::from_iter([("euclid_strip_mode".into(), json!(req.mode))])))
}

async fn post_vel(
    State(app): State<Arc<App>>,
    Json(req): Json<VelRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    validate_step(&app.state, req.step)?;
    app.mutator.apply(
        |p| apply_vel_step(&p, &req.track, (req.step - 1) as usize, req.value),
        Some("vel_changed"),
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("step".into(), json!(req.step)),
            ("value".into(), json!(req.value)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_vel_track(
    State(app): State<Arc<App>>,
    Json(req): Json<VelTrackRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    let new = app.mutator.apply(
        |p| apply_vel_track(&p, &req.track, req.value).unwrap(),
        None,
        None,
        ApplyMode::Queue,
    );
    app.bus.emit(
        "pattern_changed",
        Some(Map::from_iter([
            ("pattern".into(), json!(new)),
            ("prompt".into(), json!(app.state.last_prompt())),
        ])),
    );
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_gate(
    State(app): State<Arc<App>>,
    Json(req): Json<GateRequest>,
) -> Result<Json<GateResponse>, ApiError> {
    validate_track(&req.track)?;
    validate_step(&app.state, req.step)?;
    app.mutator.apply(
        |p| apply_gate_step(&p, &req.track, (req.step - 1) as usize, req.value).unwrap(),
        Some("gate_changed"),
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("step".into(), json!(req.step)),
            ("value".into(), json!(req.value)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(GateResponse {
        track: req.track,
        step: req.step,
        value: req.value,
    }))
}

async fn post_gate_track(
    State(app): State<Arc<App>>,
    Json(req): Json<GateTrackRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_track(&req.track)?;
    let new = app.mutator.apply(
        |p| apply_gate_track(&p, &req.track, req.value).unwrap(),
        None,
        None,
        ApplyMode::Queue,
    );
    app.bus.emit(
        "pattern_changed",
        Some(Map::from_iter([
            ("pattern".into(), json!(new)),
            ("prompt".into(), json!(app.state.last_prompt())),
        ])),
    );
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_pitch(
    State(app): State<Arc<App>>,
    Json(req): Json<PitchRequest>,
) -> Result<Json<PitchResponse>, ApiError> {
    validate_track(&req.track)?;
    app.state.update_pitch(&req.track, req.value);
    app.bus.emit(
        "pitch_changed",
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("value".into(), json!(req.value)),
        ])),
    );
    Ok(Json(PitchResponse {
        track: req.track,
        value: req.value,
    }))
}

async fn post_note(
    State(app): State<Arc<App>>,
    Json(req): Json<NoteRequest>,
) -> Result<Json<NoteResponse>, ApiError> {
    validate_track(&req.track)?;
    validate_step(&app.state, req.step)?;
    app.mutator.apply(
        |p| apply_note_step(&p, &req.track, (req.step - 1) as usize, req.value).unwrap(),
        Some("note_changed"),
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("step".into(), json!(req.step)),
            ("value".into(), json!(req.value)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(NoteResponse {
        track: req.track,
        step: req.step,
        value: req.value,
    }))
}

async fn post_cond(
    State(app): State<Arc<App>>,
    Json(req): Json<CondRequest>,
) -> Result<Json<CondResponse>, ApiError> {
    validate_track(&req.track)?;
    validate_step(&app.state, req.step)?;
    app.mutator.apply(
        |p| apply_cond_step(&p, &req.track, (req.step - 1) as usize, req.value.as_deref()).unwrap(),
        Some("cond_changed"),
        Some(Map::from_iter([
            ("track".into(), json!(req.track)),
            ("step".into(), json!(req.step)),
            ("value".into(), json!(req.value)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(CondResponse {
        track: req.track,
        step: req.step,
        value: req.value,
    }))
}

async fn post_random(
    State(app): State<Arc<App>>,
    Json(req): Json<RandomRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    let tracks: Vec<&str> = if req.track == "all" {
        TRACK_NAMES.to_vec()
    } else {
        validate_track(&req.track)?;
        vec![req.track.as_str()]
    };
    let f = |p: Pattern| match req.param.as_str() {
        "velocity" => apply_random_velocity(&p, &tracks, req.lo, req.hi, &mut rand::thread_rng()),
        "prob" => apply_random_prob(&p, &tracks, req.lo, req.hi, &mut rand::thread_rng()),
        _ => p,
    };
    app.mutator.apply(f, Some("random_applied"), None, ApplyMode::Queue);
    Ok(Json(Map::from_iter([("status".into(), json!("ok"))])))
}

async fn post_randbeat(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    let (pattern, bpm, _swing, _cc) = generate_random_beat(&mut rand::thread_rng());
    app.state.set_bpm(bpm as f64);
    app.state.update_pattern(pattern.clone(), None);
    app.state.queue_pattern(pattern);
    app.bus.emit("randbeat_applied", None);
    Json(Map::from_iter([("status".into(), json!("ok"))]))
}

async fn post_lfo(
    State(app): State<Arc<App>>,
    Json(req): Json<LfoSetRequest>,
) -> Result<Json<LfoSetResponse>, ApiError> {
    validate_lfo_target_key(&req.target).map_err(|e| ApiError::unprocessable(e.0))?;
    let lfo = req.lfo.clone();
    app.mutator.apply(
        |p| set_lfo(&p, &req.target, lfo.clone()),
        Some("lfo_changed"),
        Some(Map::from_iter([
            ("target".into(), json!(req.target)),
            ("lfo".into(), lfo.clone().map(Value::Object).unwrap_or(Value::Null)),
        ])),
        ApplyMode::Queue,
    );
    Ok(Json(LfoSetResponse {
        target: req.target,
        lfo,
    }))
}

async fn list_patterns(State(app): State<Arc<App>>) -> Json<PatternListResponse> {
    let mut patterns = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&app.patterns_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) == Some("json") {
                let name = entry
                    .path()
                    .file_stem()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                patterns.push(PatternEntry {
                    name,
                    tags: vec![],
                    bpm: None,
                    pattern_length: None,
                    swing: None,
                });
            }
        }
    }
    Json(PatternListResponse { patterns })
}

async fn save_pattern(
    State(app): State<Arc<App>>,
    AxPath(name): AxPath<String>,
    Json(req): Json<SavePatternRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_pattern_name(&name)?;
    let path = app.patterns_dir.join(format!("{name}.json"));
    let body = json!({"pattern": app.state.current_pattern(), "tags": req.tags, "bpm": app.state.bpm()});
    std::fs::write(path, serde_json::to_string_pretty(&body).unwrap()).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(Map::from_iter([("saved".into(), json!(name))])))
}

async fn load_pattern(
    State(app): State<Arc<App>>,
    AxPath(name): AxPath<String>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_pattern_name(&name)?;
    let path = app.patterns_dir.join(format!("{name}.json"));
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|_| ApiError::not_found_simple("Pattern not found"))?)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if let Some(pat) = data.get("pattern").and_then(|v| v.as_object()) {
        let p: Pattern = pat.clone();
        app.state.queue_pattern(p);
        app.bus.emit("pattern_loaded", None);
        return Ok(Json(Map::from_iter([("loaded".into(), json!(name))])));
    }
    Err(ApiError::internal("Invalid pattern file"))
}

async fn delete_pattern(
    State(app): State<Arc<App>>,
    AxPath(name): AxPath<String>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_pattern_name(&name)?;
    let path = app.patterns_dir.join(format!("{name}.json"));
    std::fs::remove_file(path).map_err(|_| ApiError::not_found_simple("Pattern not found"))?;
    Ok(Json(Map::from_iter([("deleted".into(), json!(name))])))
}

async fn post_fill(
    State(app): State<Arc<App>>,
    AxPath(name): AxPath<String>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    validate_pattern_name(&name)?;
    let path = app.patterns_dir.join(format!("{name}.json"));
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|_| ApiError::not_found_simple("Pattern not found"))?)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if let Some(pat) = data.get("pattern").and_then(|v| v.as_object()) {
        app.state.queue_fill(pat.clone());
        return Ok(Json(Map::from_iter([("queued".into(), json!(name))])));
    }
    Err(ApiError::internal("Invalid pattern file"))
}

async fn post_chain(
    State(app): State<Arc<App>>,
    Json(req): Json<ChainRequest>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    let mut patterns = Vec::new();
    for name in &req.patterns {
        validate_pattern_name(name)?;
        let path = app.patterns_dir.join(format!("{name}.json"));
        let data: Value = serde_json::from_str(&std::fs::read_to_string(&path).map_err(|_| ApiError::not_found_simple("Pattern not found"))?)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        patterns.push(data.get("pattern").and_then(|v| v.as_object()).cloned().unwrap_or_default());
    }
    app.state.set_chain(req.patterns.clone(), patterns, req.auto);
    app.bus.emit("chain_updated", None);
    Ok(Json(Map::from_iter([("chain".into(), json!(req.patterns))])))
}

async fn delete_chain(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    app.state.clear_chain();
    app.bus.emit("chain_updated", None);
    Json(Map::from_iter([("status".into(), json!("cleared"))]))
}

async fn chain_next(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    app.bus.emit("chain_queued", None);
    Json(Map::from_iter([("status".into(), json!("queued"))]))
}

async fn chain_fire(State(app): State<Arc<App>>) -> Json<Map<String, Value>> {
    app.bus.emit("chain_armed", None);
    Json(Map::from_iter([("status".into(), json!("armed"))]))
}

async fn chain_slot_fill(
    State(app): State<Arc<App>>,
    AxPath(slot): AxPath<usize>,
) -> Result<Json<Map<String, Value>>, ApiError> {
    let res = app.state.queue_fill_from_chain_slot(slot);
    if res.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(ApiError::unprocessable("Invalid chain slot or fill active"));
    }
    Ok(Json(res))
}

async fn get_traces(headers: HeaderMap) -> Result<Json<Map<String, Value>>, ApiError> {
    if !env_flag("DIGITAKT_ENABLE_TRACES") {
        return Err(ApiError::not_found_simple("Not found"));
    }
    if let Some(token) = admin_token() {
        if headers.get("x-digitakt-token").and_then(|v| v.to_str().ok()) != Some(token.as_str()) {
            return Err(ApiError::unauthorized());
        }
    }
    Ok(Json(Map::from_iter([(
        "traces".into(),
        json!(global_tracer().traces()),
    )])))
}

async fn ws_handler(ws: WebSocketUpgrade, State(app): State<Arc<App>>) -> Response {
    let mut rx = app.ws_tx.subscribe();
    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;
        use futures_util::{SinkExt, StreamExt};
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    if let Ok(text) = msg {
                        if socket.send(Message::Text(text.into())).await.is_err() { break; }
                    }
                }
                incoming = socket.recv() => {
                    if incoming.is_none() { break; }
                }
            }
        }
    })
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    detail: Value,
}

impl ApiError {
    fn unprocessable(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            detail: json!(msg.into()),
        }
    }
    fn not_found_simple(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            detail: json!(msg.into()),
        }
    }
    fn not_found(detail: Value) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            detail,
        }
    }
    fn service_unavailable(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            detail: json!(msg.into()),
        }
    }
    fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            detail: json!(msg.into()),
        }
    }
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            detail: json!("Unauthorized"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(Map::from_iter([("detail".into(), self.detail)]))).into_response()
    }
}

fn validate_track(track: &str) -> Result<(), ApiError> {
    if TRACK_NAMES.contains(&track) {
        Ok(())
    } else {
        Err(ApiError::unprocessable(format!("Unknown track: {track}")))
    }
}

fn validate_cc_param(param: &str) -> Result<(), ApiError> {
    if cc_map().contains_key(param) {
        Ok(())
    } else {
        Err(ApiError::unprocessable(format!("Unknown param: {param}")))
    }
}

fn validate_step(state: &AppState, step: i64) -> Result<(), ApiError> {
    if (1..=state.pattern_length()).contains(&step) {
        Ok(())
    } else {
        Err(ApiError::unprocessable(format!(
            "step must be between 1 and {}",
            state.pattern_length()
        )))
    }
}

fn validate_pattern_name(name: &str) -> Result<(), ApiError> {
    if name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err(ApiError::unprocessable("Invalid pattern name"))
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn admin_token() -> Option<String> {
    std::env::var("DIGITAKT_ADMIN_TOKEN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
