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
| `cc <track> <param> <value>` | Send a CC message to a track (value 0–127) |
| `cc show` | Print the current CC state for all tracks |
| *(anything else)* | Generate a new pattern or variation from your description |

**First prompt** generates a fresh pattern. **Subsequent prompts** are treated as variations (prior pattern and prompt are passed as context).

### CC control

Each track maps to its own MIDI channel (kick → ch 1, snare → ch 2, … perc4 → ch 8), matching the Digitakt's physical track layout.

**Tracks:** `kick` `snare` `hihat` `clap` `perc1` `perc2` `perc3` `perc4`

**Params:**

| Param | CC# | Default | Description |
|-------|-----|---------|-------------|
| `tune` | 16 | 64 | Sample pitch |
| `filter` | 74 | 64 | Filter cutoff |
| `resonance` | 71 | 64 | Filter resonance |
| `attack` | 80 | 64 | Amp attack |
| `decay` | 82 | 64 | Amp decay |
| `volume` | 95 | 100 | Track volume |
| `reverb` | 91 | 0 | Reverb send |
| `delay` | 30 | 0 | Delay send |

```
> cc kick filter 90
CC set: kick filter = 90

> cc show
        tune  filter  res  atk  dec  vol  rev  dly
kick      64      90   64   64   64  100    0    0
snare     64      64   64   64   64  100    0    0
...
```

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
| `POST` | `/cc` | `{"track": "kick", "param": "filter", "value": 90}` |
| `GET` | `/cc` | Current CC state for all tracks |
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
{"event": "cc_changed", "data": {"track": "kick", "param": "filter", "value": 90}}
```

`GET /state` returns the full `AppState` shape. Control playback with the REST endpoints above.
