# digitakt-llm — Agent Landing Page

CLI tool that generates 16-step drum patterns via Claude Opus 4.6 and plays them live on an Elektron Digitakt over USB MIDI. A FastAPI server runs in the background for future web frontend attachment.

## Quick Start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
digitakt-llm          # requires .env with ANTHROPIC_API_KEY
```

## Key Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data flow, EventBus patterns
- [TODO.md](TODO.md) — ideas for future exploration

## Project Layout

```
core/        # all logic — no I/O dependencies
  state.py   # AppState dataclass (single shared instance)
  events.py  # EventBus pub/sub (decouples all modules)
  generator.py  # Anthropic API → JSON pattern → EventBus
  player.py     # background thread, 16th-note timing, atomic swap
  midi_utils.py # port discovery, NOTE_MAP, send_note

api/         # thin FastAPI adapter
  server.py  # REST + WebSocket, init() wires singletons
  schemas.py # Pydantic request/response models

cli/         # thin REPL adapter
  main.py    # wires core, starts API server, runs REPL

tests/       # one test file per module, TDD throughout
```

## Running Tests

```bash
pytest -v
```

74 tests, ~1s. All mocked — no real MIDI or API calls needed.

## API

FastAPI starts automatically on `http://localhost:8000`. WebSocket at `/ws` streams all internal events. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event list.

## Environment

| Variable | Default | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | — | yes (or `.env`) |
| `PORT` | `8000` | no |
