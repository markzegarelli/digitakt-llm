# digitakt-llm v1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.0.0 — a terminal instrument you can play a 45-minute hybrid techno set with — via three independently shippable milestones: chain engine, instrument panel, and Claude feedback loop.

**Architecture:** Python FastAPI backend (EventBus pub/sub, AppState singleton, Player thread, Generator thread) with a Bun/Ink TypeScript TUI connected via REST + WebSocket. New features extend state, endpoints, and components without breaking existing patterns.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, Bun, Ink 5.x, React, TypeScript, chalk (via Ink's `color` prop), python-rtmidi, Anthropic SDK.

**Spec:** `docs/specs/2026-04-12-v1-design.md`

---

## File Map

### v0.2 — Chain Engine
| Action | File | Purpose |
|---|---|---|
| Modify | `core/state.py` | Add `chain`, `chain_index`, `chain_auto` fields + 4 chain methods |
| Modify | `api/schemas.py` | Add `ChainRequest`, `ChainStatusResponse` |
| Modify | `api/server.py` | Add `/chain` endpoints + bar-boundary auto-advance subscriber |
| Modify | `core/player.py` | Emit `bar_boundary` event after each `apply_bar_boundary()` call |
| Modify | `tui/src/types.ts` | Add chain fields to `DigitaktState` |
| Modify | `tui/src/hooks/useDigitakt.ts` | Add chain actions + WS event handlers |
| Modify | `tui/src/App.tsx` | Add `/chain`, `/chain-next`, `/chain-status`, `/chain-clear` commands |
| Create | `tests/test_chain.py` | Unit tests for chain state methods |
| Create | `tests/test_server_chain.py` | Integration tests for chain endpoints |

### v0.3 — Instrument Panel
| Action | File | Purpose |
|---|---|---|
| Modify | `core/generator.py` | Add `generation_summary` to `generation_complete` event payload |
| Modify | `tui/src/types.ts` | Add `generation_summary` field to `DigitaktState` |
| Modify | `tui/src/hooks/useDigitakt.ts` | Handle `step_changed`, `chain_updated`, `chain_advanced`, `generation_complete` with summary |
| Create | `tui/src/components/StatusBar.tsx` | Persistent top bar: BPM, MIDI dot, Claude dot, pattern name, bar count |
| Create | `tui/src/components/ChainPanel.tsx` | Setlist display with current position; hidden when no chain |
| Create | `tui/src/components/StepGrid.tsx` | Per-track colored step grid with playhead; replaces PatternGrid rendering |
| Create | `tui/src/components/GenerationSummary.tsx` | Last prompt + result stats in one compact line |
| Modify | `tui/src/App.tsx` | Swap Header→StatusBar, PatternGrid→StepGrid; add ChainPanel, GenerationSummary |

### v0.4 — Feedback Loop
| Action | File | Purpose |
|---|---|---|
| Modify | `core/generator.py` | Add `build_context_prompt()`, `generate_next()`, `generate_vary()`, `ask_read()`; add `context_prefix` to `generate()` |
| Modify | `api/schemas.py` | Add `NextRequest`, `VaryRequest`, `ReadResponse` |
| Modify | `api/server.py` | Add `POST /next`, `POST /vary`, `POST /read` endpoints |
| Modify | `tui/src/App.tsx` | Add `/next`, `/vary`, `/read` command dispatch |
| Create | `tests/test_feedback.py` | Unit + integration tests for feedback loop |

---

## ── v0.2: Chain Engine ──

### Task 1: Chain state methods in AppState

**Files:**
- Modify: `core/state.py`
- Create: `tests/test_chain.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_chain.py`:

```python
# tests/test_chain.py
import pytest
from core.state import AppState


def test_set_chain_stores_names():
    state = AppState()
    state.set_chain(["intro", "drop", "break"])
    assert state.chain == ["intro", "drop", "break"]
    assert state.chain_index == -1
    assert state.chain_auto is False


def test_set_chain_auto_flag():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    assert state.chain_auto is True


def test_set_chain_empty_list():
    state = AppState()
    state.set_chain([])
    assert state.chain == []
    assert state.chain_index == -1


def test_chain_next_from_unstarted():
    state = AppState()
    state.set_chain(["intro", "drop", "break"])
    result = state.chain_next()
    assert result == "intro"
    assert state.chain_index == 0


def test_chain_next_advances():
    state = AppState()
    state.set_chain(["intro", "drop", "break"])
    state.chain_next()          # intro (index 0)
    result = state.chain_next() # drop  (index 1)
    assert result == "drop"
    assert state.chain_index == 1


def test_chain_next_returns_none_at_end_non_auto():
    state = AppState()
    state.set_chain(["intro", "drop"])
    state.chain_next()  # intro
    state.chain_next()  # drop
    result = state.chain_next()  # end, non-auto
    assert result is None
    assert state.chain_index == 1  # stays at last


def test_chain_next_loops_when_auto():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    state.chain_next()          # intro (0)
    state.chain_next()          # drop (1)
    result = state.chain_next() # intro again (0)
    assert result == "intro"
    assert state.chain_index == 0


def test_chain_next_empty_returns_none():
    state = AppState()
    result = state.chain_next()
    assert result is None


def test_chain_clear_resets_all():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    state.chain_next()
    state.chain_clear()
    assert state.chain == []
    assert state.chain_index == -1
    assert state.chain_auto is False


def test_chain_current_before_start():
    state = AppState()
    state.set_chain(["intro", "drop"])
    assert state.chain_current() is None


def test_chain_current_after_next():
    state = AppState()
    state.set_chain(["intro", "drop"])
    state.chain_next()
    assert state.chain_current() == "intro"


def test_chain_current_empty():
    state = AppState()
    assert state.chain_current() is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_chain.py -v
```
Expected: `AttributeError: 'AppState' object has no attribute 'chain'` for all tests.

- [ ] **Step 3: Add chain fields and methods to AppState**

In `core/state.py`, inside the `AppState` dataclass, add three fields after `pending_mutes`:

```python
    chain: list[str] = field(default_factory=list)
    chain_index: int = -1
    chain_auto: bool = False
```

Then add four methods after `queue_pattern`:

```python
    def set_chain(self, names: list[str], auto: bool = False) -> None:
        """Define an ordered setlist. chain_index=-1 means chain defined but not started."""
        with self._lock:
            self.chain = list(names)
            self.chain_index = -1
            self.chain_auto = auto

    def chain_next(self) -> str | None:
        """Advance chain and return the next pattern name, or None if at end (non-auto)."""
        with self._lock:
            if not self.chain:
                return None
            next_index = self.chain_index + 1
            if next_index >= len(self.chain):
                if self.chain_auto:
                    next_index = 0
                else:
                    return None
            self.chain_index = next_index
            return self.chain[self.chain_index]

    def chain_clear(self) -> None:
        """Exit chain mode and reset all chain state."""
        with self._lock:
            self.chain = []
            self.chain_index = -1
            self.chain_auto = False

    def chain_current(self) -> str | None:
        """Return current pattern name in chain, or None if not started."""
        with self._lock:
            if not self.chain or self.chain_index < 0:
                return None
            return self.chain[self.chain_index]
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pytest tests/test_chain.py -v
```
Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/state.py tests/test_chain.py
git commit -m "feat(chain): add chain state fields and methods to AppState"
```

---

### Task 2: Chain schemas

**Files:**
- Modify: `api/schemas.py`

- [ ] **Step 1: Add schemas**

In `api/schemas.py`, append at the end of the file:

```python
class ChainRequest(BaseModel):
    names: list[str]
    auto: bool = False


class ChainStatusResponse(BaseModel):
    chain: list[str]
    chain_index: int
    chain_auto: bool
    current: str | None
```

- [ ] **Step 2: Verify no import errors**

```bash
python -c "from api.schemas import ChainRequest, ChainStatusResponse; print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add api/schemas.py
git commit -m "feat(chain): add ChainRequest and ChainStatusResponse schemas"
```

---

### Task 3: Chain endpoints in server.py

**Files:**
- Modify: `api/server.py`
- Create: `tests/test_server_chain.py`

- [ ] **Step 1: Write failing endpoint tests**

Create `tests/test_server_chain.py`:

```python
# tests/test_server_chain.py
import json
from pathlib import Path
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
import api.server as server_module


def _make_client(tmp_path: Path) -> TestClient:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    player = Player(state, bus, MagicMock())
    gen = Generator(state, bus)
    gen._client = MagicMock()
    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


def _save_pattern(tmp_path: Path, name: str) -> None:
    """Helper: write a minimal saved pattern file."""
    pattern = {t: [0] * 16 for t in TRACK_NAMES}
    data = {"pattern": pattern, "tags": [], "saved_at": "2026-01-01T00:00:00"}
    (tmp_path / f"{name}.json").write_text(json.dumps(data))


def test_post_chain_sets_chain(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    resp = client.post("/chain", json={"names": ["intro", "drop"], "auto": False})
    assert resp.status_code == 200
    assert server_module._state.chain == ["intro", "drop"]
    assert server_module._state.chain_auto is False


def test_post_chain_auto_flag(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    resp = client.post("/chain", json={"names": ["intro"], "auto": True})
    assert resp.status_code == 200
    assert server_module._state.chain_auto is True


def test_post_chain_rejects_unknown_pattern(tmp_path):
    client = _make_client(tmp_path)
    resp = client.post("/chain", json={"names": ["does-not-exist"], "auto": False})
    assert resp.status_code == 422
    assert "does-not-exist" in resp.json()["detail"]


def test_post_chain_next_loads_first_pattern(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    client.post("/chain", json={"names": ["intro", "drop"]})
    resp = client.post("/chain/next")
    assert resp.status_code == 200
    assert resp.json()["current"] == "intro"
    assert server_module._state.pending_pattern is not None


def test_post_chain_next_advances_index(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    client.post("/chain", json={"names": ["intro", "drop"]})
    client.post("/chain/next")  # intro
    resp = client.post("/chain/next")  # drop
    assert resp.status_code == 200
    assert resp.json()["current"] == "drop"


def test_post_chain_next_returns_409_at_end(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    client.post("/chain", json={"names": ["intro"]})
    client.post("/chain/next")  # intro
    resp = client.post("/chain/next")  # end
    assert resp.status_code == 409


def test_delete_chain_clears_state(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    client.post("/chain", json={"names": ["intro"]})
    resp = client.delete("/chain")
    assert resp.status_code == 200
    assert server_module._state.chain == []
    assert server_module._state.chain_index == -1


def test_get_chain_returns_status(tmp_path):
    client = _make_client(tmp_path)
    _save_pattern(tmp_path, "intro")
    _save_pattern(tmp_path, "drop")
    client.post("/chain", json={"names": ["intro", "drop"]})
    resp = client.get("/chain")
    assert resp.status_code == 200
    data = resp.json()
    assert data["chain"] == ["intro", "drop"]
    assert data["chain_index"] == -1
    assert data["current"] is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_server_chain.py -v
```
Expected: `404 Not Found` for all `/chain` routes.

- [ ] **Step 3: Add chain endpoints to server.py**

In `api/server.py`:

**a)** Add to the imports from `api.schemas`:
```python
from api.schemas import (
    ...
    ChainRequest, ChainStatusResponse,
)
```

**b)** Add `"chain_updated"` and `"chain_advanced"` to `_ALL_EVENTS`:
```python
_ALL_EVENTS = [
    ...,
    "chain_updated", "chain_advanced",
]
```

**c)** Add `_on_bar_boundary` function (add before the endpoint definitions):
```python
def _on_bar_boundary(payload: dict) -> None:
    """Auto-advance chain when chain_auto is True, triggered at each bar end."""
    if not _state or not _state.chain_auto or not _state.chain:
        return
    next_name = _state.chain_next()
    if next_name is None:
        return
    pattern_file = Path(_patterns_dir) / f"{next_name}.json"
    if not pattern_file.exists():
        return
    with open(pattern_file) as f:
        data = json.load(f)
    pattern = data.get("pattern", data)
    _state.queue_pattern(pattern)
    _broadcast_event("chain_advanced", {
        "chain": list(_state.chain),
        "chain_index": _state.chain_index,
        "current": next_name,
    })
```

**d)** In `lifespan`, add after the existing event subscriptions:
```python
    if _bus is not None:
        for event_name in _ALL_EVENTS:
            _bus.subscribe(
                event_name,
                lambda p, name=event_name: _broadcast_event(name, p),
            )
        _bus.subscribe("bar_boundary", _on_bar_boundary)  # internal only, not broadcast
```

**e)** Add the four chain endpoints (append near other pattern-related endpoints):
```python
@app.post("/chain")
def post_chain(req: ChainRequest):
    patterns_path = Path(_patterns_dir)
    for name in req.names:
        if not (patterns_path / f"{name}.json").exists():
            raise HTTPException(status_code=422, detail=f"Pattern not found: {name}")
    _state.set_chain(req.names, auto=req.auto)
    _bus.emit("chain_updated", {
        "chain": list(_state.chain),
        "chain_index": _state.chain_index,
        "chain_auto": _state.chain_auto,
        "current": _state.chain_current(),
    })
    return {"chain": list(_state.chain), "chain_index": _state.chain_index}


@app.post("/chain/next")
def post_chain_next():
    next_name = _state.chain_next()
    if next_name is None:
        raise HTTPException(status_code=409, detail="No next pattern in chain")
    pattern_file = Path(_patterns_dir) / f"{next_name}.json"
    with open(pattern_file) as f:
        data = json.load(f)
    pattern = data.get("pattern", data)
    _state.queue_pattern(pattern)
    _bus.emit("chain_advanced", {
        "chain": list(_state.chain),
        "chain_index": _state.chain_index,
        "current": next_name,
    })
    return {"current": next_name, "chain_index": _state.chain_index}


@app.delete("/chain")
def delete_chain():
    _state.chain_clear()
    _bus.emit("chain_updated", {
        "chain": [],
        "chain_index": -1,
        "chain_auto": False,
        "current": None,
    })
    return {"status": "cleared"}


@app.get("/chain", response_model=ChainStatusResponse)
def get_chain():
    return ChainStatusResponse(
        chain=list(_state.chain),
        chain_index=_state.chain_index,
        chain_auto=_state.chain_auto,
        current=_state.chain_current(),
    )
```

- [ ] **Step 4: Run chain endpoint tests**

```bash
pytest tests/test_server_chain.py -v
```
Expected: all 9 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/schemas.py api/server.py tests/test_server_chain.py
git commit -m "feat(chain): add /chain endpoints and auto-advance bar-boundary subscriber"
```

---

### Task 4: Bar-boundary event in player.py

**Files:**
- Modify: `core/player.py`

- [ ] **Step 1: Find the `apply_bar_boundary` call in `_loop`**

Open `core/player.py` and search for `apply_bar_boundary`. It is called inside `_loop`. The surrounding code looks like:

```python
results = self.state.apply_bar_boundary()
```

- [ ] **Step 2: Add `bar_boundary` event emission**

Immediately after the `apply_bar_boundary()` call, add:

```python
results = self.state.apply_bar_boundary()
self.bus.emit("bar_boundary", results)   # ← ADD THIS LINE
```

- [ ] **Step 3: Handle fill events from the results dict**

The existing code after `apply_bar_boundary` probably checks `results["fill_event"]` and `results["pattern_changed"]`. Verify those checks are still intact — the new `bus.emit` line should not interfere.

- [ ] **Step 4: Run existing player tests**

```bash
pytest tests/test_player.py -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/player.py
git commit -m "feat(chain): emit bar_boundary event from player for auto-advance"
```

---

### Task 5: Chain types and state in the TUI

**Files:**
- Modify: `tui/src/types.ts`
- Modify: `tui/src/hooks/useDigitakt.ts`

- [ ] **Step 1: Add chain fields to DigitaktState**

In `tui/src/types.ts`, add these three fields to the `DigitaktState` interface (after `pattern_history`):

```typescript
  chain: string[];
  chain_index: number;
  chain_auto: boolean;
```

- [ ] **Step 2: Add chain defaults to DEFAULT_STATE**

In `tui/src/hooks/useDigitakt.ts`, in the `DEFAULT_STATE` object, add (after `pattern_history: []`):

```typescript
  chain: [],
  chain_index: -1,
  chain_auto: false,
```

- [ ] **Step 3: Handle chain WS events**

In `useDigitakt.ts`, find the WebSocket message handler (`switch (event)` or `if (event === ...)` block). Add cases for the two new events:

```typescript
case "chain_updated":
  setState(prev => ({
    ...prev,
    chain: data.chain ?? [],
    chain_index: data.chain_index ?? -1,
    chain_auto: data.chain_auto ?? false,
  }));
  break;

case "chain_advanced":
  setState(prev => ({
    ...prev,
    chain: data.chain ?? prev.chain,
    chain_index: data.chain_index ?? prev.chain_index,
  }));
  break;
```

Also ensure `step_changed` updates `current_step` (add if missing):

```typescript
case "step_changed":
  setState(prev => ({ ...prev, current_step: data.step ?? null }));
  break;
```

- [ ] **Step 4: Add chain actions to DigitaktActions and useDigitakt**

In the `DigitaktActions` interface (in `useDigitakt.ts`), add:

```typescript
  setChain(names: string[], auto?: boolean): Promise<void>;
  chainNext(): Promise<void>;
  chainClear(): Promise<void>;
```

In the `actions` object returned by `useDigitakt`, add:

```typescript
async setChain(names: string[], auto: boolean = false): Promise<void> {
  await fetch(`${baseUrl}/chain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names, auto }),
  });
},
async chainNext(): Promise<void> {
  await fetch(`${baseUrl}/chain/next`, { method: "POST" });
},
async chainClear(): Promise<void> {
  await fetch(`${baseUrl}/chain`, { method: "DELETE" });
},
```

- [ ] **Step 5: Build TUI to confirm no TypeScript errors**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no errors. (Warnings about unused vars in existing code are OK.)

- [ ] **Step 6: Commit**

```bash
git add tui/src/types.ts tui/src/hooks/useDigitakt.ts
git commit -m "feat(chain): add chain state and actions to TUI hooks"
```

---

### Task 6: Chain commands in App.tsx

**Files:**
- Modify: `tui/src/App.tsx`

- [ ] **Step 1: Add chain command handling to `handleCommand`**

In `tui/src/App.tsx`, inside `handleCommand`, find the `switch (verb)` block. Add these cases (after the existing cases, before the default fallthrough):

```typescript
case "chain": {
  const autoFlag = parts.includes("--auto");
  const names = parts.slice(1).filter((p) => p !== "--auto");
  if (names.length === 0) {
    actions.addLog("usage: /chain <p1> <p2> ... [--auto]  — define a setlist");
    return;
  }
  try {
    await actions.setChain(names, autoFlag);
    actions.addLog(
      `chain set: ${names.join(" → ")}${autoFlag ? "  (auto)" : ""}`
    );
  } catch {
    actions.addLog("chain: one or more patterns not found in library");
  }
  return;
}

case "chain-next":
  try {
    await actions.chainNext();
    actions.addLog("chain: queuing next pattern at bar boundary");
  } catch {
    actions.addLog("chain: end of chain (use --auto to loop)");
  }
  return;

case "chain-status": {
  const { chain, chain_index, chain_auto } = state;
  if (chain.length === 0) {
    actions.addLog("no chain defined — use /chain <p1> <p2> ...");
  } else {
    const pos = chain_index < 0 ? "unstarted" : `${chain_index + 1}/${chain.length}`;
    actions.addLog(
      `chain [${pos}]: ${chain.join(" → ")}${chain_auto ? "  (auto)" : ""}`
    );
  }
  return;
}

case "chain-clear":
  await actions.chainClear();
  actions.addLog("chain cleared");
  return;
```

- [ ] **Step 2: Add chain commands to `/help` text**

Find the help text string in `App.tsx` (the multiline string shown when `showHelp` is true). Add:

```
/chain <p1> <p2> ... [--auto]  — define a setlist; /chain-next to step through
/chain-next                    — queue next pattern in chain at bar boundary
/chain-status                  — show current chain position
/chain-clear                   — exit chain mode
```

- [ ] **Step 3: Build TUI**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no TypeScript errors.

- [ ] **Step 4: Smoke test manually (optional but recommended)**

```bash
digitakt &
# In the TUI:
# /save intro
# /save drop
# /chain intro drop
# /chain-status   → should show: chain [unstarted]: intro → drop
# /chain-next     → should log: chain: queuing next pattern at bar boundary
# /chain-status   → should show: chain [1/2]: intro → drop
```

- [ ] **Step 5: Commit**

```bash
git add tui/src/App.tsx
git commit -m "feat(chain): add /chain, /chain-next, /chain-status, /chain-clear TUI commands"
```

---

## ── v0.3: Instrument Panel ──

### Task 7: Generation summary in generator.py

**Files:**
- Modify: `core/generator.py`

- [ ] **Step 1: Add `_compute_generation_summary` helper**

In `core/generator.py`, add this function near the top (after imports, before the class):

```python
def _compute_generation_summary(
    prompt: str,
    pattern: dict,
    latency_ms: int,
) -> dict:
    """Return a compact summary of a generation result for TUI display."""
    abbreviations = {
        "kick": "BD", "snare": "SD", "tom": "LT", "clap": "CL",
        "bell": "BL", "hihat": "CH", "openhat": "OH", "cymbal": "CY",
    }
    from core.state import TRACK_NAMES
    parts = []
    for track in TRACK_NAMES:
        steps = pattern.get(track, [])
        active = sum(1 for v in steps if v > 0)
        if active > 0:
            abbr = abbreviations.get(track, track[:2].upper())
            parts.append(f"{abbr}×{active}")
    track_summary = "  ".join(parts) if parts else "empty"
    return {
        "prompt": prompt,
        "track_summary": track_summary,
        "latency_ms": latency_ms,
    }
```

- [ ] **Step 2: Record generation latency and include summary in `generation_complete`**

In `core/generator.py`, find the method that calls the Anthropic API (likely `_do_generate` or similar). It will have a structure like:

```python
self.bus.emit("generation_started", {"prompt": prompt})
# ... API call ...
self.bus.emit("generation_complete", {"prompt": prompt, "pattern": pattern, ...})
```

**a)** Add a start-time capture immediately before the API call:

```python
import time
_t0 = time.monotonic()
```

**b)** After parsing the pattern JSON and before emitting `generation_complete`, compute the summary:

```python
_latency_ms = int((time.monotonic() - _t0) * 1000)
_summary = _compute_generation_summary(prompt, pattern, _latency_ms)
```

**c)** Add `"summary": _summary` to the `generation_complete` payload:

```python
self.bus.emit("generation_complete", {
    "prompt": prompt,
    "pattern": pattern,
    "summary": _summary,
    # ... existing fields unchanged ...
})
```

- [ ] **Step 3: Run generator tests**

```bash
pytest tests/test_generator.py -v
```
Expected: all tests PASS. (Generator tests mock the client, so latency will be ~0ms.)

- [ ] **Step 4: Commit**

```bash
git add core/generator.py
git commit -m "feat(ui): add generation_summary to generation_complete event payload"
```

---

### Task 8: TUI state for generation summary

**Files:**
- Modify: `tui/src/types.ts`
- Modify: `tui/src/hooks/useDigitakt.ts`

- [ ] **Step 1: Add `generation_summary` to DigitaktState**

In `tui/src/types.ts`, add to the `DigitaktState` interface (after `chain_auto`):

```typescript
  generation_summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
  } | null;
```

- [ ] **Step 2: Add default for generation_summary**

In `tui/src/hooks/useDigitakt.ts`, in `DEFAULT_STATE`, add (after `chain_auto: false`):

```typescript
  generation_summary: null,
```

- [ ] **Step 3: Update `generation_complete` WS handler to extract summary**

Find the existing `generation_complete` case in the WS message handler. Update it to also set `generation_summary`:

```typescript
case "generation_complete":
  setState(prev => ({
    ...prev,
    generation_status: "idle",
    generation_error: null,
    generation_summary: data.summary ?? null,
  }));
  break;
```

- [ ] **Step 4: Build TUI**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add tui/src/types.ts tui/src/hooks/useDigitakt.ts
git commit -m "feat(ui): add generation_summary state to TUI"
```

---

### Task 9: StatusBar component

**Files:**
- Create: `tui/src/components/StatusBar.tsx`

- [ ] **Step 1: Create StatusBar**

Create `tui/src/components/StatusBar.tsx`:

```tsx
import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiConnected: boolean;
  generationStatus: "idle" | "generating" | "failed";
  patternName: string | null;
  patternLength: number;
  barCount: number;
}

const SPINNER = ["○", "◌", "◎", "●"] as const;

export function StatusBar({
  bpm,
  swing,
  isPlaying,
  midiConnected,
  generationStatus,
  patternName,
  patternLength,
  barCount,
}: StatusBarProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (generationStatus !== "generating") return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 200);
    return () => clearInterval(id);
  }, [generationStatus]);

  const playIcon = isPlaying ? "▶" : "■";
  const playColor = isPlaying ? "#FF6B00" : "#444444";

  const midiColor = midiConnected ? "#00FF88" : "#FF3366";
  const claudeColor =
    generationStatus === "generating"
      ? "#FFD700"
      : generationStatus === "failed"
      ? "#FF3366"
      : "#555555";
  const claudeIcon =
    generationStatus === "generating"
      ? SPINNER[frame]!
      : generationStatus === "failed"
      ? "✕"
      : "○";

  const nameDisplay = patternName
    ? `[${patternName.toUpperCase()}]`
    : "[NEW]";

  return (
    <Box borderStyle="double" borderColor="#333333" paddingX={1} flexShrink={0}>
      <Text color={playColor} bold>
        {playIcon}{" "}
      </Text>
      <Text color="#E8E8E8" bold>
        {Math.round(bpm)} BPM
      </Text>
      <Text color="#333333">  │  </Text>
      <Text color="#555555">SW:</Text>
      <Text color={swing > 0 ? "#E8E8E8" : "#444444"}>{swing}</Text>
      <Text color="#333333">  │  </Text>
      <Text color={midiColor}>●</Text>
      <Text color="#555555">MIDI  </Text>
      <Text color={claudeColor}>{claudeIcon}</Text>
      <Text color="#555555">Claude</Text>
      <Text color="#333333">  ═══  </Text>
      <Text color="#FF6B00" bold>
        {nameDisplay}
      </Text>
      <Text color="#333333">  </Text>
      <Text color="#444444">{patternLength}steps</Text>
      <Text color="#333333">  ·  </Text>
      <Text color="#444444">bar:{barCount}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Build to confirm no errors**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tui/src/components/StatusBar.tsx
git commit -m "feat(ui): add StatusBar component (Elektron-noir aesthetic)"
```

---

### Task 10: ChainPanel component

**Files:**
- Create: `tui/src/components/ChainPanel.tsx`

- [ ] **Step 1: Create ChainPanel**

Create `tui/src/components/ChainPanel.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";

interface ChainPanelProps {
  chain: string[];
  chainIndex: number;
  chainAuto: boolean;
}

export function ChainPanel({ chain, chainIndex, chainAuto }: ChainPanelProps) {
  if (chain.length === 0) return null;

  return (
    <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
      <Text color="#444444">CHAIN  </Text>
      {chain.map((name, i) => {
        const isCurrent = i === chainIndex;
        const isNext =
          i === chainIndex + 1 ||
          (chainAuto && chainIndex === chain.length - 1 && i === 0);

        return (
          <React.Fragment key={i}>
            {i > 0 && <Text color="#333333"> ──→ </Text>}
            <Text
              color={
                isCurrent ? "#FF6B00" : isNext ? "#FFD700" : "#444444"
              }
              bold={isCurrent}
            >
              {isCurrent ? `[${name.toUpperCase()}]` : name}
            </Text>
          </React.Fragment>
        );
      })}
      {chainAuto && <Text color="#555555">  ↺</Text>}
    </Box>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tui/src/components/ChainPanel.tsx
git commit -m "feat(ui): add ChainPanel component"
```

---

### Task 11: StepGrid component

**Files:**
- Create: `tui/src/components/StepGrid.tsx`

- [ ] **Step 1: Create StepGrid**

Create `tui/src/components/StepGrid.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";

const TRACK_COLORS: Record<TrackName, string> = {
  kick:    "#FF6B00",
  snare:   "#FF3366",
  tom:     "#FF9F1C",
  clap:    "#7B61FF",
  bell:    "#00D4FF",
  hihat:   "#00FF88",
  openhat: "#FFD700",
  cymbal:  "#FF6BFF",
};

const TRACK_LABELS: Record<TrackName, string> = {
  kick:    "BD",
  snare:   "SD",
  tom:     "LT",
  clap:    "CL",
  bell:    "BL",
  hihat:   "CH",
  openhat: "OH",
  cymbal:  "CY",
};

interface StepGridProps {
  pattern: Record<TrackName, number[]>;
  patternLength: number;
  currentStep: number | null;
  trackMuted: Record<TrackName, boolean>;
  selectedTrack: number;
  pendingMuteTracks?: Set<TrackName>;
}

function stepChar(
  velocity: number,
  isPlayhead: boolean,
  trackColor: string,
  muted: boolean
): { char: string; color: string } {
  if (isPlayhead) {
    return velocity > 0
      ? { char: "▶", color: "#FF6B00" }
      : { char: "▷", color: "#2a2a2a" };
  }
  if (muted) {
    return { char: velocity > 0 ? "▪" : "·", color: "#333333" };
  }
  if (velocity === 0) return { char: "·", color: "#2a2a2a" };
  if (velocity < 50)  return { char: "░", color: trackColor };
  if (velocity < 90)  return { char: "▪", color: trackColor };
  return { char: "■", color: trackColor };
}

export function StepGrid({
  pattern,
  patternLength,
  currentStep,
  trackMuted,
  selectedTrack,
  pendingMuteTracks = new Set(),
}: StepGridProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="#333333"
      paddingX={1}
    >
      <Text color="#444444" bold>
        PATTERN
      </Text>
      {TRACK_NAMES.map((track, trackIdx) => {
        const steps = pattern[track] ?? [];
        const color = TRACK_COLORS[track];
        const label = TRACK_LABELS[track];
        const muted = trackMuted[track] ?? false;
        const isSelected = trackIdx === selectedTrack;
        const isPendingMute = pendingMuteTracks.has(track);

        return (
          <Box key={track}>
            <Text
              color={
                isPendingMute ? "#FFD700" : isSelected ? color : "#555555"
              }
              bold={isSelected}
            >
              {label}
              {"  "}
            </Text>
            {Array.from({ length: patternLength }, (_, i) => {
              const velocity = steps[i] ?? 0;
              const isPlayhead = currentStep === i;
              const { char, color: charColor } = stepChar(
                velocity,
                isPlayhead,
                color,
                muted
              );
              return (
                <Text key={i} color={charColor}>
                  {char}{" "}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tui/src/components/StepGrid.tsx
git commit -m "feat(ui): add StepGrid component with per-track colors and playhead"
```

---

### Task 12: GenerationSummary component

**Files:**
- Create: `tui/src/components/GenerationSummary.tsx`

- [ ] **Step 1: Create GenerationSummary**

Create `tui/src/components/GenerationSummary.tsx`:

```tsx
import React from "react";
import { Box, Text } from "ink";

interface GenerationSummaryProps {
  summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
  } | null;
  generationStatus: "idle" | "generating" | "failed";
  lastPrompt: string | null | undefined;
}

export function GenerationSummary({
  summary,
  generationStatus,
  lastPrompt,
}: GenerationSummaryProps) {
  if (generationStatus === "generating") {
    return (
      <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
        <Text color="#FFD700">↳ </Text>
        <Text color="#555555">generating</Text>
        <Text color="#333333">...</Text>
      </Box>
    );
  }

  if (generationStatus === "failed") {
    return (
      <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
        <Text color="#FF3366">↳ generation failed</Text>
      </Box>
    );
  }

  if (!summary && !lastPrompt) return null;

  const displayPrompt = summary?.prompt ?? lastPrompt ?? "";
  const truncated =
    displayPrompt.length > 50
      ? displayPrompt.slice(0, 50) + "…"
      : displayPrompt;

  return (
    <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
      <Text color="#444444">↳ "</Text>
      <Text color="#CCCCCC">{truncated}</Text>
      <Text color="#444444">"</Text>
      {summary && (
        <>
          <Text color="#333333">  →  </Text>
          <Text color="#555555">{summary.track_summary}</Text>
          <Text color="#333333">  ·  </Text>
          <Text color="#333333">{summary.latency_ms}ms</Text>
        </>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tui/src/components/GenerationSummary.tsx
git commit -m "feat(ui): add GenerationSummary component"
```

---

### Task 13: App.tsx layout update

**Files:**
- Modify: `tui/src/App.tsx`

This task wires all the new v0.3 components into the app layout and replaces the old `Header` and `PatternGrid` with `StatusBar`, `StepGrid`, `ChainPanel`, and `GenerationSummary`.

- [ ] **Step 1: Add new imports**

In `tui/src/App.tsx`, replace the existing component imports:

```typescript
// REMOVE:
import { Header } from "./components/Header.js";
import { PatternGrid } from "./components/PatternGrid.js";

// ADD:
import { StatusBar } from "./components/StatusBar.js";
import { StepGrid } from "./components/StepGrid.js";
import { ChainPanel } from "./components/ChainPanel.js";
import { GenerationSummary } from "./components/GenerationSummary.js";
```

- [ ] **Step 2: Add bar counter state**

In the component body, after the existing `useState` declarations, add:

```typescript
const [barCount, setBarCount] = useState(0);
```

In the existing `useEffect` that watches `state.current_step` (or add a new one):

```typescript
useEffect(() => {
  if (state.current_step === 0) {
    setBarCount((n) => n + 1);
  }
}, [state.current_step]);
```

- [ ] **Step 3: Derive current pattern name**

Add a derived value for the current pattern name. Find where `state.last_prompt` is used in the JSX and use it in the StatusBar. No state change needed — `state.last_prompt` is the pattern name.

- [ ] **Step 4: Replace layout JSX**

Find the return statement's top-level `<Box>`. Replace the inner layout to match the new panel order:

```tsx
return (
  <Box flexDirection="column" height={terminalHeight}>
    {/* ── Status bar ── */}
    <StatusBar
      bpm={state.bpm}
      swing={state.swing}
      isPlaying={state.is_playing}
      midiConnected={state.midi_connected}
      generationStatus={state.generation_status}
      patternName={state.last_prompt}
      patternLength={state.pattern_length}
      barCount={barCount}
    />

    {/* ── Chain panel (hidden when no chain) ── */}
    <ChainPanel
      chain={state.chain}
      chainIndex={state.chain_index}
      chainAuto={state.chain_auto}
    />

    {/* ── Step grid ── */}
    <StepGrid
      pattern={state.current_pattern}
      patternLength={state.pattern_length}
      currentStep={state.current_step}
      trackMuted={state.track_muted}
      selectedTrack={patternTrack}
      pendingMuteTracks={pendingMuteTracks}
    />

    {/* ── CC panel (existing, keep as-is) ── */}
    {focus === "cc" && (
      <CCPanel
        state={state}
        actions={actions}
        selectedTrack={ccTrack}
        selectedParam={ccParam}
        stepMode={ccStepMode}
        selectedStep={ccSelectedStep}
      />
    )}

    {/* ── Generation summary ── */}
    <GenerationSummary
      summary={state.generation_summary}
      generationStatus={state.generation_status}
      lastPrompt={state.last_prompt}
    />

    {/* ── Activity log (existing, keep as-is) ── */}
    {showLog && <ActivityLog log={state.log} />}

    {/* ── Prompt (existing, keep as-is) ── */}
    <Prompt
      inputMode={inputMode}
      showHelp={showHelp}
      showHistory={showHistory}
      answerText={answerText}
      askPending={askPending}
      implementableHint={implementableHint}
      onSubmit={handleCommand}
      onClose={() => {
        setShowHelp(false);
        setShowHistory(false);
        setAnswerText(null);
        setFocus("pattern");
      }}
    />
  </Box>
);
```

Note: Keep all existing keyboard handlers (`useInput`, `useEffect`, etc.) unchanged — only the JSX layout changes.

- [ ] **Step 5: Build TUI**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no TypeScript errors. Fix any prop-type mismatches that arise.

- [ ] **Step 6: Run full test suite**

```bash
pytest -v
```
Expected: all tests PASS (no backend changes in this task).

- [ ] **Step 7: Commit**

```bash
git add tui/src/App.tsx
git commit -m "feat(ui): wire StatusBar, ChainPanel, StepGrid, GenerationSummary into App layout"
```

---

## ── v0.4: Feedback Loop ──

### Task 14: `build_context_prompt` and `context_prefix` in generator.py

**Files:**
- Modify: `core/generator.py`
- Create: `tests/test_feedback.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_feedback.py`:

```python
# tests/test_feedback.py
from unittest.mock import MagicMock, patch
from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.generator import Generator, _compute_generation_summary


# ── _compute_generation_summary ──────────────────────────────────────────────

def test_compute_summary_counts_active_steps():
    pattern = {t: [0] * 16 for t in TRACK_NAMES}
    pattern["kick"] = [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0]
    result = _compute_generation_summary("test", pattern, 1000)
    assert "BD×4" in result["track_summary"]


def test_compute_summary_omits_silent_tracks():
    pattern = {t: [0] * 16 for t in TRACK_NAMES}
    result = _compute_generation_summary("test", pattern, 500)
    assert result["track_summary"] == "empty"


def test_compute_summary_includes_latency():
    pattern = {t: [0] * 16 for t in TRACK_NAMES}
    result = _compute_generation_summary("test prompt", pattern, 1234)
    assert result["latency_ms"] == 1234
    assert result["prompt"] == "test prompt"


# ── build_context_prompt ──────────────────────────────────────────────────────

def _make_generator() -> tuple[Generator, AppState]:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    state.bpm = 140.0
    state.last_prompt = "heavy kick"
    state.pattern_length = 16
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = MagicMock()
    return gen, state


def test_build_context_prompt_includes_bpm():
    gen, _ = _make_generator()
    ctx = gen.build_context_prompt()
    assert "140" in ctx


def test_build_context_prompt_includes_pattern_name():
    gen, _ = _make_generator()
    ctx = gen.build_context_prompt()
    assert "heavy kick" in ctx


def test_build_context_prompt_includes_track_summary():
    gen, _ = _make_generator()
    ctx = gen.build_context_prompt()
    # DEFAULT_PATTERN has active kick and snare and hihat
    assert "BD" in ctx


def test_build_context_prompt_includes_section_hint():
    gen, _ = _make_generator()
    ctx = gen.build_context_prompt(section="drop")
    assert "drop" in ctx


def test_build_context_prompt_includes_chain_position():
    gen, state = _make_generator()
    state.set_chain(["intro", "drop", "break"])
    state.chain_next()  # intro (index 0)
    ctx = gen.build_context_prompt()
    assert "1/3" in ctx


def test_build_context_prompt_no_chain_info_when_empty():
    gen, _ = _make_generator()
    ctx = gen.build_context_prompt()
    assert "Chain position" not in ctx
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_feedback.py -v
```
Expected: `AttributeError: 'Generator' object has no attribute 'build_context_prompt'` for those tests; `_compute_generation_summary` tests may pass if already added in Task 7.

- [ ] **Step 3: Add `build_context_prompt` method to Generator**

In `core/generator.py`, inside the `Generator` class, add:

```python
def build_context_prompt(self, section: str | None = None) -> str:
    """Build a context header from current AppState for injection into generation prompts."""
    state = self.state
    pattern = state.current_pattern
    steps = state.pattern_length

    abbreviations = {
        "kick": "BD", "snare": "SD", "tom": "LT", "clap": "CL",
        "bell": "BL", "hihat": "CH", "openhat": "OH", "cymbal": "CY",
    }
    parts = []
    for track in TRACK_NAMES:
        track_steps = pattern.get(track, [])
        active = sum(1 for v in track_steps if v > 0)
        if active > 0:
            parts.append(f"{abbreviations.get(track, track[:2].upper())}×{active}")
    track_summary = "  ".join(parts) if parts else "empty"

    chain_info = ""
    if state.chain and state.chain_index >= 0:
        pos = state.chain_index + 1
        total = len(state.chain)
        chain_info = f"\nChain position: {pos}/{total}"

    section_info = f"\nTarget section: {section}" if section else ""

    return (
        f"[Current pattern context]\n"
        f"Pattern: {state.last_prompt or 'untitled'} ({steps} steps)\n"
        f"Active tracks: {track_summary}\n"
        f"BPM: {int(state.bpm)}, swing: {pattern.get('swing', 0)}"
        f"{chain_info}"
        f"{section_info}\n\n"
    )
```

- [ ] **Step 4: Add `context_prefix` parameter to `generate()`**

Find the `generate()` method signature. Change it from:

```python
def generate(self, prompt: str, variation: bool = False) -> None:
```

to:

```python
def generate(self, prompt: str, variation: bool = False, context_prefix: str | None = None) -> None:
```

Then find where it starts the background thread (likely `threading.Thread(target=self._do_generate, args=...)`). Pass `context_prefix` through:

```python
threading.Thread(
    target=self._do_generate,
    args=(prompt, variation, context_prefix),
    daemon=True,
).start()
```

Find `_do_generate` and update its signature:

```python
def _do_generate(self, prompt: str, variation: bool, context_prefix: str | None = None) -> None:
```

In `_do_generate`, find where the user message content is built. Add the prefix:

```python
user_content = (context_prefix or "") + prompt
```

And use `user_content` instead of bare `prompt` when constructing the messages list passed to the Anthropic client.

- [ ] **Step 5: Run feedback tests**

```bash
pytest tests/test_feedback.py -v
```
Expected: all tests PASS.

- [ ] **Step 6: Run full suite**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add core/generator.py tests/test_feedback.py
git commit -m "feat(feedback): add build_context_prompt() and context_prefix to Generator"
```

---

### Task 15: `generate_next`, `generate_vary`, `ask_read` in generator.py

**Files:**
- Modify: `core/generator.py`
- Modify: `tests/test_feedback.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_feedback.py`:

```python
# ── generate_next ────────────────────────────────────────────────────────────

def test_generate_next_calls_generate_with_context():
    gen, _ = _make_generator()
    with patch.object(gen, "generate") as mock_gen:
        gen.generate_next()
        assert mock_gen.called
        call_kwargs = mock_gen.call_args
        # context_prefix should be passed
        assert call_kwargs.kwargs.get("context_prefix") is not None or \
               (len(call_kwargs.args) >= 3 and call_kwargs.args[2] is not None)


def test_generate_next_with_section():
    gen, _ = _make_generator()
    with patch.object(gen, "generate") as mock_gen:
        gen.generate_next(section="drop")
        prompt_arg = mock_gen.call_args.args[0] if mock_gen.call_args.args else \
                     mock_gen.call_args.kwargs.get("prompt", "")
        assert "drop" in prompt_arg or "drop" in (mock_gen.call_args.kwargs.get("context_prefix") or "")


# ── generate_vary ────────────────────────────────────────────────────────────

def test_generate_vary_default_intensity():
    gen, _ = _make_generator()
    with patch.object(gen, "generate") as mock_gen:
        gen.generate_vary()
        assert mock_gen.called


def test_generate_vary_heavy_intensity():
    gen, _ = _make_generator()
    with patch.object(gen, "generate") as mock_gen:
        gen.generate_vary(intensity="heavy")
        prompt_arg = mock_gen.call_args.args[0] if mock_gen.call_args.args else ""
        assert "heavy" in prompt_arg.lower() or "restructure" in prompt_arg.lower()


def test_generate_vary_invalid_intensity_uses_medium():
    gen, _ = _make_generator()
    with patch.object(gen, "generate") as mock_gen:
        gen.generate_vary(intensity="extreme")
        assert mock_gen.called  # should not raise


# ── ask_read ─────────────────────────────────────────────────────────────────

def test_ask_read_returns_string():
    gen, _ = _make_generator()
    gen.answer_question_with_classify = MagicMock(
        return_value=("Sparse kick, driving hats, tension groove.", False)
    )
    result = gen.ask_read()
    assert isinstance(result, str)
    assert "Sparse kick" in result
```

- [ ] **Step 2: Run to confirm they fail**

```bash
pytest tests/test_feedback.py::test_generate_next_calls_generate_with_context -v
```
Expected: `AttributeError: 'Generator' object has no attribute 'generate_next'`

- [ ] **Step 3: Add the three methods to Generator**

In `core/generator.py`, inside the `Generator` class:

```python
def generate_next(self, section: str | None = None) -> None:
    """Generate the next pattern with current state context injected."""
    context = self.build_context_prompt(section)
    section_hint = f" moving into {section}" if section else ""
    prompt = (
        f"Generate the next drum pattern{section_hint} that flows naturally "
        f"from what is currently playing. Create musical contrast and progression."
    )
    self.generate(prompt, variation=True, context_prefix=context)

def generate_vary(self, intensity: str = "medium") -> None:
    """Generate a variation of the current pattern at the specified intensity."""
    _instructions = {
        "light":  "Make minimal changes — alter at most 2 steps per track, keep the energy the same.",
        "medium": "Evolve the pattern — shift 3–5 elements, maintain the feel but add fresh variation.",
        "heavy":  "Significantly restructure — keep BPM and genre but rearrange the groove substantially.",
    }
    instruction = _instructions.get(intensity, _instructions["medium"])
    context = self.build_context_prompt()
    prompt = f"Generate a variation of the current pattern. {instruction}"
    self.generate(prompt, variation=True, context_prefix=context)

def ask_read(self) -> str:
    """Ask Claude to describe the current pattern in musical terms."""
    context = self.build_context_prompt()
    question = (
        "Describe this drum pattern in musical terms. "
        "What energy does it have? What groove does it create? "
        "Be specific and concise — 3 sentences max."
    )
    answer, _ = self.answer_question_with_classify(context + question)
    return answer
```

- [ ] **Step 4: Run feedback tests**

```bash
pytest tests/test_feedback.py -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/generator.py tests/test_feedback.py
git commit -m "feat(feedback): add generate_next(), generate_vary(), ask_read() to Generator"
```

---

### Task 16: `/next`, `/vary`, `/read` endpoints

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/server.py`
- Modify: `tests/test_feedback.py`

- [ ] **Step 1: Add schemas**

In `api/schemas.py`, append:

```python
class NextRequest(BaseModel):
    section: str | None = None


class VaryRequest(BaseModel):
    intensity: str = "medium"

    @field_validator("intensity")
    @classmethod
    def intensity_must_be_valid(cls, v: str) -> str:
        if v not in ("light", "medium", "heavy"):
            raise ValueError("intensity must be 'light', 'medium', or 'heavy'")
        return v


class ReadResponse(BaseModel):
    description: str
```

- [ ] **Step 2: Write failing endpoint tests**

Append to `tests/test_feedback.py`:

```python
# ── endpoint tests ───────────────────────────────────────────────────────────
import api.server as server_module
from fastapi.testclient import TestClient
from pathlib import Path


def _make_server_client(tmp_path: Path) -> TestClient:
    from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
    from core.events import EventBus
    from core.player import Player
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    state.last_prompt = "current beat"
    state.bpm = 140.0
    bus = EventBus()
    player = Player(state, bus, MagicMock())
    gen = Generator(state, bus)
    gen._client = MagicMock()
    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


def test_post_next_returns_202(tmp_path):
    client = _make_server_client(tmp_path)
    server_module._generator.generate_next = MagicMock()
    resp = client.post("/next", json={})
    assert resp.status_code == 202


def test_post_next_with_section(tmp_path):
    client = _make_server_client(tmp_path)
    server_module._generator.generate_next = MagicMock()
    resp = client.post("/next", json={"section": "drop"})
    assert resp.status_code == 202
    server_module._generator.generate_next.assert_called_once_with(section="drop")


def test_post_vary_returns_202(tmp_path):
    client = _make_server_client(tmp_path)
    server_module._generator.generate_vary = MagicMock()
    resp = client.post("/vary", json={"intensity": "heavy"})
    assert resp.status_code == 202
    server_module._generator.generate_vary.assert_called_once_with(intensity="heavy")


def test_post_vary_invalid_intensity_returns_422(tmp_path):
    client = _make_server_client(tmp_path)
    resp = client.post("/vary", json={"intensity": "extreme"})
    assert resp.status_code == 422


def test_post_read_returns_description(tmp_path):
    client = _make_server_client(tmp_path)
    server_module._generator.ask_read = MagicMock(
        return_value="Sparse kick on 1 and 3, driving hi-hats, tension groove."
    )
    resp = client.post("/read")
    assert resp.status_code == 200
    assert "description" in resp.json()
    assert "Sparse kick" in resp.json()["description"]
```

- [ ] **Step 3: Run to confirm they fail**

```bash
pytest tests/test_feedback.py::test_post_next_returns_202 -v
```
Expected: `404 Not Found`

- [ ] **Step 4: Add endpoints to server.py**

In `api/server.py`, add to the schemas import:

```python
from api.schemas import (
    ...,
    NextRequest, VaryRequest, ReadResponse,
)
```

Add endpoints (append near generation-related endpoints):

```python
@app.post("/next", status_code=202)
def post_next(req: NextRequest):
    _generator.generate_next(section=req.section)
    return {"status": "queued", "section": req.section}


@app.post("/vary", status_code=202)
def post_vary(req: VaryRequest):
    _generator.generate_vary(intensity=req.intensity)
    return {"status": "queued", "intensity": req.intensity}


@app.post("/read", response_model=ReadResponse)
def post_read():
    description = _generator.ask_read()
    return ReadResponse(description=description)
```

- [ ] **Step 5: Run all feedback tests**

```bash
pytest tests/test_feedback.py -v
```
Expected: all tests PASS.

- [ ] **Step 6: Run full suite**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add api/schemas.py api/server.py tests/test_feedback.py
git commit -m "feat(feedback): add /next, /vary, /read endpoints"
```

---

### Task 17: `/next`, `/vary`, `/read` commands in App.tsx

**Files:**
- Modify: `tui/src/App.tsx`

- [ ] **Step 1: Add command handling**

In `tui/src/App.tsx`, inside `handleCommand`'s `switch (verb)` block, add:

```typescript
case "next": {
  const section = parts[1] ?? null;
  await fetch(`${baseUrl}/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section }),
  });
  actions.addLog(
    `generating next pattern${section ? ` → ${section}` : ""}...`
  );
  return;
}

case "vary": {
  const intensity = parts[1] ?? "medium";
  if (!["light", "medium", "heavy"].includes(intensity)) {
    actions.addLog("vary: intensity must be light, medium, or heavy");
    return;
  }
  await fetch(`${baseUrl}/vary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intensity }),
  });
  actions.addLog(`generating ${intensity} variation...`);
  return;
}

case "read": {
  try {
    const resp = await fetch(`${baseUrl}/read`, { method: "POST" });
    const data = await resp.json() as { description: string };
    actions.addLog(`↳ ${data.description}`);
  } catch {
    actions.addLog("read: failed to describe current pattern");
  }
  return;
}
```

- [ ] **Step 2: Add commands to help text**

Find the help text string. Add:

```
/next [section]          — generate next pattern (context-aware: drop, break, build, outro)
/vary [light|medium|heavy] — generate variation of current pattern
/read                    — Claude describes what's currently playing
```

- [ ] **Step 3: Build TUI**

```bash
cd tui && bun run build 2>&1 | head -40
```
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add tui/src/App.tsx
git commit -m "feat(feedback): add /next, /vary, /read TUI commands"
```

---

## ── v1.0: Integration ──

### Task 18: Documentation and CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`
- Modify: `VISION.md` (milestone status)
- Modify: `ARCHITECTURE.md` (new endpoints, events, state)

- [ ] **Step 1: Update CLAUDE.md command reference**

In `CLAUDE.md`, under the UI section, add the new commands:

```
/chain <p1> <p2> ... [--auto]  — define setlist; patterns must be saved; --auto loops at end
/chain-next                    — queue next pattern in chain at bar boundary
/chain-status                  — show current chain position and setlist
/chain-clear                   — exit chain mode
/next [section]                — generate next pattern aware of current state (drop, break, build, outro)
/vary [light|medium|heavy]     — generate variation of current pattern at specified intensity
/read                          — Claude describes what's currently playing in musical terms
```

- [ ] **Step 2: Update VISION.md milestone status**

In `VISION.md`, mark v0.2/v0.3/v0.4 milestones as complete.

- [ ] **Step 3: Update ARCHITECTURE.md**

Add to the API endpoints section:

```
POST /chain              — set pattern chain (names: list[str], auto: bool)
POST /chain/next         — advance chain to next pattern at bar boundary
DELETE /chain            — clear chain state
GET /chain               — return current chain status
POST /next               — generate next pattern with context injection (section: str|null)
POST /vary               — generate variation (intensity: light|medium|heavy)
POST /read               — Claude describes current pattern in prose
```

Add to the WebSocket events section:

```
chain_updated   — chain state changed (chain, chain_index, chain_auto, current)
chain_advanced  — chain stepped forward (chain, chain_index, current)
```

Add to the AppState section:

```
chain: list[str]      # ordered setlist pattern names
chain_index: int      # -1 = defined but not started; ≥0 = current position
chain_auto: bool      # auto-advance at bar boundary
```

- [ ] **Step 4: Run full test suite one final time**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md VISION.md ARCHITECTURE.md
git commit -m "docs: update command reference and architecture for v1.0.0"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Chain state: `chain`, `chain_index`, `chain_auto` | Task 1 |
| `/chain`, `/chain-next`, `/chain-status`, `/chain-clear` commands | Tasks 3, 6 |
| Auto-advance at bar boundary | Tasks 3 (subscriber), 4 (event) |
| Persistent status bar (BPM, MIDI, Claude, pattern name) | Task 9 |
| Chain panel with position indicator | Task 10 |
| Per-track colored step grid with playhead | Task 11 |
| Generation summary pane | Task 12 |
| App layout wired | Task 13 |
| `build_context_prompt()` | Task 14 |
| `/next [section]` | Tasks 15, 16, 17 |
| `/vary [intensity]` | Tasks 15, 16, 17 |
| `/read` | Tasks 15, 16, 17 |
| Docs updated | Task 18 |

**No TBDs, placeholders, or contradictions found.**

**Type consistency verified:** `ChainRequest.names: list[str]`, `ChainStatusResponse.chain: list[str]`, `state.chain: list[str]` — consistent throughout. `intensity: str` validated via Pydantic in `VaryRequest` and mirrored in TUI guard. `context_prefix: str | None` added to both `generate()` and `_do_generate()`.
