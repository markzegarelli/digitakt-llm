# digitakt-llm — Agent Landing Page

CLI tool that generates 16-step drum patterns via Claude Opus 4.6 and plays them live on an Elektron Digitakt over USB MIDI. A FastAPI server runs in the background; the UI is a Bun/Ink (TypeScript/React) terminal app that connects to it.

## Quick Start

```bash
# Python backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Bun/Ink frontend
cd tui && bun install

# Launch everything
digitakt          # requires .env with ANTHROPIC_API_KEY
```

## The UI

**There is one UI: the Bun/Ink terminal app in `tui/`.** It is launched via the `digitakt` entry point, which starts the Python FastAPI backend and then runs `bun run src/index.tsx` in the `tui/` directory.

- Entry point: `digitakt` → `cli.tui_launcher:main`
- The launcher starts FastAPI on `http://localhost:8000`, then spawns the Bun process
- The Bun TUI connects via REST + WebSocket at that URL
- Type `/help` in the prompt panel for a full command reference
- `/bpm <n>` — set tempo (20–400)
- `/swing <n>` — set swing amount (0–100)
- `/length [8|16|32]` — set pattern step count
- `/prob <track> <step> <value>` — step probability 0–100
- `/vel <track> <step> <value>` — step velocity 0–127
- `/gate <track> <step> <0-100>` — set note gate length (% of step duration before note_off)
- `/pitch <track> <0-127>` — set MIDI note number for track (chromatic mode)
- `/cond <track> <step> <1:2|not:2|fill|clear>` — set/clear conditional trig on a step
- `/random [track|all] [vel|prob] [lo-hi]` — randomize velocity or probability
- `/randbeat` — generate a random techno beat
- `/cc <track> <param> <value>` — global CC control (0–127)
- `/cc-step <track> <param> <step> <v>` — per-step CC override (-1 to clear)
- `/save <name> [#tag1 #tag2]` — save pattern with optional tags
- `/load <name>` — queue a saved pattern for the next loop
- `/fill <name>` — queue saved pattern as one-shot fill (plays once, reverts)
- `/patterns [#tag]` — list saved patterns, optionally filtered by tag
- `/new` — reset to empty pattern
- `/undo` — revert to previous pattern
- `/history` — show pattern history
- `/log` — toggle activity log
- `/clear` — clear activity log
- `/mode [chat|beat]` — switch input mode
- `/ask <question>` — ask Claude (works in any mode)
- `/gen` — generate a beat from the last `/ask` response

> **Note:** `cli/main.py` and `cli/tui.py` are a deprecated Textual-based TUI. They are no longer the entry point. Do not use or modify them.

## Key Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data flow, EventBus patterns
- [TODO.md](TODO.md) — ideas for future exploration

## Project Layout

```
core/        # all logic — no I/O dependencies
  state.py      # AppState dataclass (single shared instance)
  events.py     # EventBus pub/sub (decouples all modules)
  generator.py  # Anthropic API → JSON pattern → EventBus
  player.py     # background thread, MIDI clock, prob/swing, atomic swap
  midi_utils.py # port discovery, NOTE_MAP, send_note

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
pytest -v
```

~166 tests, ~10s. All mocked — no real MIDI or API calls needed.

## Development Workflow

When closing a feature branch, invoke the `superpowers:finishing-a-development-branch` skill. Before merging, verify:

1. `CLAUDE.md` command reference is updated if any slash commands changed
2. `ARCHITECTURE.md` is updated if data flow or module structure changed
3. All new API endpoints are documented in `ARCHITECTURE.md`
4. `VISION.md` milestone status is current

## API

FastAPI starts automatically on `http://localhost:8000`. WebSocket at `/ws` streams all internal events. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event list.

Key endpoints:
- `POST /generate` — send a prompt to Claude
- `POST /randbeat` — generate a random techno beat (BPM 128-160, CC randomized)
- `POST /bpm`, `POST /swing`, `POST /prob`, `POST /vel`
- `POST /random` — randomize velocity or prob for a track
- `POST /cc`, `POST /mute`, `POST /velocity`
- `POST /play`, `POST /stop`
- `GET/POST /patterns/{name}` — save/load patterns
- `POST /length` — set pattern step count (8, 16, 32)
- `POST /fill/{name}` — queue saved pattern as one-shot fill
- `POST /gate` — set per-step gate (0–100% of step duration before note_off)
- `POST /pitch` — set per-track MIDI note pitch (0–127)
- `POST /cond` — set conditional trig on a step (1:2 / not:2 / fill / null)

## Environment

| Variable | Default | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | — | yes (or `.env`) |
| `PORT` | `8000` | no |
| `DIGITAKT_URL` | `http://localhost:8000` | no |
