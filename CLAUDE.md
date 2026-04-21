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
- `/mode [chat|beat]` — switch input mode
- `/ask <question>` — ask Claude (works in any mode)
- `/fresh <prompt>` — generate a new pattern without prior-pattern variation context (same as `POST /generate` with `"variation": false`)
- `/gen` — generate a beat from the last `/ask` response
- `/midi` — connect MIDI output after hot-plug (auto-finds a port whose name contains `Digitakt`); flushes CC and sends MIDI start if playback is already running
- `/midi list` — list MIDI output port names (when auto-detect fails)

Keyboard shortcuts (Pattern panel):
- `?` — open the help overlay (also works from MIX/LOG focus, or from CMD when the input line is empty)
- `m` — immediate mute toggle on selected track
- `q` — stage selected track for queued mute (toggle; **MQ** badges on SEQ/MIX: `Q` = queued, `M` = muted)
- `Q` (Shift+Q) — fire all staged mutes at next bar boundary via `/mute-queued`
- `c` — when a chain is set, focus the **chain strip** (under the status bar); `←`/`→` move a highlight across slots; `Esc` returns focus to SEQ; `c` again exits strip focus
- `n` — queue next chain candidate (same as `/chain next`; also works while the chain strip is focused)
- `N` (Shift+N) — arm queued chain change for next downbeat (same as `/chain fire`; also works while the chain strip is focused)
- `Enter` (SEQ focused) — enter/exit SEQ step edit mode on the selected track
- `Space` (in SEQ step edit) — toggle selected step on/off (uses per-track default velocity when enabling)
- `Tab` (in SEQ step edit) — switch keyboard focus between the **step column** and **TRIG fields** (TRIG panel stays visible)
- `[` / `]` (SEQ step edit) — move selected step left/right (with or without TRIG open)
- `↑/↓` (TRIG panel) — move between trig fields (probability, velocity, note, length, condition)
- `←/→` (TRIG panel) — adjust selected value by ±1 (`Shift+←/→` = ±10 for numeric fields). **Note** row: per-step MIDI note only (does not change track-wide `/pitch`); other tracks’ steps are unchanged.
- **`t`** (SEQ step edit) — toggle TRIG **keyboard** focus on/off (panel remains visible)
- **`Shift+t`** (SEQ focused, **not** in step edit) — enter step edit, open TRIG, and turn **ALL** (track-wide) on; selected step follows the **playhead** when playing, otherwise step 1
- **`Shift+t`** (SEQ step edit, TRIG open, not on condition row) — toggle **track-wide** (ALL) for probability, velocity, and gate; with TRIG **closed** in step edit, **`Shift+t`** opens TRIG **and** turns track-wide on. Note/pitch stays per-track; condition stays per-step only
- `[` / `]` (TRIG panel) — move selected step left/right while keeping TRIG panel open
- `0-9` then `Enter` (TRIG panel) — type and apply numeric value directly
- `Esc` (TRIG keys active) — return to step-column keys (TRIG panel stays visible)

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
- `POST /cc`, `POST /mute`, `POST /mute-queued`, `POST /velocity`
- `POST /play`, `POST /stop`
- `GET /midi/outputs`, `POST /midi/connect` — hot-plug MIDI output (`{"port": "exact name"}` optional; omit to auto-detect Digitakt)
- `GET/POST /patterns/{name}` — save/load patterns; `DELETE /patterns/{name}` — remove a save
- `POST /note` — per-step MIDI note (`track`, `step`, `value` 0–127 or `null` to inherit `track_pitch`)
- `POST /length` — set pattern step count (8, 16, 32)
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
