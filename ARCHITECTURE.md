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
    │  emits: generation_complete  {pattern, prompt, bpm, cc_changes, summary, producer_notes?}
    │
    ├──► AppState.update_pattern()   (history, last_prompt)
    ├──► AppState.pending_pattern    (queued for next loop)
    └──► API broadcasts via WebSocket → Bun/Ink TUI

Player._loop()                  ← runs in daemon thread
    │  N steps × 6 MIDI clock ticks (24 PPQN), N = pattern_length (8/16/32)
    │  per step: apply swing delay on odd steps, evaluate conditional trig,
    │            check per-step prob; if `current_pattern.seq_mode` is `euclidean`, gate note-ons
    │            by per-track Bjorklund (k, n, r) from `current_pattern.euclid`
    │            scale velocity by track_velocity,
    │            apply gate scheduling (note_off via threading.Timer), send note + clock ticks
    │  check track_muted before sending
    │  per-step CC overrides are sent every step regardless of Euclidean gating
    │
    └── end of loop:
        ├── if pending_pattern → swap atomically; emits: pattern_changed
        └── if pending_mutes   → apply_pending_mutes() (bar-synced mute)
```

**Direct mutation path** (slash commands):
```
command → clone pattern (deepcopy) → mutate field → queue_pattern → atomic swap at loop end
```
This path bypasses the LLM entirely. It is used by `/prob`, `/prob-track`, `/vel`, `/vel-track`, `/swing`, `/mute`,
`/mute-queued`, `/random`, `/gate`, `/gate-track`, `/pitch`, `/cond`, `/cc-step`, and `POST /seq-mode`
(TUI: `/mode standard` or `/mode euclidean`).

## EventBus Events

| Event | Emitter | Payload |
|-------|---------|---------|
| `generation_started` | Generator | `{prompt}` |
| `generation_complete` | Generator | `{pattern, prompt, bpm, cc_changes, summary, producer_notes?}` — `producer_notes` is plain text from the model (not stored in `current_pattern`) |
| `generation_failed` | Generator | `{prompt, error}` |
| `pattern_changed` | Player / Server | `{pattern, prompt}` |
| `bpm_changed` | Player / Server | `{bpm}` |
| `playback_started` | Player | `{}` |
| `playback_stopped` | Player | `{}` |
| `midi_disconnected` | Player | `{port}` |
| `midi_connected` | Server | `{port}` — after `POST /midi/connect` hot-plugs an output |
| `cc_changed` | Server | `{track, param, value}` |
| `lfo_changed` | Server | `{target, lfo}` — `lfo` is a dict or `null` when the route is cleared (see LFO in `current_pattern` below) |
| `cc_step_changed` | Server | `{track, param, step, value}` |
| `mute_changed` | Server / Player | `{track, muted}` |
| `velocity_changed` | Server | `{track, value}` |
| `swing_changed` | Server | `{amount}` |
| `prob_changed` | Server | `{track, step, value}` |
| `vel_changed` | Server | `{track, step, value}` |
| `random_applied` | Server | `{track, param, lo, hi}` |
| `randbeat_applied` | Server | `{bpm, swing}` |
| `step_changed` | Player | `{step, global_step}` — `global_step` is the monotonic engine index (`loop * pattern_length + step`) for LFO phase; TUI uses it for the LFO graph |
| `length_changed` | Server | `{steps}` |
| `fill_started` | Player | `{}` |
| `fill_ended` | Player | `{}` |
| `gate_changed` | Server | `{track, step, value}` |
| `pitch_changed` | Server | `{track, value}` |
| `note_changed` | Server | `{track, step, value}` — `value` may be `null` when inheriting track pitch |
| `cond_changed` | Server | `{track, step, value}` |
| `state_reset` | Server | `{}` |
| `pattern_loaded` | Server | `{}` — TUI refetches `/state` after a named pattern load |
| `chain_updated` | Server | `{chain, chain_index, chain_auto, chain_queued_index, chain_armed}` |
| `chain_queued` | Server | `{chain, chain_index, chain_auto, chain_queued_index, chain_armed}` |
| `chain_armed` | Server / Player | `{chain, chain_index, chain_auto, chain_queued_index, chain_armed}` |
| `chain_advanced` | Player | `{chain, chain_index, chain_auto, chain_queued_index, chain_armed}` |

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

## Chain Queue + Manual Fire (Bar-Synced)

Chain sequencing is split into two performer-friendly phases:

1. **Queue candidate** (`POST /chain/next`) selects the next chain slot and stores it as
   `chain_queued_index` (no immediate pattern swap).
2. **Fire on 1** (`POST /chain/fire`) arms the queued candidate by writing it to `pending_pattern`
   and setting `chain_armed=True`.

At the next bar boundary (`Player._loop()` end-of-loop call to `AppState.apply_bar_boundary()`),
the pending pattern is swapped atomically; then chain state is finalized:

- `chain_index` moves to the queued slot
- queued state clears
- `chain_armed` resets to `False`
- `chain_advanced` event is emitted

Auto chain mode (`POST /chain` with `auto=true`) uses the same internals: it auto-arms the next
slot at bar boundaries, then advances on the subsequent swap.

## Saved pattern files (JSON)

`POST /patterns/{name}` writes `version: 2` JSON via `core/pattern_snapshot`: the step `pattern` (tracks, optional `prob` / `gate` / `cond` / `note` / `swing` / `step_cc`, optional `lfo` — map of LFO routes keyed e.g. `cc:kick:filter` / `trig:snare:prob` / `pitch:kick:main` —, optional `seq_mode`, `euclid`, and `euclid_strip_mode` for Euclidean sequencing / strip layout, etc.) plus session fields `bpm`, `swing` (global swing amount), `pattern_length`, `track_cc`, `track_velocity`, `track_pitch`, and `track_muted`. Legacy saves without `version` still load: only the pattern portion is applied (previous behavior). `GET /patterns/{name}` restores the full snapshot when `version` is 2, flushes global CC to the MIDI port if connected, and emits `pattern_loaded` so clients can resync from `/state`. `DELETE /patterns/{name}` removes a saved file. `POST /fill/{name}` continues to use only the nested `pattern` for the one-shot fill.

Per-step `note` (optional dict of track → list of MIDI note 0–127 or JSON `null` to inherit `track_pitch` for that step) is edited from the TRIG panel or `POST /note`; playback uses the step override when set, otherwise `track_pitch` (or the default note map).

## Pattern Length

`AppState.pattern_length` (8, 16, or 32 steps) controls the player loop range. `POST /length` also
resizes the current pattern (pad with zeros or truncate) and emits `pattern_changed` so the TUI grid
redraws. The system prompt passed to Claude is dynamically generated to match the current step count.

## Sequencing mode (standard vs Euclidean)

`current_pattern` may include `seq_mode`: `"standard"` (default) or `"euclidean"`, and `euclid`: a map
of track name → `{k, n, r}` (pulse count, ring length 1–32, rotation). In Euclidean mode the player
gates **note-ons** using Bjorklund(k, n) at ring index `(master_step + r) % n`; per-step trigs and
velocities are still read at the global step index. `POST /seq-mode` updates mode and optional `euclid`
rows (same mutator path as other pattern edits). `GET /state` ensures defaults exist when all eight
track rows are present. The TUI uses `/mode standard` or `/mode euclidean` (overloaded alongside
`/mode chat|beat` for input mode).

`euclid_strip_mode`: `"grid"` (default) or `"fractional"` — **display only** for the Euclidean track strip
(`EuclidGridPanel`): `grid` gives each vertex one equal terminal column; `fractional` merges character columns from the pattern length across ring vertices (when ring length n ≤ pattern length). Normalized with `seq_mode` / `euclid` in `normalize_euclid_in_pattern`.
`POST /euclid-strip-mode` with `{"mode":"grid"|"fractional"}` updates only this key; `pattern_changed` carries
the full `pattern` dict including `euclid_strip_mode` (same as `generation_complete` / loads).

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

## Injectable user-message context (genres + drum machines)

`Generator._build_user_prompt()` calls `build_injectable_context_prefix()` from [`core/injectable_profiles.py`](core/injectable_profiles.py). Each **injectable profile** has a stable `id`, a `category` (`genre` or `drum_machine`), phrase **aliases** (word-boundary, case-insensitive match; negations like `not` / `non-` respected), and a **body** string prepended to the user message — before the variation/TARGETED UPDATE block and before `Current state:`. The system prompt stays byte-identical so Anthropic's ephemeral prompt cache keeps hitting; variable guidance lives in the user message.

**Prefix order:** when both match, the **genre** block is first, then the **drum_machine** block (so e.g. ambient layout rules still lead timbre-specific machine notes).

**Registry:** profiles live in `_PROFILE_TUPLE` / `PROFILES_BY_ID` in `injectable_profiles.py`. `validate_injectable_profile_registry()` runs at import: dict keys must equal `profile.id`, and **aliases must be unique across all profiles**.

**How to add a profile:** append one `InjectableProfile(...)` to `_PROFILE_TUPLE` with a new `id`, `category`, `aliases` (put longer phrases before shorter ones when they share a start position), and `body`. Add tests for aliases and injection if non-trivial.

**Shipped profiles:**

- **Genre `ambient`** — aliases include `ambient`, `dark ambient`, `drone`, `downtempo`, `soundscape`, `deep listening`. Remaps the eight track slots to atmospheric voices and requires `producer_notes` to open with `TRACK SAMPLES:` (per-track sample lines, then short arrangement notes).

- **Drum machine `linndrum`** — LM-2 / LinnDrum sonic target (80s dry sample character, per-track + CC hints).

- **Drum machine `cr78`** — Roland CR-78 sonic target (warm hybrid analog/ROM character, per-track + CC hints).

**TR-808 / TR-909** remain described in the cached **system** prompt (`_build_system_prompt` in `core/generator.py`) as classic Roland box stereotypes; they are not injectable profiles yet (moving them would trade prompt-cache locality for consistency). Mention **LinnDrum** / **CR-78** (or aliases) in the beat prompt to pull those injectable blocks.

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

### SEQ Step Edit + TRIG Side Panel

When focus is on **SEQ**, pressing `Enter` toggles a per-track step edit mode:

- `←/→` select step
- `Space` toggles the selected step velocity (`0` off, track default on)
- `↑/↓` can switch tracks while remaining in step edit mode

From SEQ step edit mode, `Tab` opens a contextual **TRIG** side panel for the selected step.
This panel edits:

- per-step `prob` (`POST /prob`) or track-wide via `POST /prob-track`
- per-step velocity lane (`POST /vel`) or track-wide via `POST /vel-track`
- per-track note/pitch (`POST /pitch`) for that track
- per-step `gate` (`POST /gate`) or track-wide via `POST /gate-track`
- per-step `cond` (`POST /cond`)

`POST /prob-track`, `POST /vel-track`, and `POST /gate-track` apply one value across all steps for the current pattern length, then emit `pattern_changed` with the full pattern (same refresh path as `/length`).

TRIG keyboard behavior:

- `↑/↓` navigate fields
- `←/→` adjust field value (`Shift+←/→` for ±10 on numeric fields)
- `[`/`]` navigate steps while TRIG keys are active, or move the step when editing the step column
- Plain `t` (step edit only) toggles whether arrow keys target **TRIG fields** vs the **step column** (TRIG panel is always visible). `Shift+t` from the **track row** (not in step edit) enters step edit, enables TRIG key focus, and enables ALL (playhead step when playing). `Shift+t` in step edit toggles ALL when TRIG keys are active (not on the condition row), or enables TRIG keys with ALL when they are off
- `0-9` + `Enter` commit typed numeric values directly

The TUI keeps **SEQ** and **MIX** selected tracks in sync: changing the track in either panel updates the other.

In the TUI layout, the left focus rail remains anchored. **SEQ** spans the main column; **MIX** and **TRIG** share one row below it (TRIG always shown). **LOG**, when enabled, is a full-width strip under the rail + main block.

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
  "cc":      {"<track>": {"<param>": <0–127>, ...}, ...}, // optional
  "producer_notes": "<string>"                            // optional; modular/arrangement tips, max ~1200 chars; stripped from pattern before `AppState.update_pattern`
}
```

The optional `"cc"` key lets Claude include sound design changes alongside the pattern. Valid params: `tune`, `filter`, `resonance`, `attack`, `decay`, `volume`, `reverb`, `delay`, `velocity`. These are applied to `AppState.track_cc` / `AppState.track_velocity` immediately after the pattern is queued.

The optional `"producer_notes"` key is returned to the TUI in `generation_complete.summary` and as a top-level `producer_notes` field; it is **not** written into `current_pattern` (playback, saves, and history stay drum-only).

## LLM System Prompt — Genre & Sound Design Knowledge

The system prompt (`_build_system_prompt()`) encodes domain knowledge including:

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

**Classic machine character (TR-808 vs TR-909)** — concise timbre stereotypes mapped to Digitakt sample playback via CC and velocity (e.g. 808 long sub kick vs 909 punch/rumble kick).

**Hypnotic / minimal techno** — sparse kicks, polyrhythmic implication on a 16-step grid, optional `prob` for drift, BPM note for “minimal hypnotic” vs peak-time.

**Optional `producer_notes`** — when the user prompt implies arrangement beyond drums, the model may add short Eurorack/modular pairing advice in JSON.

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
| `POST` | `/generate` | Queue LLM pattern generation; optional JSON `variation` (`null` = legacy: vary when `last_prompt` set; `false` = fresh context) |
| `POST` | `/ask` | Q&A via Claude Haiku (single call; trailing `IMPLEMENTABLE: YES/NO` parsed for `/gen` hint) |
| `POST` | `/play` | Start MIDI playback |
| `POST` | `/stop` | Stop MIDI playback |
| `GET` | `/midi/outputs` | List MIDI output port names |
| `POST` | `/midi/connect` | Hot-plug MIDI output (`{}` auto-finds a port containing `Digitakt`, or `{"port": "<exact name>"}`) |
| `POST` | `/bpm` | Set tempo (20–400) |
| `POST` | `/swing` | Set swing amount (0–100) |
| `POST` | `/length` | Set pattern step count (8, 16, or 32) |
| `POST` | `/new` | Reset to empty pattern, clear state |
| `POST` | `/undo` | Revert to previous pattern from history |
| `POST` | `/mute` | Immediate track mute toggle |
| `POST` | `/mute-queued` | Queue mute change for next bar boundary |
| `POST` | `/velocity` | Set global track velocity (0–127) |
| `POST` | `/prob` | Set per-step probability (0–100) |
| `POST` | `/prob-track` | Set probability to the same value on every step for a track |
| `POST` | `/vel` | Set per-step velocity (0–127) |
| `POST` | `/vel-track` | Set step velocity to the same value on every step for a track |
| `POST` | `/random` | Randomize velocity or probability for a track or all |
| `POST` | `/randbeat` | Generate random techno beat (BPM 128–160, CC randomized) |
| `POST` | `/cc` | Set global CC parameter for a track |
| `POST` | `/lfo` | Set or clear one LFO route: JSON `{"target":"cc:kick:filter", "lfo":{...}}` or `{"target":"...","lfo":null}`; emitted `lfo_changed`. LLM does not emit LFOs in v1. |
| `GET` | `/cc` | Get all track CC values |
| `POST` | `/cc-step` | Set per-step CC override (-1 to clear) |
| `POST` | `/gate` | Set per-step gate length (0–100%) |
| `POST` | `/gate-track` | Set gate to the same value on every step for a track |
| `POST` | `/pitch` | Set per-track MIDI note number (0–127) |
| `POST` | `/cond` | Set/clear conditional trig on a step |
| `GET` | `/patterns` | List saved patterns (name, tags, optional `bpm`, `pattern_length`, `swing` from v2 JSON) |
| `POST` | `/patterns/{name}` | Save pattern + session snapshot (`version: 2` JSON) with optional tags |
| `DELETE` | `/patterns/{name}` | Delete a saved pattern file |
| `GET` | `/patterns/{name}` | Load pattern; restore BPM/CC/pitch/velocity/mutes/length when snapshot present |
| `POST` | `/note` | Per-step MIDI note override (`value` null = inherit `track_pitch`); emits `note_changed` |
| `POST` | `/fill/{name}` | Queue saved pattern as one-shot fill |
| `POST` | `/chain` | Define chain names and auto mode |
| `POST` | `/chain/next` | Queue next chain candidate (no immediate swap) |
| `POST` | `/chain/fire` | Arm queued chain candidate for next bar downbeat |
| `POST` | `/chain/slot/{slot}/fill` | Queue one-shot fill from chain slot `1…n` (rejects if fill already playing) |
| `DELETE` | `/chain` | Clear chain state |
| `GET` | `/traces` | Return recent LLM prompt/response traces |
| `WS` | `/ws` | WebSocket stream of all EventBus events |
