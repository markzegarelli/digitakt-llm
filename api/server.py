# api/server.py
from __future__ import annotations

import asyncio
import json
import os
import threading
from pathlib import Path
from typing import Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException

from api.schemas import (
    BpmRequest, CCRequest, CCResponse, GenerateRequest,
    MuteRequest, MuteResponse, PatternListResponse, StateResponse,
    VelocityRequest, VelocityResponse,
    ProbRequest, SwingRequest, VelRequest, RandomRequest,
)
from cli.commands import apply_prob_step, apply_vel_step, apply_swing, apply_random_velocity, apply_random_prob
from core.events import EventBus
from core.midi_utils import CC_MAP, TRACK_CHANNELS, send_cc
from core.state import AppState, TRACK_NAMES

app = FastAPI(title="Digitakt LLM")

# Module-level singletons set by init()
_state: AppState | None = None
_bus: EventBus | None = None
_player = None
_generator = None
_patterns_dir: str = "patterns"
_ws_clients: Set[WebSocket] = set()

_ALL_EVENTS = [
    "pattern_changed", "bpm_changed", "playback_started", "playback_stopped",
    "generation_started", "generation_complete", "generation_failed", "midi_disconnected",
    "cc_changed", "mute_changed", "velocity_changed",
    "swing_changed", "prob_changed", "vel_changed", "random_applied",
]


def init(state: AppState, bus: EventBus, player, generator, patterns_dir: str = "patterns") -> None:
    global _state, _bus, _player, _generator, _patterns_dir
    _state = state
    _bus = bus
    _player = player
    _generator = generator
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
            dead.add(ws)
    _ws_clients.difference_update(dead)


@app.on_event("startup")
async def _startup() -> None:
    # Capture the running event loop so worker threads can schedule broadcasts
    if _state is not None:
        _state.event_loop = asyncio.get_running_loop()
    if _bus is not None:
        for event_name in _ALL_EVENTS:
            _bus.subscribe(
                event_name,
                lambda p, name=event_name: _broadcast_event(name, p),
            )


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
        swing=_state.current_pattern.get("swing", 0),
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
    _player.start()
    return {"status": "playing"}


@app.post("/stop")
def post_stop():
    _player.stop()
    return {"status": "stopped"}


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


@app.get("/cc")
def get_cc():
    return _state.track_cc


@app.post("/mute", response_model=MuteResponse)
def set_mute(req: MuteRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    _state.update_mute(req.track, req.muted)
    _bus.emit("mute_changed", {"track": req.track, "muted": req.muted})
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
    new_pattern = apply_prob_step(_state.current_pattern, req.track, req.step - 1, req.value)
    _state.current_pattern = new_pattern
    _player.queue_pattern(new_pattern)
    _bus.emit("prob_changed", {"track": req.track, "step": req.step, "value": req.value})
    return {"track": req.track, "step": req.step, "value": req.value}


@app.post("/swing")
def set_swing(req: SwingRequest):
    new_pattern = apply_swing(_state.current_pattern, req.amount)
    _state.current_pattern = new_pattern
    _player.queue_pattern(new_pattern)
    _bus.emit("swing_changed", {"amount": req.amount})
    return {"amount": req.amount}


@app.post("/vel")
def set_vel(req: VelRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    new_pattern = apply_vel_step(_state.current_pattern, req.track, req.step - 1, req.value)
    _state.current_pattern = new_pattern
    _player.queue_pattern(new_pattern)
    _bus.emit("vel_changed", {"track": req.track, "step": req.step, "value": req.value})
    return {"track": req.track, "step": req.step, "value": req.value}


@app.post("/random")
def set_random(req: RandomRequest):
    if req.track != "all" and req.track not in TRACK_NAMES:
        raise HTTPException(422, f"Unknown track: {req.track}")
    if req.param not in ("velocity", "prob"):
        raise HTTPException(422, "param must be 'velocity' or 'prob'")
    tracks = list(TRACK_NAMES) if req.track == "all" else [req.track]
    if req.param == "velocity":
        new_pattern = apply_random_velocity(_state.current_pattern, tracks, req.lo, req.hi)
    else:
        new_pattern = apply_random_prob(_state.current_pattern, tracks, req.lo, req.hi)
    _state.current_pattern = new_pattern
    _player.queue_pattern(new_pattern)
    _bus.emit("random_applied", {"track": req.track, "param": req.param, "lo": req.lo, "hi": req.hi})
    return {"track": req.track, "param": req.param, "lo": req.lo, "hi": req.hi}


@app.get("/patterns", response_model=PatternListResponse)
def get_patterns():
    names = [
        p.stem for p in Path(_patterns_dir).glob("*.json")
    ]
    return PatternListResponse(names=sorted(names))


@app.post("/patterns/{name}")
def save_pattern(name: str):
    path = Path(_patterns_dir) / f"{name}.json"
    path.write_text(json.dumps(_state.current_pattern, indent=2))
    return {"saved": name}


@app.get("/patterns/{name}")
def load_pattern(name: str):
    path = Path(_patterns_dir) / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    pattern = json.loads(path.read_text())
    _player.queue_pattern(pattern)
    return {"loaded": name}


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
