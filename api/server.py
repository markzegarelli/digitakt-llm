# api/server.py
from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request

import datetime
from core.logging_config import get_logger

logger = get_logger("server")

from api.schemas import (
    BpmRequest, CCRequest, CCResponse, CCStepRequest, GenerateRequest,
    MuteRequest, MuteResponse, PatternListResponse, StateResponse,
    VelocityRequest, VelocityResponse,
    ProbRequest, ProbTrackRequest, SwingRequest, VelRequest, VelTrackRequest, RandomRequest,
    AskRequest, AskResponse,
    LengthRequest, LengthResponse,
    SavePatternRequest, PatternEntry,
    GateRequest, GateTrackRequest, GateResponse,
    PitchRequest, PitchResponse,
    CondRequest, CondResponse,
    CCParamEntry, CCParamsResponse,
    ChainRequest,
)
from cli.commands import (
    apply_prob_step, apply_vel_step, apply_swing, apply_random_velocity,
    apply_random_prob, generate_random_beat, apply_cc_step,
    apply_gate_step, apply_gate_track, apply_cond_step,
    apply_prob_track, apply_vel_track,
)
from core.events import EventBus
from core.midi_utils import CC_MAP, TRACK_CHANNELS, send_cc, _CC_PARAM_DEFS
from core.mutator import PatternMutator
from core.state import AppState, TRACK_NAMES
from core.pattern_snapshot import (
    build_save_file_dict,
    extract_pattern_from_saved_json,
    merge_session_snapshot_into_state,
    parse_session_snapshot,
)
from core.tracing import tracer

@asynccontextmanager
async def lifespan(app: FastAPI):
    if _state is not None:
        _state.event_loop = asyncio.get_running_loop()
    if _bus is not None:
        for event_name in _ALL_EVENTS:
            _bus.subscribe(
                event_name,
                lambda p, name=event_name: _broadcast_event(name, p),
            )
    yield


app = FastAPI(title="Digitakt LLM", lifespan=lifespan)

# Module-level singletons set by init()
_state: AppState | None = None
_bus: EventBus | None = None
_player = None
_generator = None
_mutator: PatternMutator | None = None
_patterns_dir: str = "patterns"
_ws_clients: Set[WebSocket] = set()
_PATTERN_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

_ALL_EVENTS = [
    "pattern_changed", "bpm_changed", "playback_started", "playback_stopped",
    "generation_started", "generation_complete", "generation_failed", "midi_disconnected",
    "cc_changed", "cc_step_changed", "mute_changed", "velocity_changed",
    "swing_changed", "prob_changed", "vel_changed", "random_applied", "randbeat_applied",
    "step_changed", "length_changed", "fill_started", "fill_ended",
    "gate_changed", "pitch_changed", "cond_changed", "state_reset",
    "ask_complete", "pattern_loaded", "chain_updated", "chain_queued", "chain_armed", "chain_advanced",
]


def init(state: AppState, bus: EventBus, player, generator, patterns_dir: str = "patterns") -> None:
    global _state, _bus, _player, _generator, _mutator, _patterns_dir
    _state = state
    _bus = bus
    _player = player
    _generator = generator
    _mutator = PatternMutator(state, player, bus)
    _patterns_dir = patterns_dir
    os.makedirs(_patterns_dir, exist_ok=True)


def _broadcast_event(event_name: str, payload: dict) -> None:
    if _state and _state.event_loop:
        asyncio.run_coroutine_threadsafe(
            _broadcast_to_clients({"event": event_name, "data": payload}),
            _state.event_loop,
        )


def _send_all_track_cc_to_midi() -> None:
    """Push every global track CC to the Digitakt (same idea as Player.start)."""
    if not _player or not _player.port:
        return
    for track, params in _state.track_cc.items():
        channel = TRACK_CHANNELS[track]
        for param, value in params.items():
            if param in CC_MAP:
                send_cc(_player.port, channel, CC_MAP[param], value)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _admin_token() -> str | None:
    token = os.environ.get("DIGITAKT_ADMIN_TOKEN")
    if token is None:
        return None
    token = token.strip()
    return token or None


def _require_admin_access(request: Request) -> None:
    token = _admin_token()
    if token is None:
        return
    if request.headers.get("x-digitakt-token") != token:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _validate_step_in_pattern(step: int) -> None:
    if step > _state.pattern_length:
        raise HTTPException(
            status_code=422,
            detail=f"step must be between 1 and current pattern length ({_state.pattern_length})",
        )


def _resolve_pattern_path(name: str) -> Path:
    if not _PATTERN_NAME_RE.fullmatch(name):
        raise HTTPException(
            status_code=422,
            detail="Invalid pattern name; use letters, numbers, dash, or underscore only",
        )
    patterns_root = Path(_patterns_dir).resolve()
    target = (patterns_root / f"{name}.json").resolve()
    if patterns_root != target.parent:
        raise HTTPException(status_code=422, detail="Invalid pattern name")
    return target


async def _broadcast_to_clients(message: dict) -> None:
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(message)
        except Exception:
            logger.debug("WebSocket client disconnected during broadcast")
            dead.add(ws)
    _ws_clients.difference_update(dead)


# REST endpoints

@app.get("/state", response_model=StateResponse)
def get_state():
    return StateResponse(
        current_pattern=_state.current_pattern,
        pending_pattern=_state.pending_pattern,
        bpm=_state.bpm,
        is_playing=_state.is_playing,
        midi_port_name=_state.midi_port_name,
        last_prompt=_state.last_prompt,
        pattern_history=_state.pattern_history,
        track_cc=_state.track_cc,
        track_muted=_state.track_muted,
        track_velocity=_state.track_velocity,
        track_pitch=_state.track_pitch,
        swing=_state.current_pattern.get("swing", 0),
        pattern_length=_state.pattern_length,
        chain=_state.chain,
        chain_index=_state.chain_index,
        chain_auto=_state.chain_auto,
        chain_queued_index=_state.chain_queued_index,
        chain_armed=_state.chain_armed,
    )


@app.post("/generate", status_code=202)
def post_generate(req: GenerateRequest):
    variation = _state.last_prompt is not None
    _generator.generate(req.prompt, variation=variation)
    return {"status": "queued"}


@app.post("/bpm")
def post_bpm(req: BpmRequest):
    _player.set_bpm(req.bpm)
    return {"bpm": req.bpm}


@app.post("/play")
def post_play():
    """Start the sequencer. With a Digitakt connected, sends MIDI clock and notes; without hardware, runs a local timing loop so the UI still advances."""
    if not _player.start():
        raise HTTPException(status_code=503, detail="Playback could not start")
    return {"status": "playing"}


@app.post("/stop")
def post_stop():
    _player.stop()
    return {"status": "stopped"}


@app.post("/new")
def post_new():
    from core.state import EMPTY_PATTERN
    _state.reset(EMPTY_PATTERN, 120.0, None)
    if _state.is_playing:
        _player.stop()
    _broadcast_event("bpm_changed", {"bpm": 120.0})
    _broadcast_event("pattern_changed", {"pattern": _state.pending_pattern, "prompt": ""})
    _broadcast_event("state_reset", {})
    return {"status": "ok"}


@app.post("/undo")
def post_undo():
    pattern = _state.undo_pattern()
    if pattern is None:
        raise HTTPException(status_code=404, detail="No pattern history to undo")
    _broadcast_event("pattern_changed", {})
    return {"status": "ok"}


@app.post("/cc", response_model=CCResponse)
def set_cc(req: CCRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    if req.param not in CC_MAP:
        raise HTTPException(422, f"Unknown param: {req.param}")
    _state.update_cc(req.track, req.param, req.value)
    if _player and _player.port:
        send_cc(_player.port, TRACK_CHANNELS[req.track], CC_MAP[req.param], req.value)
    _bus.emit("cc_changed", {"track": req.track, "param": req.param, "value": req.value})
    return CCResponse(track=req.track, param=req.param, value=req.value)


@app.get("/cc-params", response_model=CCParamsResponse)
def get_cc_params():
    return CCParamsResponse(params=[
        CCParamEntry(name=k, cc=v["cc"], default=v["default"])
        for k, v in _CC_PARAM_DEFS.items()
    ])


@app.get("/cc")
def get_cc():
    return _state.track_cc


@app.post("/cc-step")
def set_cc_step(req: CCStepRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    if req.param not in CC_MAP:
        raise HTTPException(422, f"Unknown param: {req.param}")
    _validate_step_in_pattern(req.step)
    value = None if req.value == -1 else req.value
    _mutator.apply(
        lambda p: apply_cc_step(p, req.track, req.param, req.step - 1, value),
        event="cc_step_changed",
        payload={"track": req.track, "param": req.param, "step": req.step, "value": req.value},
    )
    return {"track": req.track, "param": req.param, "step": req.step, "value": req.value}


@app.post("/ask", response_model=AskResponse)
def post_ask(req: AskRequest):
    answer, is_implementable = _generator.answer_question_with_classify(req.question)
    _bus.emit("ask_complete", {"question": req.question, "answer": answer})
    return AskResponse(answer=answer, is_implementable=is_implementable)


@app.post("/mute", response_model=MuteResponse)
def set_mute(req: MuteRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _state.update_mute(req.track, req.muted)
    _bus.emit("mute_changed", {"track": req.track, "muted": req.muted})
    return MuteResponse(track=req.track, muted=req.muted)


@app.post("/mute-queued", response_model=MuteResponse)
def set_mute_queued(req: MuteRequest):
    """Queue a mute change to apply at the next bar boundary (beat-synced)."""
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _state.queue_mute(req.track, req.muted)
    return MuteResponse(track=req.track, muted=req.muted)


@app.post("/velocity", response_model=VelocityResponse)
def set_velocity(req: VelocityRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _state.update_velocity(req.track, req.value)
    _bus.emit("velocity_changed", {"track": req.track, "value": req.value})
    return VelocityResponse(track=req.track, value=req.value)


@app.post("/prob")
def set_prob(req: ProbRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _validate_step_in_pattern(req.step)
    _mutator.apply(
        lambda p: apply_prob_step(p, req.track, req.step - 1, req.value),
        event="prob_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return {"track": req.track, "step": req.step, "value": req.value}


@app.post("/prob-track")
def set_prob_track(req: ProbTrackRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    new_pattern = _mutator.apply(
        lambda p: apply_prob_track(p, req.track, req.value),
        event=None,
    )
    _bus.emit("pattern_changed", {"pattern": new_pattern, "prompt": _state.last_prompt or ""})
    return {"track": req.track, "value": req.value}


@app.post("/swing")
def set_swing(req: SwingRequest):
    _mutator.apply(
        lambda p: apply_swing(p, req.amount),
        event="swing_changed",
        payload={"amount": req.amount},
    )
    return {"amount": req.amount}


@app.post("/length", response_model=LengthResponse)
def set_length(req: LengthRequest):
    _state.set_pattern_length(req.steps)
    new_pattern = _mutator.apply(
        lambda p: _state.normalize_pattern_length(p, req.steps),
        mode="none",
    )
    _bus.emit("length_changed", {"steps": req.steps})
    _bus.emit("pattern_changed", {"pattern": new_pattern, "prompt": _state.last_prompt or ""})
    return LengthResponse(steps=req.steps)


@app.post("/vel")
def set_vel(req: VelRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _validate_step_in_pattern(req.step)
    _mutator.apply(
        lambda p: apply_vel_step(p, req.track, req.step - 1, req.value),
        event="vel_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return {"track": req.track, "step": req.step, "value": req.value}


@app.post("/vel-track")
def set_vel_track(req: VelTrackRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    new_pattern = _mutator.apply(
        lambda p: apply_vel_track(p, req.track, req.value),
        event=None,
    )
    _bus.emit("pattern_changed", {"pattern": new_pattern, "prompt": _state.last_prompt or ""})
    return {"track": req.track, "value": req.value}


@app.post("/gate", response_model=GateResponse)
async def set_gate(req: GateRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _validate_step_in_pattern(req.step)
    step_0 = req.step - 1
    _mutator.apply(
        lambda p: apply_gate_step(p, req.track, step_0, req.value),
        event="gate_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return GateResponse(track=req.track, step=req.step, value=req.value)


@app.post("/gate-track")
def set_gate_track(req: GateTrackRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    new_pattern = _mutator.apply(
        lambda p: apply_gate_track(p, req.track, req.value),
        event=None,
    )
    _bus.emit("pattern_changed", {"pattern": new_pattern, "prompt": _state.last_prompt or ""})
    return {"track": req.track, "value": req.value}


@app.post("/pitch", response_model=PitchResponse)
async def set_pitch(req: PitchRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(status_code=422, detail=f"Unknown track: {req.track}")
    _state.update_pitch(req.track, req.value)
    _bus.emit("pitch_changed", {"track": req.track, "value": req.value})
    return PitchResponse(track=req.track, value=req.value)


@app.post("/cond", response_model=CondResponse)
async def set_cond(req: CondRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    if req.value is not None and req.value not in ("1:2", "not:2", "fill"):
        raise HTTPException(status_code=422, detail=f"Invalid condition '{req.value}'")
    _validate_step_in_pattern(req.step)
    step_0 = req.step - 1
    _mutator.apply(
        lambda p: apply_cond_step(p, req.track, step_0, req.value),
        event="cond_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return CondResponse(track=req.track, step=req.step, value=req.value)


@app.post("/random")
def set_random(req: RandomRequest):
    if req.track != "all" and req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    if req.param not in ("velocity", "prob"):
        raise HTTPException(422, "param must be 'velocity' or 'prob'")
    tracks = list(TRACK_NAMES) if req.track == "all" else [req.track]
    fn = (
        (lambda p: apply_random_velocity(p, tracks, req.lo, req.hi))
        if req.param == "velocity"
        else (lambda p: apply_random_prob(p, tracks, req.lo, req.hi))
    )
    _mutator.apply(
        fn,
        event="random_applied",
        payload={"track": req.track, "param": req.param, "lo": req.lo, "hi": req.hi},
    )
    return {"track": req.track, "param": req.param, "lo": req.lo, "hi": req.hi}


@app.post("/randbeat")
def post_randbeat():
    pattern, bpm, swing, cc_changes = generate_random_beat()
    pattern = apply_swing(pattern, swing)
    _player.queue_pattern(pattern)
    _player.set_bpm(bpm)
    for track, params in cc_changes.items():
        for param, value in params.items():
            _state.update_cc(track, param, value)
            if _player and _player.port:
                send_cc(_player.port, TRACK_CHANNELS[track], CC_MAP[param], value)
    _bus.emit("randbeat_applied", {"bpm": bpm, "swing": swing})
    return {"bpm": bpm, "swing": swing}


@app.get("/patterns", response_model=PatternListResponse)
def get_patterns():
    entries = []
    for fname in sorted(os.listdir(_patterns_dir)):
        if not fname.endswith(".json"):
            continue
        name = fname[:-5]
        try:
            with open(os.path.join(_patterns_dir, fname)) as f:
                data = json.load(f)
            tags = data.get("tags", []) if isinstance(data, dict) and isinstance(data.get("tags"), list) else []
        except Exception:
            tags = []
        entries.append(PatternEntry(name=name, tags=tags))
    return PatternListResponse(patterns=entries)


@app.post("/patterns/{name}")
async def save_pattern(name: str, req: SavePatternRequest = SavePatternRequest()):
    path = _resolve_pattern_path(name)
    payload = build_save_file_dict(
        _state,
        _state.current_pattern,
        req.tags,
        datetime.datetime.utcnow().isoformat(),
    )
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return {"saved": name}


@app.post("/fill/{name}")
async def queue_fill_pattern(name: str):
    path = _resolve_pattern_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # Support both old format (raw pattern dict) and new format ({"pattern": ...})
    pattern = data.get("pattern", data)
    _state.queue_fill(pattern)
    return {"queued": name}


@app.post("/chain")
def set_chain(req: ChainRequest):
    names = [n.strip() for n in req.names if n.strip()]
    if not names:
        raise HTTPException(status_code=422, detail="chain names cannot be empty")
    patterns: list[dict] = []
    for name in names:
        path = _resolve_pattern_path(name)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        pattern = extract_pattern_from_saved_json(data)
        pattern = _state.normalize_pattern_length(pattern, _state.pattern_length)
        patterns.append(pattern)
    _state.set_chain(names, patterns, auto=req.auto)
    payload = {
        "chain": _state.chain,
        "chain_index": _state.chain_index,
        "chain_auto": _state.chain_auto,
        "chain_queued_index": _state.chain_queued_index,
        "chain_armed": _state.chain_armed,
    }
    _bus.emit("chain_updated", payload)
    return payload


@app.post("/chain/next")
def chain_next():
    queued_index = _state.queue_next_chain_candidate()
    if queued_index is None:
        raise HTTPException(status_code=404, detail="No chain configured")
    payload = {
        "chain": _state.chain,
        "chain_index": _state.chain_index,
        "chain_auto": _state.chain_auto,
        "chain_queued_index": queued_index,
        "chain_armed": _state.chain_armed,
    }
    _bus.emit("chain_queued", payload)
    return payload


@app.post("/chain/fire")
def chain_fire():
    queued_index = _state.arm_chain_candidate()
    if queued_index is None:
        raise HTTPException(status_code=404, detail="No chain configured")
    payload = {
        "chain": _state.chain,
        "chain_index": _state.chain_index,
        "chain_auto": _state.chain_auto,
        "chain_queued_index": queued_index,
        "chain_armed": _state.chain_armed,
    }
    _bus.emit("chain_armed", payload)
    return payload


@app.delete("/chain")
def clear_chain():
    _state.clear_chain()
    payload = {
        "chain": _state.chain,
        "chain_index": _state.chain_index,
        "chain_auto": _state.chain_auto,
        "chain_queued_index": _state.chain_queued_index,
        "chain_armed": _state.chain_armed,
    }
    _bus.emit("chain_updated", payload)
    return payload


@app.get("/patterns/{name}")
def load_pattern(name: str):
    path = _resolve_pattern_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    pattern = extract_pattern_from_saved_json(data)
    snapshot = parse_session_snapshot(data)
    if snapshot:
        merge_session_snapshot_into_state(_state, snapshot)
        if "bpm" in snapshot:
            _player.set_bpm(snapshot["bpm"])
        if "pattern_length" in snapshot:
            _bus.emit("length_changed", {"steps": _state.pattern_length})
        _send_all_track_cc_to_midi()
    pattern = _state.normalize_pattern_length(pattern, _state.pattern_length)
    _state.set_last_prompt(name)
    if _state.is_playing:
        _player.queue_pattern(pattern)
    else:
        # No player loop is advancing bar boundaries — apply immediately so /load works while stopped.
        _state.replace_current_pattern(pattern)
        _bus.emit(
            "pattern_changed",
            {"pattern": _state.current_pattern, "prompt": name},
        )
    _bus.emit("pattern_loaded", {})
    return {"loaded": name}


@app.get("/traces")
def get_traces(request: Request):
    """Return recent LLM prompt/response traces for observability."""
    if not _env_flag("DIGITAKT_ENABLE_TRACES", default=False):
        raise HTTPException(status_code=404, detail="Not found")
    _require_admin_access(request)
    return {"traces": tracer.traces}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep connection alive
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)


def start_background(port: int = 8000, host: str | None = None) -> None:
    bind_host = host or os.environ.get("DIGITAKT_HOST", "127.0.0.1")
    thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": bind_host, "port": port, "log_level": "error"},
        daemon=True,
    )
    thread.start()
