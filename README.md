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

## Usage

`digitakt` launches a Bun/Ink terminal UI with three panels:

- **Pattern Grid** — 16-step ASCII view for all 8 tracks, live-updating
- **CC Panel** — per-track parameter values (filter, decay, reverb, etc.)
- **Prompt** — type commands or free-text generation prompts at the bottom

### Commands

Type `/help` in the prompt panel for the full reference. All commands are prefixed with `/` or entered as bare text:

| Command | Description |
|---------|-------------|
| `play` / `stop` | Start or stop playback |
| `bpm <n>` | Set tempo (20–400) |
| `swing <n>` | Set swing amount (0–100) |
| `length [8\|16\|32]` | Set pattern step count |
| `prob <track> <step> <value>` | Step probability 0–100 (1-indexed) |
| `vel <track> <step> <value>` | Step velocity 0–127 (1-indexed) |
| `gate <track> <step> <0-100>` | Note gate length (% of step duration) |
| `pitch <track> <0-127>` | MIDI note number for track (chromatic mode) |
| `cond <track> <step> <1:2\|not:2\|fill\|clear>` | Conditional trig on a step |
| `random [track\|all] [vel\|prob] [lo-hi]` | Randomize velocity or probability |
| `randbeat` | Generate a random techno beat |
| `cc <track> <param> <value>` | Send CC to track globally (0–127) |
| `cc-step <track> <param> <step> <v>` | Per-step CC override (-1 to clear) |
| `save <name> [#tag1 #tag2]` | Save pattern with optional tags |
| `load <name>` | Queue a saved pattern for the next loop |
| `patterns [#tag]` | List saved patterns, optionally filtered by tag |
| `fill <name>` | Queue pattern as a one-shot fill (plays once, reverts) |
| `new` | Reset to empty pattern |
| `undo` | Revert to previous pattern |
| `history` | Show pattern history |
| `log` | Toggle activity log |
| `clear` | Clear activity log |
| `mode [chat\|beat]` | Switch input mode |
| `ask <question>` | Ask Claude a question (any mode) |
| `help` | Show command reference |
| `quit` / `q` | Exit |
| *(bare text in BEAT mode)* | Generate a new pattern from your description |
| *(bare text in CHAT mode)* | Ask Claude a question |

**First prompt** generates a fresh pattern. **Subsequent prompts** are treated as variations (prior pattern and prompt are passed as context).

### CC control

Each track maps to its own MIDI channel (kick → ch 1, snare → ch 2, … perc4 → ch 8), matching the Digitakt's physical track layout.

**Tracks:** `kick` `snare` `tom` `clap` `bell` `hihat` `openhat` `cymbal`

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

## Panels

| Panel | Description |
|-------|-------------|
| Pattern Grid | 16-step view for all 8 tracks with mute indicators |
| CC Panel | Per-track parameter values (filter, decay, reverb, etc.) |
| Prompt | Free-text input for generation prompts and commands |

Use **Tab** to cycle between panels.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Cycle panels (Pattern → CC → Prompt) |
| `↑` / `↓` | Navigate tracks (Pattern) or CC params (CC) |
| `Space` | Play / stop |
| `+` / `-` | BPM +1 / -1 |
| `m` | Mute selected track (Pattern panel) |
| `←` / `→` | Adjust CC value ±1 (CC panel) |
| `Ctrl+←` / `Ctrl+→` | Adjust CC value ±10 (CC panel) |
| `Meta+←` / `Meta+→` | Switch CC track (CC panel) |
| `Enter` | Submit prompt or command (Prompt panel) |
| `Ctrl+C` | Quit |

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
