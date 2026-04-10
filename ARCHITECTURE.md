# Architecture

## Design Principles

- **Headless core**: `core/` has no I/O dependencies. `cli/` and `api/` are thin adapters that wire it up.
- **Single shared state**: `AppState` is instantiated once in `main()` and passed everywhere. No globals outside `api/server.py` singletons (set via `init()`).
- **EventBus decoupling**: modules never import each other. Generator emits `generation_complete`; Player subscribes. CLI subscribes for display. API subscribes for WebSocket broadcast.

## Data Flow

```
User input (CLI or POST /generate)
    │
    ▼
Generator._run(prompt)          ← runs in daemon thread
    │  emits: generation_started
    │
    ▼
Anthropic API → JSON → validate
    │  emits: generation_complete  {pattern, prompt}
    │
    ├──► AppState.update_pattern()   (history, last_prompt)
    ├──► AppState.pending_pattern    (queued for next loop)
    └──► CLI prints "[pattern ready]"
         API broadcasts via WebSocket

Player._loop()                  ← runs in daemon thread
    │  16 steps × 6 MIDI clock ticks (24 PPQN)
    │  per step: apply swing delay on odd steps, check per-step prob,
    │            scale velocity by track_velocity, send note + clock ticks
    │  check track_muted before sending
    │
    └── end of loop: if pending_pattern → swap atomically
        emits: pattern_changed
```

## EventBus Events

| Event | Emitter | Payload |
|-------|---------|---------|
| `generation_started` | Generator | `{prompt}` |
| `generation_complete` | Generator | `{pattern, prompt, bpm, cc_changes}` |
| `generation_failed` | Generator | `{prompt, error}` |
| `pattern_changed` | Player | `{pattern, prompt}` |
| `bpm_changed` | Player | `{bpm}` |
| `playback_started` | Player | `{}` |
| `playback_stopped` | Player | `{}` |
| `midi_disconnected` | Player | `{port}` |
| `cc_changed` | Generator | `{track, param, value}` |
| `velocity_changed` | Generator | `{track, value}` |

## Threading Model

- **Main thread**: Textual TUI event loop; worker threads call `app.call_from_thread()` to update UI
- **Generator thread**: one daemon thread per generation call
- **Player thread**: one long-lived daemon thread, stopped via `threading.Event`
- **Uvicorn thread**: one daemon thread running the asyncio event loop
- **WebSocket bridge**: `asyncio.run_coroutine_threadsafe()` from worker threads → uvicorn loop

`AppState._lock` protects `update_pattern()`. `pending_pattern` swap in the player loop is atomic (GIL-protected single assignment).

## Pattern Swap (Atomic)

New patterns are never applied mid-loop. At the end of each 16-step cycle, the player checks `state.pending_pattern` and swaps it into `state.current_pattern` in one assignment. This prevents glitchy half-pattern playback.

## Retry Logic

Generator calls the API once. If JSON parse fails, it retries once with an appended strict suffix instructing Claude to output only raw JSON. After two failures it emits `generation_failed`.

## Variation Mode

If `state.last_prompt` is set, subsequent prompts are sent as variations: the prior prompt and full prior pattern JSON are prepended to the user message, giving Claude full context for incremental changes.
