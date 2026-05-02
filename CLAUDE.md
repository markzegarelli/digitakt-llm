# digitakt-llm — Agent Landing Page

CLI tool that generates 16-step drum patterns via Claude Opus 4.6 and plays them live on an Elektron Digitakt over USB MIDI. A FastAPI server runs in the background; the UI is a Bun/Ink (TypeScript/React) terminal app that connects to it.

## Quick Start

```bash
# Python backend + dev tools (see https://docs.astral.sh/uv/getting-started/installation/)
uv sync --extra dev

# Bun/Ink frontend
cd tui && bun install

# Launch everything (requires .env with ANTHROPIC_API_KEY)
uv run digitakt
```

**Without uv:** `python3 -m venv .venv && source .venv/bin/activate`, `pip install -e ".[dev]"`, then `digitakt`.

## The UI

**There is one UI: the Bun/Ink terminal app in `tui/`.** It is launched via the `digitakt` entry point, which starts the Python FastAPI backend and then runs `bun run src/index.tsx` in the `tui/` directory.

Layout (fixed): **SEQ** uses the full main column width; **MIX** and **TRIG** sit on one row under the sequencer (TRIG is always shown); **CMD** is below. When the activity log is on, **LOG** is a full-width strip under the rail + main block.

- Entry point: `digitakt` → `cli.tui_launcher:main`
- The launcher starts FastAPI on `http://localhost:8000`, then spawns the Bun process
- The Bun TUI connects via REST + WebSocket at that URL
- Type `/help` in the prompt panel for a full command reference
- `/bpm <n>` — set tempo (20–400)
- `/swing <n>` — set swing amount (0–100)
- `/length [8|16|32]` — set pattern step count
- `/prob <track> <value>` — set probability 0–100 on every step for a track (per-step: TRIG panel)
- `/vel <track> <value>` — set velocity 0–127 on every step for a track (per-step: TRIG panel)
- `/gate <track> <0-100>` — set gate length on every step for a track (per-step: TRIG panel)
- `/pitch <track> <0-127>` — set MIDI note number for track (chromatic mode)
- `/cond <track> <step> <1:2|not:2|fill|clear>` — set/clear conditional trig on a step
- `/random [track|all] [vel|prob] [lo-hi]` — randomize velocity or probability
- `/randbeat` — generate a random techno beat
- `/mute <track> [on|off|toggle]` — queue a mute change to apply at the next bar boundary (default: toggle)
- `/cc <track> <param> <value>` — global CC control (0–127)
- `/lfo <target> <sine|square|triangle|ramp|saw> <depth> <num/den> [phase]` — tempo-synced LFO on a route (`cc:…`, `trig:…:prob|vel|gate|note`, or `pitch:…:main`); or `/lfo <target> clear`
- `/cc-step <track> <param> <step> <v>` — per-step CC override (-1 to clear)
- `/save <name> [#tag1 #tag2]` — save pattern with optional tags
- `/load [name]` — without a name: open an interactive list (↑↓ Enter Esc); with a name: queue that saved pattern for the next loop (or load immediately when stopped)
- `/delete [name]` — without a name: pick a pattern to delete (↑↓ Enter then Y/N); with a name: confirm deletion (Y/N)
- `/fill <name>` — queue saved pattern as one-shot fill (plays once, reverts)
- `/chain <p1> <p2> ... [--auto]` — define a pattern chain (setlist), optional auto-advance each bar
- `/chain next` — queue next chain candidate (does not switch yet)
- `/chain fire` — arm queued chain change to land on next bar downbeat (next "1")
- `/chain status` — show chain position, queued slot, and armed state
- `/chain clear` — clear chain state
- `/patterns [#tag]` — list saved patterns, optionally filtered by tag
- `/new` — reset to empty pattern
- `/undo` — revert to previous pattern
- `/history` — show pattern history
- `/log` — toggle activity log
- `/clear` — clear activity log
- `/mode [chat|beat|standard|euclidean]` — switch input mode (`chat` / `beat`) or pattern sequencing mode (`standard` grid vs `euclidean` rhythms)
- `/euclid-strip [grid|fractional]` — Euclidean track-strip display: `grid` uses pattern-length column buckets per vertex; `fractional` uses n equal columns (engine still fires on discrete pattern steps). Bare `/euclid-strip` toggles only when `seq_mode` is `euclidean`; explicit `grid`/`fractional` persists on the pattern anytime
- `/ask <question>` — ask Claude (works in any mode)
- `/fresh <prompt>` — generate a new pattern without prior-pattern variation context (same as `POST /generate` with `"variation": false`)
- `/gen` — generate a beat from the last `/ask` response
- `/midi` — connect MIDI output after hot-plug (auto-finds a port whose name contains `Digitakt`); flushes CC and sends MIDI start if playback is already running
- `/midi list` — list MIDI output port names (when auto-detect fails)

Keyboard shortcuts:

**Global**

- `?` — open help (SEQ/MIX/LOG focus, or CMD when input is empty)
- `Shift+M` — toggle sequencing mode `standard` ↔ `euclidean`
- `m` / `q` / `Shift+Q` — immediate mute, stage queued mute, fire queued mutes at next bar
- `c` / `n` / `Shift+N` — if a chain exists: focus chain strip, queue chain next, arm chain fire on next downbeat

**Interaction contract**

- `Tab` — rotate panel focus `SEQ → MIX → CMD`
- `Shift+Tab` — toggle input mode `beat` ↔ `chat`
- `/` — jump focus to CMD input
- `Enter` / `Esc` — enter/exit the active edit context in focused panel

**SEQ browse**

- `↑/↓` — select track
- `Enter` — standard: enter/exit SEQ step edit; euclidean: enter/exit `k/n/r` edit
- `Space` — play/stop transport when not in SEQ step edit

**SEQ step edit**

- `Space` — toggle selected step on/off
- `[` / `]` or `←/→` — move step (euclidean: pulse steps only)
- `t` — toggle TRIG keyboard focus (TRIG panel remains visible)
- `Shift+t` — from browse: open step edit + TRIG + ALL; from TRIG active: toggle ALL for prob/vel/gate
- `Tab` — toggle step/ring navigation keys vs TRIG value keys

**Euclidean ring (k/n/r)**

- `Enter` / `Esc` — open/close `k/n/r` boxes
- `[` / `]` or `←/→` (box open) — cycle `k`, `n`, `r` field
- `↑/↓` — track select when box closed, value adjust when open (`Shift+↑/↓` = ±10)
- `t` / `Shift+t` — open step+TRIG at first pulse / playhead pulse (`Shift+t` arms ALL)
- Ring rendering note: the 16-dot perimeter uses `+15` slot rotation so logical step `1` sits at top

**TRIG panel**

- `↑/↓` — choose field (prob, vel, note, gate, cond)
- `←/→` — adjust selected value (`Shift+←/→` = ±10 for numeric fields)
- `[` / `]` — move steps while TRIG panel stays open (euclidean: pulse-only)
- `0-9`, then `Enter` — type and commit numeric value
- `Esc` — leave TRIG keys (or exit euclidean step+TRIG context)

**MIX/CC normal + per-step**

- `↑/↓` — select CC parameter
- `[` / `]` — select track
- `←/→` — adjust global CC value (`Shift+←/→` = ±10)
- `Enter` — enter per-step CC edit
- Per-step mode: `←/→` step, `↑/↓` value (`Shift` = ±10), digits then `Enter` set value, `Backspace` clear override, `Esc` exit

**CMD input**

- `Enter` — submit command/input (or accept autocomplete completion first)
- `Tab` — cycle slash command suggestions
- `↑/↓` — command history when autocomplete is inactive
- `?` — open help when CMD input is empty

**Pattern picker/delete confirm**

- Picker (`/load`, `/delete` without name): `↑/↓` choose, `Enter` pick, `Esc` cancel
- Delete confirm: `Y` confirm, `N` or `Esc` cancel

**Footer legend**

- Dot legend: `·` off, `○` low velocity, `●` high velocity
- Status marks: dimmed dots = muted, `▼` ruler playhead, `◆` conditional trig marker

> **Note:** `cli/main.py` and `cli/tui.py` are a deprecated Textual-based TUI. They are no longer the entry point. Do not use or modify them.

## Key Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data flow, EventBus patterns
- [docs/ROADMAP.md](docs/ROADMAP.md) — v1 release gates and milestone order vs the codebase

## Project Layout

```
core/        # all logic — no I/O dependencies
  state.py         # AppState dataclass (single shared instance)
  events.py        # EventBus pub/sub (decouples all modules)
  generator.py     # Anthropic API → JSON pattern → EventBus
  player.py        # background thread, MIDI clock, prob/swing, atomic swap
  midi_utils.py    # port discovery, NOTE_MAP, send_note
  logging_config.py # JSONFormatter, get_logger() — structured log output
  tracing.py       # TraceSpan / Tracer — LLM call observability

api/         # thin FastAPI adapter
  server.py  # REST + WebSocket, init() wires singletons
  schemas.py # Pydantic request/response models

cli/         # backend launcher + helpers
  tui_launcher.py  # ENTRY POINT: starts FastAPI + Bun TUI
  commands.py      # pure pattern-manipulation helpers (no I/O)
  main.py          # DEPRECATED — old Textual TUI launcher, do not use
  tui.py           # DEPRECATED — Textual TUI, do not use

tui/         # Bun/Ink terminal UI (the real UI)
  src/
    index.tsx             # entry point
    App.tsx               # layout, keyboard input, command dispatch
    hooks/useDigitakt.ts  # WebSocket state + REST actions
    components/           # Header, PatternGrid, CCPanel, ActivityLog, Prompt

tests/       # one test file per module, TDD throughout
```

## Running Tests

```bash
uv run pytest -v
```

~288 tests, ~4s. All mocked — no real MIDI or API calls needed.

## Development Workflow

When closing a feature branch, invoke the `superpowers:finishing-a-development-branch` skill. Before merging, verify:

1. `CLAUDE.md` command reference is updated if any slash commands changed
2. `ARCHITECTURE.md` is updated if data flow or module structure changed
3. All new API endpoints are documented in `ARCHITECTURE.md`

## API

FastAPI starts automatically on `http://localhost:8000`. WebSocket at `/ws` streams all internal events. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event list.

Key endpoints:
- `POST /generate` — send a prompt to Claude (`{"prompt":"...","variation":false}` optional; omit `variation` to keep legacy behavior: vary when `last_prompt` is set)
- `POST /randbeat` — generate a random techno beat (BPM 128-160, CC randomized)
- `POST /bpm`, `POST /swing`, `POST /prob`, `POST /prob-track`, `POST /vel`, `POST /vel-track`
- `POST /random` — randomize velocity or prob for a track
- `POST /cc`, `POST /lfo`, `POST /mute`, `POST /mute-queued`, `POST /velocity`
- `POST /play`, `POST /stop`
- `GET /midi/outputs`, `POST /midi/connect` — hot-plug MIDI output (`{"port": "exact name"}` optional; omit to auto-detect Digitakt)
- `GET/POST /patterns/{name}` — save/load patterns; `DELETE /patterns/{name}` — remove a save
- `POST /note` — per-step MIDI note (`track`, `step`, `value` 0–127 or `null` to inherit `track_pitch`)
- `POST /length` — set pattern step count (8, 16, 32)
- `POST /seq-mode` — set `seq_mode` (`standard` \| `euclidean`) and optional per-track `euclid` `{k,n,r}` in the live pattern
- `POST /euclid-strip-mode` — set `euclid_strip_mode` (`grid` \| `fractional`) on the live pattern (TUI strip layout only; emits `pattern_changed` like other pattern writes)
- `POST /fill/{name}` — queue saved pattern as one-shot fill
- `POST /gate` — set per-step gate (0–100% of step duration before note_off)
- `POST /gate-track` — set gate to the same value on every step for a track
- `POST /pitch` — set per-track MIDI note pitch (0–127)
- `POST /cond` — set conditional trig on a step (1:2 / not:2 / fill / null)
- `GET /traces` — return recent LLM prompt/response traces (observability)

## Environment

| Variable | Default | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | — | yes (or `.env`) |
| `PORT` | `8000` | no |
| `DIGITAKT_URL` | `http://localhost:8000` | no |
| `DIGITAKT_LOG_FILE` | — | no (enables JSON-lines structured log file) |
| `DIGITAKT_TRACE_FILE` | — | no (enables JSON-lines LLM trace file) |
| `DIGITAKT_HOST` | `127.0.0.1` | no (FastAPI bind host; set `0.0.0.0` only when remote access is intentional) |
| `DIGITAKT_ENABLE_TRACES` | `0` | no (set `1` to expose `GET /traces`) |
| `DIGITAKT_ADMIN_TOKEN` | — | no (required `x-digitakt-token` header when set for protected admin endpoints like `/traces`) |
