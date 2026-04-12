# api/server.py
from __future__ import annotations

import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException

import datetime
from core.logging_config import get_logger

logger = get_logger("server")

from api.schemas import (
    BpmRequest, CCRequest, CCResponse, CCStepRequest, GenerateRequest,
    MuteRequest, MuteResponse, PatternListResponse, StateResponse,
    VelocityRequest, VelocityResponse,
    ProbRequest, SwingRequest, VelRequest, RandomRequest,
    AskRequest, AskResponse,
    LengthRequest, LengthResponse,
    SavePatternRequest, PatternEntry,
    GateRequest, GateResponse,
    PitchRequest, PitchResponse,
    CondRequest, CondResponse,
    CCParamEntry, CCParamsResponse,
)
from cli.commands import (
    apply_prob_step, apply_vel_step, apply_swing, apply_random_velocity,
    apply_random_prob, generate_random_beat, apply_cc_step,
    apply_gate_step, apply_cond_step,
)
from core.events import EventBus
from core.midi_utils import CC_MAP, TRACK_CHANNELS, send_cc, _CC_PARAM_DEFS
from core.mutator import PatternMutator
from core.state import AppState, TRACK_NAMES, _DEFAULT_CC_PARAMS
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

_ALL_EVENTS = [
    "pattern_changed", "bpm_changed", "playback_started", "playback_stopped",
    "generation_started", "generation_complete", "generation_failed", "midi_disconnected",
    "cc_changed", "cc_step_changed", "mute_changed", "velocity_changed",
    "swing_changed", "prob_changed", "vel_changed", "random_applied", "randbeat_applied",
    "step_changed", "length_changed", "fill_started", "fill_ended",
    "gate_changed", "pitch_changed", "cond_changed", "state_reset",
    "ask_complete",
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
    if not _player.start():
        raise HTTPException(status_code=503, detail="No MIDI device connected")
    return {"status": "playing"}


@app.post("/stop")
def post_stop():
    _player.stop()
    return {"status": "stopped"}


@app.post("/new")
def post_new():
    import copy
    from core.state import EMPTY_PATTERN
    _state.pending_pattern = copy.deepcopy(EMPTY_PATTERN)
    _state.bpm = 120.0
    _state.last_prompt = None
    for track in TRACK_NAMES:
        _state.track_muted[track] = False
    _state.pending_mutes.clear()
    for track in TRACK_NAMES:
        _state.track_cc[track] = dict(_DEFAULT_CC_PARAMS)
        _state.track_velocity[track] = 127
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
    _mutator.apply(
        lambda p: apply_prob_step(p, req.track, req.step - 1, req.value),
        event="prob_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return {"track": req.track, "step": req.step, "value": req.value}


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

    def _resize(p: dict) -> dict:
        result = dict(p)
        for track in TRACK_NAMES:
            cur = result.get(track, [])
            if len(cur) < req.steps:
                result[track] = cur + [0] * (req.steps - len(cur))
            elif len(cur) > req.steps:
                result[track] = cur[:req.steps]
        return result

    new_pattern = _mutator.apply(_resize, mode="none")
    _bus.emit("length_changed", {"steps": req.steps})
    _bus.emit("pattern_changed", {"pattern": new_pattern, "prompt": _state.last_prompt or ""})
    return LengthResponse(steps=req.steps)


@app.post("/vel")
def set_vel(req: VelRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _mutator.apply(
        lambda p: apply_vel_step(p, req.track, req.step - 1, req.value),
        event="vel_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return {"track": req.track, "step": req.step, "value": req.value}


@app.post("/gate", response_model=GateResponse)
async def set_gate(req: GateRequest):
    step_0 = req.step - 1
    _mutator.apply(
        lambda p: apply_gate_step(p, req.track, step_0, req.value),
        event="gate_changed",
        payload={"track": req.track, "step": req.step, "value": req.value},
    )
    return GateResponse(track=req.track, step=req.step, value=req.value)


@app.post("/pitch", response_model=PitchResponse)
async def set_pitch(req: PitchRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(status_code=422, detail=f"Unknown track: {req.track}")
    _state.track_pitch[req.track] = req.value
    _bus.emit("pitch_changed", {"track": req.track, "value": req.value})
    return PitchResponse(track=req.track, value=req.value)


@app.post("/cond", response_model=CondResponse)
async def set_cond(req: CondRequest):
    if req.value is not None and req.value not in ("1:2", "not:2", "fill"):
        raise HTTPException(status_code=422, detail=f"Invalid condition '{req.value}'")
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
    path = os.path.join(_patterns_dir, f"{name}.json")
    payload = {
        "pattern": _state.current_pattern,
        "tags": req.tags,
        "saved_at": datetime.datetime.utcnow().isoformat(),
    }
    with open(path, "w") as f:
        json.dump(payload, f)
    return {"saved": name}


@app.post("/fill/{name}")
async def queue_fill_pattern(name: str):
    path = os.path.join(_patterns_dir, f"{name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    with open(path) as f:
        data = json.load(f)
    # Support both old format (raw pattern dict) and new format ({"pattern": ...})
    pattern = data.get("pattern", data)
    _state.queue_fill(pattern)
    return {"queued": name}


@app.get("/patterns/{name}")
def load_pattern(name: str):
    path = os.path.join(_patterns_dir, f"{name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    with open(path) as f:
        data = json.load(f)
    # Old format: raw pattern dict. New format: {"pattern": {...}, "tags": [...]}
    pattern = data.get("pattern", data) if isinstance(data, dict) and "pattern" in data else data
    _player.queue_pattern(pattern)
    _state.last_prompt = name
    return {"loaded": name}


@app.get("/traces")
def get_traces():
    """Return recent LLM prompt/response traces for observability."""
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


def start_background(port: int = 8000) -> None:
    thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": "0.0.0.0", "port": port, "log_level": "error"},
        daemon=True,
    )
    thread.start()
