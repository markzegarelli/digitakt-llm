# digitakt-llm

Generate drum patterns on an Elektron Digitakt in real time using Claude Opus 4.6. Describe a vibe in plain English — the pattern plays immediately and loops until you change it.

## Requirements

- Python 3.11+
- An Elektron Digitakt connected via USB
- An Anthropic API key

## Setup

```bash
pip install -e ".[dev]"
export ANTHROPIC_API_KEY=sk-ant-...
digitakt-llm
```

## CLI Usage

```
     1 . . . 2 . . . 3 . . . 4 . . .
kick [X . . . X . . . X . . . X . . .]
snr  [. . . . X . . . . . . . X . . .]
hhat [X . X . X . X . X . X . X . X .]
clap [. . . . . . . . . . . . . . . .]
```

| Command | Description |
|---------|-------------|
| `bpm 140` | Set tempo |
| `stop` | Stop playback |
| `play` | Resume playback |
| `show` | Print ASCII step grid |
| `save <name>` | Save current pattern to `patterns/<name>.json` |
| `load <name>` | Queue a saved pattern for the next loop |
| *(anything else)* | Generate a new pattern or variation from your description |

**First prompt** generates a fresh pattern. **Subsequent prompts** are treated as variations (prior pattern and prompt are passed as context).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `PORT` | `8000` | FastAPI server port |

## API Reference

The FastAPI server starts automatically on `http://localhost:8000`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/state` | Full application state as JSON |
| `POST` | `/generate` | `{"prompt": "..."}` → 202 Accepted |
| `POST` | `/bpm` | `{"bpm": 140.0}` |
| `POST` | `/play` | Start playback |
| `POST` | `/stop` | Stop playback |
| `GET` | `/patterns` | `{"names": [...]}` |
| `POST` | `/patterns/{name}` | Save current pattern |
| `GET` | `/patterns/{name}` | Queue saved pattern |
| `WS` | `/ws` | Event stream (see below) |

## Attaching a Frontend

The WebSocket at `ws://localhost:8000/ws` pushes every internal event as JSON:

```json
{"event": "pattern_changed", "data": {"pattern": {...}, "prompt": "..."}}
{"event": "generation_started", "data": {"prompt": "..."}}
{"event": "generation_complete", "data": {"pattern": {...}, "prompt": "..."}}
{"event": "generation_failed", "data": {"prompt": "...", "error": "..."}}
{"event": "bpm_changed", "data": {"bpm": 140.0}}
{"event": "playback_started", "data": {}}
{"event": "playback_stopped", "data": {}}
{"event": "midi_disconnected", "data": {"port": "..."}}
```

`GET /state` returns the full `AppState` shape. Control playback with the REST endpoints above.
