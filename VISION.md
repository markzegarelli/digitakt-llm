# digitakt-llm — Vision & Roadmap

## Vision

A terminal-native, natural language interface for the Elektron Digitakt. Two conversational modes — **Chat** (ask questions, discuss music, ideate) and **Beat** (generate and mutate patterns) — unified in a single prompt panel. Supports any LLM provider (Anthropic, OpenAI, Ollama/local) via environment config. Open source release once feature-complete.

---

## Interface Design

### Chat / Beat Mode Toggle

Two input modes, toggled with **Shift+Tab** or `/mode [chat|beat]`:

```
╭─ BEAT ──────────────────────────────────╮    ╭─ CHAT ──────────────────────────────────╮
│ > make a dark techno pattern            │    │ > what bpm works for schranz?           │
╰──── Shift+Tab to switch mode ───────────╯    ╰──── Shift+Tab to switch mode ───────────╯
```

- **BEAT mode** (default): bare text → `POST /generate` — generates a new drum pattern
- **CHAT mode**: bare text → `POST /ask` — conversational Claude response
- All slash commands work in both modes

### Slash Commands

**Playback & Pattern:**
`/play`, `/stop`, `/bpm`, `/swing`, `/prob`, `/vel`, `/random`, `/randbeat`, `/cc`, `/cc-step`, `/mute`, `/log`, `/save`, `/load`, `/new`, `/undo`, `/history`, `/clear`

**Chat & Generation:**
`/ask`, `/mode`, `/provider` *(CP5)*, `/model` *(CP5)*

**Utility:**
`/help`, `/quit` (`/q`)

Key additions over the original command set:

| Command | Purpose |
|---|---|
| `/new` | Reset to default empty pattern (all zeros, 120bpm, stopped) |
| `/undo` | Revert to previous pattern from history (up to 20 deep) |
| `/history` | Show pattern history list (prompt + timestamp) in dismissible overlay |
| `/clear` | Clear the activity log |
| `/mode [chat\|beat]` | Explicitly set active input mode |
| `/provider [name]` | *(CP5)* Set model provider: `anthropic`, `openai`, `ollama` |
| `/model [name]` | *(CP5)* Set model name |

### Default Template

On launch: all 8 tracks empty (all steps at velocity 0), 120 BPM, playback stopped.

---

## Provider Support (CP5)

Any LLM provider via environment config:

```
MODEL_PROVIDER=anthropic          # anthropic | openai | ollama
MODEL_NAME=claude-opus-4-6
API_KEY=sk-...                    # not required for ollama
OLLAMA_URL=http://localhost:11434  # ollama only, optional
```

Free/local option: [Ollama](https://ollama.com) with `llama3` or `mistral`.

---

## Documentation Workflow

From CP1 onward, every feature branch closes with a doc pass (the `superpowers:finishing-a-development-branch` workflow):
1. Update `CLAUDE.md` command reference if commands changed
2. Update `ARCHITECTURE.md` if data flow or modules changed
3. Confirm all new API endpoints are reflected in `ARCHITECTURE.md`

---

## Milestones

### CP1 — UX Foundation
**Goal:** Polished, intuitive interface. Audit fixes landed. Doc workflow established.

- Chat/Beat mode toggle (Shift+Tab, `/mode`, mode badge in prompt)
- New commands: `/new`, `/undo`, `/history`, `/clear`, `/mode`
- Default empty pattern (all zeros, 120bpm, stopped)
- FastAPI `lifespan` migration (remove deprecated `@app.on_event`)
- Delete dead code: `cli/main.py`, `cli/tui.py`
- Add WebSocket event payload test coverage
- New backend endpoints: `POST /new`, `POST /undo`
- Establish finishing-a-branch doc workflow

---

### CP2 — Music Depth 1
**Goal:** Richer sequencing capabilities.

- Pattern length variants: 8, 16, 32 steps
- Fill generation: 2-bar fills queued at bar boundary
- Named pattern library: save/load with optional tags

---

### CP3 — Music Depth 2
**Goal:** Deeper Digitakt hardware integration.

- Per-step velocity and note length
- Track pitch control
- Conditional trigs (1:2, not:2, fill)
- SysEx investigation

---

### CP4 — Compositional Intelligence
**Goal:** Multi-pattern, arrangement-aware generation.

- Section-aware generation (intro, build, drop, outro)
- Multi-pattern arrangement
- Style/genre presets
- Feedback loop observation (Claude observes what's playing)

---

### CP5 — Provider Layer
**Goal:** Any user can run with their preferred or free model.

- `core/providers/` package: Anthropic, OpenAI, Ollama
- `/provider` and `/model` TUI commands
- Model efficiency audit → `docs/models.md`
- Free/local option: Ollama documented in README

---

### CP6 — Open Source Release
**Goal:** Any developer can clone, configure, and run. Clear contribution path.

- `README.md`: hardware requirements, install, quickstart (< 5 min to first beat)
- `CONTRIBUTING.md`: dev setup, test suite, PR conventions
- License (MIT or Apache 2.0)
- Clean install UX audit
- Final docs pass
- GitHub polish: issue templates, CI badge, release tag

---

## Audit Findings (addressed in CP1)

| Location | Issue | Fix |
|---|---|---|
| `api/server.py:73` | `@app.on_event("startup")` deprecated | Migrate to FastAPI `lifespan` |
| `api/server.py` | Missing `POST /new`, `POST /undo` | Add both |
| `cli/main.py` | Dead code (old Textual TUI) | Delete |
| `cli/tui.py` | Dead code (old Textual TUI) | Delete |
| `core/state.py` | Default pattern has kick/snare/hihat preset | Replace with all-zeros |
| `tests/test_server.py` | No WebSocket event payload tests | Add coverage |
