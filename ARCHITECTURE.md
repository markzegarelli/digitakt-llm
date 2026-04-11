# Architecture

## Design Principles

- **Headless core**: `core/` has no I/O dependencies. `cli/` and `api/` are thin adapters that wire it up.
- **Single shared state**: `AppState` is instantiated once in `main()` and passed everywhere. No globals outside `api/server.py` singletons (set via `init()`).
- **EventBus decoupling**: modules never import each other. Generator emits `generation_complete`; Player subscribes. API subscribes for WebSocket broadcast to the Bun/Ink TUI.

## Data Flow

```
User input (Bun/Ink TUI or POST /generate)
    │
    ▼
Generator._run(prompt)          ← runs in daemon thread
    │  emits: generation_started
    │
    ▼
Anthropic API → JSON → validate
    │  emits: generation_complete  {pattern, prompt, bpm, cc_changes}
    │
    ├──► AppState.update_pattern()   (history, last_prompt)
    ├──► AppState.pending_pattern    (queued for next loop)
    └──► API broadcasts via WebSocket → Bun/Ink TUI

Player._loop()                  ← runs in daemon thread
    │  N steps × 6 MIDI clock ticks (24 PPQN), N = pattern_length (8/16/32)
    │  per step: apply swing delay on odd steps, evaluate conditional trig,
    │            check per-step prob, scale velocity by track_velocity,
    │            apply gate scheduling (note_off via threading.Timer), send note + clock ticks
    │  check track_muted before sending
    │
    └── end of loop:
        ├── if pending_pattern → swap atomically; emits: pattern_changed
        └── if pending_mutes   → apply_pending_mutes() (bar-synced mute)
```

**Direct mutation path** (slash commands):
```
command → clone pattern (deepcopy) → mutate field → queue_pattern → atomic swap at loop end
```
This path bypasses the LLM entirely. It is used by `/prob`, `/vel`, `/vel-step`, `/swing`, `/mute`,
`/mute-queued`, `/random`, `/gate`, `/pitch`, `/cond`, and `/cc-step`.

## EventBus Events

| Event | Emitter | Payload |
|-------|---------|---------|
| `generation_started` | Generator | `{prompt}` |
| `generation_complete` | Generator | `{pattern, prompt, bpm, cc_changes}` |
| `generation_failed` | Generator | `{prompt, error}` |
| `pattern_changed` | Player / Server | `{pattern, prompt}` |
| `bpm_changed` | Player / Server | `{bpm}` |
| `playback_started` | Player | `{}` |
| `playback_stopped` | Player | `{}` |
| `midi_disconnected` | Player | `{port}` |
| `cc_changed` | Server | `{track, param, value}` |
| `cc_step_changed` | Server | `{track, param, step, value}` |
| `mute_changed` | Server / Player | `{track, muted}` |
| `velocity_changed` | Server | `{track, value}` |
| `swing_changed` | Server | `{amount}` |
| `prob_changed` | Server | `{track, step, value}` |
| `vel_changed` | Server | `{track, step, value}` |
| `random_applied` | Server | `{track, param, lo, hi}` |
| `randbeat_applied` | Server | `{bpm, swing}` |
| `step_changed` | Server | `{track, step, value}` |
| `length_changed` | Server | `{steps}` |
| `fill_started` | Player | `{}` |
| `fill_ended` | Player | `{}` |
| `gate_changed` | Server | `{track, step, value}` |
| `pitch_changed` | Server | `{track, value}` |
| `cond_changed` | Server | `{track, step, value}` |
| `state_reset` | Server | `{}` |

All events are forwarded via WebSocket to the Bun/Ink TUI as `{"event": "<name>", "data": {...}}`.

## Threading Model

- **Main thread**: Bun/Ink TUI process (separate subprocess launched by `cli/tui_launcher.py`)
- **Generator thread**: one daemon thread per generation call
- **Player thread**: one long-lived daemon thread, stopped via `threading.Event`
- **Uvicorn thread**: one daemon thread running the asyncio event loop
- **WebSocket bridge**: `asyncio.run_coroutine_threadsafe()` from worker threads → uvicorn loop
- **Gate timers**: `threading.Timer` instances fire `note_off` (note_on velocity=0) after gate duration

`AppState._lock` protects `update_pattern()`, `update_mute()`, `queue_mute()`, `apply_pending_mutes()`,
`update_cc()`, and `update_velocity()`. `pending_pattern` swap in the player loop is atomic (GIL-protected single assignment).

## Pattern Swap (Atomic)

New patterns are never applied mid-loop. At the end of each N-step cycle (N = `state.pattern_length`),
the player checks `state.pending_pattern` and swaps it into `state.current_pattern` in one assignment.
This prevents glitchy half-pattern playback.

## Mute Queue (Bar-Synced)

`POST /mute-queued` calls `AppState.queue_mute(track, muted)`, storing the change in `pending_mutes`.
At each loop boundary the player calls `apply_pending_mutes()`, which atomically applies all queued
changes and emits `mute_changed` for each. `POST /mute` applies immediately (no bar sync).

In the TUI, pressing `q` stages a track into a local `pendingMuteTracks` set (shown with `[Q]` in
yellow). Pressing `Q` (Shift+Q) fires all staged tracks via `/mute-queued` and clears the local set.

## Fill Patterns (One-Shot)

`POST /fill/<name>` loads a saved pattern and calls `AppState.queue_fill()`. At the next loop
boundary the player: saves `current_pattern` to `_pre_fill_pattern`, swaps in the fill, plays it
once, then restores the original. Emits `fill_started` and `fill_ended` events.

## Pattern Length

`AppState.pattern_length` (8, 16, or 32 steps) controls the player loop range. `POST /length` also
resizes the current pattern (pad with zeros or truncate) and emits `pattern_changed` so the TUI grid
redraws. The system prompt passed to Claude is dynamically generated to match the current step count.

## Bar-Synced Mute Queue

Mute changes via `POST /mute-queued` are not applied immediately — they are staged in `AppState.pending_mutes` (a `dict[str, bool]`) and applied by `apply_pending_mutes()` at the end of each 16-step bar, in the same atomic window as pattern swaps. This prevents mid-bar glitches when toggling tracks live.

`POST /mute` (immediate) and `POST /mute-queued` (bar-synced) are both available. The TUI uses bar-synced by default.

## Observability

### Structured Logging

`core/logging_config.py` provides a JSON-lines structured logger used throughout the backend.

- `get_logger(name)` returns a `logging.Logger` configured with `JSONFormatter`
- Each log entry is a JSON object with fields: `ts`, `level`, `logger`, `message`, plus optional extras (`prompt`, `raw_response`, `error_type`, `latency_ms`, `status`)
- Set `DIGITAKT_LOG_FILE=<path>` to write JSON-lines logs to a file (in addition to stderr)
- Used by `core/generator.py` (generation lifecycle, JSON parse failures, API latency), `core/player.py` (MIDI errors, disconnects), and `api/server.py` (request handling)

### Prompt Tracing

`core/tracing.py` provides structured LLM call tracing via a module-level `tracer` singleton.

- Each `Generator._call_api()` invocation is wrapped in a `tracer.span()` context manager
- Each `TraceSpan` records: `operation`, `prompt` (truncated to 500 chars), `response` (truncated to 1000 chars), `status` (`ok`/`error`), `error`, `latency_ms`, `timestamp`, `metadata`
- Spans for retried calls use operation name `generate_retry`
- Traces are stored in-memory (bounded to 200 entries, FIFO)
- Set `DIGITAKT_TRACE_FILE=<path>` to also append traces as JSON-lines to a file
- `GET /traces` returns the in-memory trace list for debugging

## Retry Logic

Generator calls the API once. If JSON parse fails, it retries once with an appended strict suffix
instructing Claude to output only raw JSON. After two failures it emits `generation_failed`.

## Generation State Context

Before every API call, `Generator._build_state_context()` assembles a plain-text summary of the current playback state and prepends it to the user prompt. This gives the model awareness of:

- Muted tracks (so it doesn't generate hits for them)
- Non-default CC values (so it can build on existing sound design)
- Non-default track velocities
- Current BPM and pattern length
- Current swing amount

## Variation Mode

If `state.last_prompt` is set, subsequent prompts are sent as variations: the prior prompt and active pattern JSON (non-silent tracks only) are prepended to the user message alongside the state context, giving Claude full context for incremental changes.

## Conversation Continuity

`Generator.conversation_history` is a shared list (bounded to 20 entries / 10 pairs) used by both beat generation and the `/ask` Q&A path. This means follow-up questions can reference recently generated patterns, and beat prompts can reference prior conversation. Both `_run()` and `answer_question()` append to this history after each interaction.

## Conversation Continuity

`Generator.conversation_history` (bounded to 20 entries / 10 turns) is shared between `generate()`
and `answer_question()`. Chat answers and beat generations both append to history, so `/ask` has
context about recent patterns and `/gen` can reference prior conversation.

## Command Dispatch (Bun/Ink TUI)

The TUI input field in `tui/src/App.tsx` routes input:

- **Slash commands** (`/play`, `/bpm 130`, etc.) are parsed in `handleCommand()` and dispatched via
  REST calls to the FastAPI backend. Unrecognized slash commands log an error.
- **Chat mode** (`/mode chat` or Shift+Tab): bare text → `/ask` (conversational Q&A via Haiku)
- **Beat mode** (`/mode beat`): bare text → `POST /generate` (LLM pattern generation via Opus)

`cli/commands.py` holds pure pattern-mutation helpers (`apply_prob_step`, `apply_vel_step`,
`apply_swing`, `apply_random_velocity`, `apply_random_prob`, `apply_gate_step`, `apply_cond_step`,
`apply_cc_step`, `parse_random_range`, `generate_random_beat`). These functions take and return plain
dicts (no mutation) and have no UI dependencies — fully testable in isolation.

## Per-Step Parameters

Patterns support several per-step parameters beyond simple on/off:

| Field | Location in pattern dict | Range | Player behavior |
|-------|--------------------------|-------|-----------------|
| Velocity | `pattern[track][step]` | 0 (silent) – 127 | Scaled by `state.track_velocity[track]` before MIDI send |
| Probability | `pattern["prob"][track][step]` | 0–100 | Random skip: `random.random() * 100 >= prob` → skip |
| Swing | `pattern["swing"]` | 0–100 | Odd steps delayed by `swing/100 * step_duration/3` seconds |
| Gate | `pattern["gate"][track][step]` | 0–100 (%) | Schedules `note_off` after `gate/100 * step_duration` seconds; 100 = no explicit off |
| Condition | `pattern["cond"][track][step]` | `"1:2"` / `"not:2"` / `"fill"` / `null` | Step fires only when condition matches loop count or fill state |

`pattern["prob"]` is optional — if absent, all steps fire with 100% probability.
`pattern["swing"]` is optional — if absent or 0, no swing is applied.

## LLM Pattern JSON Format

Claude produces (and the API accepts) this JSON structure:

```json
{
  "bpm":     <integer, 20–400>,
  "kick":    [<16 integers, 0–127>],
  "snare":   [<16 integers, 0–127>],
  "tom":     [<16 integers, 0–127>],
  "clap":    [<16 integers, 0–127>],
  "bell":    [<16 integers, 0–127>],
  "hihat":   [<16 integers, 0–127>],
  "openhat": [<16 integers, 0–127>],
  "cymbal":  [<16 integers, 0–127>],
  "prob":    {"<track>": [<16 integers, 0–100>], ...},   // optional
  "swing":   <integer, 0–100>,                           // optional
  "cc":      {"<track>": {"<param>": <0–127>, ...}, ...} // optional
}
```

The optional `"cc"` key lets Claude include sound design changes alongside the pattern. Valid params: `tune`, `filter`, `resonance`, `attack`, `decay`, `volume`, `reverb`, `delay`, `velocity`. These are applied to `AppState.track_cc` / `AppState.track_velocity` immediately after the pattern is queued.

## LLM System Prompt — Genre & Sound Design Knowledge

The system prompt (`_build_system_prompt()`) encodes two categories of domain knowledge:

**Subgenre BPM ranges** — the model selects a BPM from the matching range:

| Genre | BPM range |
|-------|-----------|
| Detroit / minimal techno | 130–138 |
| Dub techno | 120–130 |
| Acid / hypnotic techno | 138–148 |
| Industrial / dark / hard techno | 140–155 |
| Schranz | 150–162 |
| Breakbeat / electro | 125–140 |
| House / deep house / tech house | 120–130 |
| Jungle / DnB | 160–180 |
| Ambient / downtempo | 70–110 |
| EBM / darkwave | 110–130 |

**Digitakt CC parameter guidance** — the model uses these to make musically appropriate CC suggestions:

| CC param | CC# | Typical range | Notes |
|----------|-----|---------------|-------|
| tune | 16 | 50–80 | 64 = default pitch; lower = deeper |
| filter | 74 | 60–127 | Lowpass cutoff; kicks 80–127, hihats 60–127 |
| resonance | 75 | 0–50 | 0 = clean; 50+ = acid/resonant |
| attack | 78 | 0–80 | 0 = instant hit; higher = slow fade-in |
| decay | 80 | 20–110 | Controls ring length |
| reverb | 83 | 0–127 | Send amount; 10–40 = space, 60+ = wash |
| delay | 82 | 0–127 | Send amount; 10–30 = subtle, 50+ = pronounced |
| volume | 7 | 90–110 | Track level for mix balance |
`pattern["prob"]`, `pattern["gate"]`, and `pattern["cond"]` are optional — if absent, defaults apply
(100% prob, full gate, no condition).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/state` | Full application state snapshot |
| `POST` | `/generate` | Queue LLM pattern generation |
| `POST` | `/ask` | Q&A via Claude Haiku (does not generate pattern) |
| `POST` | `/play` | Start MIDI playback |
| `POST` | `/stop` | Stop MIDI playback |
| `POST` | `/bpm` | Set tempo (20–400) |
| `POST` | `/swing` | Set swing amount (0–100) |
| `POST` | `/length` | Set pattern step count (8, 16, or 32) |
| `POST` | `/new` | Reset to empty pattern, clear state |
| `POST` | `/undo` | Revert to previous pattern from history |
| `POST` | `/mute` | Immediate track mute toggle |
| `POST` | `/mute-queued` | Queue mute change for next bar boundary |
| `POST` | `/velocity` | Set global track velocity (0–127) |
| `POST` | `/prob` | Set per-step probability (0–100) |
| `POST` | `/vel` | Set per-step velocity (0–127) |
| `POST` | `/random` | Randomize velocity or probability for a track or all |
| `POST` | `/randbeat` | Generate random techno beat (BPM 128–160, CC randomized) |
| `POST` | `/cc` | Set global CC parameter for a track |
| `GET` | `/cc` | Get all track CC values |
| `POST` | `/cc-step` | Set per-step CC override (-1 to clear) |
| `POST` | `/gate` | Set per-step gate length (0–100%) |
| `POST` | `/pitch` | Set per-track MIDI note number (0–127) |
| `POST` | `/cond` | Set/clear conditional trig on a step |
| `GET` | `/patterns` | List saved patterns (with tags) |
| `POST` | `/patterns/{name}` | Save current pattern with optional tags |
| `GET` | `/patterns/{name}` | Load and queue a saved pattern |
| `POST` | `/fill/{name}` | Queue saved pattern as one-shot fill |
| `GET` | `/traces` | Return recent LLM prompt/response traces |
| `WS` | `/ws` | WebSocket stream of all EventBus events |
