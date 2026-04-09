# Digitakt LLM — Design Spec

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

A Python CLI tool that connects to an Elektron Digitakt drum machine via USB MIDI and uses the Anthropic API (Claude Opus 4.6) to generate 16-step drum patterns from plain-English descriptions. Patterns play in a continuous loop; the user can request variations or new patterns without stopping playback. A FastAPI server runs in the background at all times, exposing REST and WebSocket endpoints for a future web frontend.

---

## Architecture Principle: Headless Core

All business logic lives in framework-agnostic `core/` modules. The `cli/` and `api/` layers are thin adapters — they call into core and handle I/O only. No core module may import from `cli` or `api`.

---

## Project Structure

```
digitakt-llm/
  core/
    __init__.py
    player.py        # Playback engine — no CLI or web imports
    generator.py     # Anthropic API calls, prompt construction, JSON parsing
    midi_utils.py    # Port discovery, note-sending helpers
    state.py         # Shared application state (AppState dataclass)
    events.py        # Internal pub/sub event bus
  api/
    __init__.py
    server.py        # FastAPI app, REST endpoints, WebSocket broadcaster
    schemas.py       # Pydantic request/response models
  cli/
    __init__.py
    main.py          # Thin CLI adapter — calls core, prints output
  patterns/          # Saved pattern JSON files (.gitkeep)
  docs/
    superpowers/
      specs/
        2026-04-08-digitakt-llm-design.md
  pyproject.toml
  README.md
```

---

## Dependencies

Managed via `pyproject.toml` with a `digitakt-llm` CLI entry point.

```
mido
python-rtmidi
anthropic
fastapi
uvicorn[standard]
pydantic
```

Python requirement: `>=3.11`

Entry point: `digitakt-llm = "cli.main:main"`

**Dropped:** `websockets` — FastAPI/Starlette's built-in WebSocket handles `/ws` entirely.

---

## Shared State (`core/state.py`)

A single `AppState` dataclass instantiated once and passed into all core modules. All fields are readable from multiple threads. Mutable fields (pattern, bpm, etc.) are updated under a `threading.Lock`. The running asyncio event loop is stored here to support the async/sync WebSocket bridge.

```python
@dataclass
class AppState:
    current_pattern: dict          # 16-step pattern currently playing
    pending_pattern: dict | None   # queued for next loop boundary
    bpm: float                     # current tempo
    is_playing: bool
    midi_port_name: str | None
    last_prompt: str | None
    pattern_history: list[dict]    # last N patterns with their prompts
    event_loop: asyncio.AbstractEventLoop | None  # set by api/server.py on startup
    _lock: threading.Lock          # internal, not part of public API
```

`pattern_history` entries are `{"prompt": str, "pattern": dict, "timestamp": float}`. History is capped at 20 entries.

---

## Event Bus (`core/events.py`)

A simple pub/sub bus. Subscribers register callables; the bus calls them synchronously in the emitting thread. For WebSocket broadcasting, the subscriber uses `asyncio.run_coroutine_threadsafe()` to safely schedule async sends from worker threads.

**Events:**

| Event | Payload |
|-------|---------|
| `pattern_changed` | `{"pattern": dict, "prompt": str}` |
| `bpm_changed` | `{"bpm": float}` |
| `playback_started` | `{}` |
| `playback_stopped` | `{}` |
| `generation_started` | `{"prompt": str}` |
| `generation_complete` | `{"pattern": dict, "prompt": str}` |
| `generation_failed` | `{"prompt": str, "error": str}` |
| `midi_disconnected` | `{"port": str}` |

Bus interface:
```python
bus.subscribe("pattern_changed", callback)
bus.emit("pattern_changed", payload)
```

---

## Digitakt MIDI Details

- USB class-compliant device, no Overbridge required
- All tracks on MIDI channel 1 (mido channel index 0)
- Note off sent immediately after note on (zero-duration trigger)
- Default note mapping:

| Note | Track |
|------|-------|
| 36 | Kick |
| 37 | Snare |
| 38 | Hi-hat closed |
| 39 | Clap |
| 40 | Perc 1 |
| 41 | Perc 2 |
| 42 | Perc 3 |
| 43 | Perc 4 |

---

## MIDI Utilities (`core/midi_utils.py`)

Stateless helpers for port management and note sending.

```python
midi_utils.list_ports() -> list[str]          # available output port names
midi_utils.open_port(name: str) -> mido.ports.BaseOutput
midi_utils.send_note(port, note: int, velocity: int, channel: int = 0) -> None
midi_utils.find_digitakt(ports: list[str]) -> str | None  # returns port name if found
```

---

## Pattern Format

16-step sequences. Each step is an integer 0–127 (velocity). 0 = silent.

```json
{
  "kick":  [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
  "snare": [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
  "hihat": [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
  "clap":  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "perc1": [...],
  "perc2": [...],
  "perc3": [...],
  "perc4": [...]
}
```

Saved patterns are JSON files in `patterns/<name>.json`.

---

## LLM Integration (`core/generator.py`)

- **Model:** `claude-opus-4-6`
- **Auth:** `ANTHROPIC_API_KEY` from environment — no `.env` loading
- System prompt establishes Claude as a drum pattern generator with knowledge of groove, genre conventions, and dynamics
- User prompt includes the plain-English description and optionally the previous pattern + prompt for context
- Response must be strictly valid JSON matching the pattern schema
- On JSON parse failure: retry once with a stricter prompt. On second failure: emit `generation_failed`
- Emits `generation_started` before API call; `generation_complete` or `generation_failed` on resolution

**Input modes supported:**
- Fresh pattern: `"heavy techno kick"` — no prior context passed
- Variation: `"more sparse"` — prior pattern and prompt passed as context
- Fill: `"1-bar transition fill"` — treated as fresh with fill intent in prompt

**Public interface:**
```python
generator.generate(prompt: str, variation: bool = False) -> None
# Runs in a background thread; communicates via event bus
```

---

## Playback Engine (`core/player.py`)

- Runs on a dedicated background thread
- Step timing via `time.perf_counter()` for accuracy
- Step duration: `60 / bpm / 4` seconds (16th-note steps at the given BPM)
- Atomic pattern swap: `queue_pattern()` sets `state.pending_pattern`; the player applies it at the end of the current 16-step loop before the next loop begins
- BPM changes take effect at the next step (no hard reset)
- MIDI disconnect during playback: emits `midi_disconnected`, pauses, polls for reconnect every 2s

**Public interface:**
```python
player.start() -> None
player.stop() -> None
player.set_bpm(bpm: float) -> None
player.queue_pattern(pattern: dict) -> None
```

---

## REST API (`api/server.py`)

FastAPI app. Runs in a background thread via `uvicorn` when launched from CLI. The server captures the running asyncio event loop and stores it in `state.event_loop` on startup — required for the WebSocket async/sync bridge.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/state` | Full AppState as JSON |
| `POST` | `/generate` | Body: `{"prompt": str}` → triggers generation, returns 202 |
| `POST` | `/bpm` | Body: `{"bpm": float}` |
| `POST` | `/play` | Start playback |
| `POST` | `/stop` | Stop playback |
| `GET` | `/patterns` | List saved pattern names |
| `POST` | `/patterns/{name}` | Save current pattern to `patterns/<name>.json` |
| `GET` | `/patterns/{name}` | Load a saved pattern and queue it |
| `WS` | `/ws` | WebSocket — pushes all event bus messages as JSON |

### WebSocket Bridge (async/sync)

Event bus subscribers run in worker threads. The WebSocket broadcaster subscribes to all events and uses:

```python
asyncio.run_coroutine_threadsafe(
    broadcast_to_clients({"event": event_name, "data": payload}),
    state.event_loop
)
```

`broadcast_to_clients` is an `async` function that fans out to all connected WebSocket clients.

### Pydantic Models (`api/schemas.py`)

- `GenerateRequest(prompt: str)`
- `BpmRequest(bpm: float)`
- `StateResponse` — mirrors AppState fields (excludes `_lock`, `event_loop`)
- `PatternListResponse(names: list[str])`

---

## CLI Layer (`cli/main.py`)

Thin adapter only — no logic. Startup sequence:

1. Instantiate `AppState`, `EventBus`, `MidiUtils`, `Player`, `Generator`
2. Start FastAPI server in a background thread on `PORT` env var (default 8000)
3. Scan MIDI ports via `midi_utils.list_ports()`; auto-select if "Digitakt" found, else prompt user
4. Ask for initial BPM (default 120)
5. Load and play default 4-on-the-floor pattern

**REPL commands:**

| Input | Action |
|-------|--------|
| `bpm <value>` | `player.set_bpm(float(value))` |
| `stop` | `player.stop()` |
| `play` | `player.start()` |
| `show` | Print ASCII step grid |
| `save <name>` | Save current pattern to `patterns/<name>.json` |
| `load <name>` | Load and queue saved pattern |
| anything else | `generator.generate(prompt)` |

**ASCII step grid:**
```
     1 . . . 2 . . . 3 . . . 4 . . .
kick [X . . . X . . . X . . . X . . .]
snr  [. . . . X . . . . . . . X . . .]
hhat [X . X . X . X . X . X . X . X .]
clap [. . . . . . . . . . . . . . . .]
```

`X` = velocity > 0, `.` = silent.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| API failure | Keep playing current pattern; emit `generation_failed`; print error in CLI |
| JSON parse failure | Retry once with stricter prompt; emit `generation_failed` on second failure |
| MIDI disconnect | Emit `midi_disconnected`; pause playback; poll every 2s for reconnect |
| Port not found at startup | Print available ports; prompt user to select |

All errors surface through the event bus so a future web UI can display them.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `PORT` | `8000` | FastAPI server port |

No `.env` file loading. Values must be set in the shell environment before running.

---

## Default Pattern (4-on-the-floor)

Used at startup before any LLM generation:

```json
{
  "kick":  [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
  "snare": [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
  "hihat": [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
  "clap":  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "perc1": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "perc2": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "perc3": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "perc4": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

---

## Future Web Frontend Integration

The FastAPI server is always running when the CLI is active. To attach a frontend:

- **REST:** `GET /state` returns the full `AppState` shape documented above
- **WebSocket:** `WS /ws` pushes every event bus message as `{"event": "<name>", "data": {...}}`
- No authentication required (local use only)
- The frontend can call `POST /generate`, `POST /bpm`, `POST /play`, `POST /stop` to control playback
