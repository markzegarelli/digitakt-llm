# CP2 — Music Depth 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add variable pattern lengths (8/16/32 steps), one-shot fill patterns (plays once then reverts), and an optional-tags layer on the named pattern library.

**Architecture:** `AppState.pattern_length` drives `Player._loop()` step count and the generator system prompt. Fills use a two-phase atomic swap: `fill_pattern` queues the fill at end-of-loop, `_fill_active` marks the fill cycle, `_pre_fill_pattern` holds the original for restoration. Saved patterns migrate from raw dicts to an envelope `{"pattern": {...}, "tags": [...], "saved_at": "..."}` with backwards-compatible load.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 backend, Bun/Ink TypeScript TUI, pytest.

**Prerequisite:** CP1 complete (main branch clean).

---

## File Map

| File | Changes |
|------|---------|
| `core/state.py` | Add `pattern_length`, `fill_pattern`, `_fill_active`, `_pre_fill_pattern`; add `queue_fill()` |
| `core/player.py` | Variable step loop; fill two-phase swap at end-of-loop |
| `core/generator.py` | Parameterize step count in `_SYSTEM_PROMPT` and `_parse_pattern()` |
| `api/schemas.py` | Add `LengthRequest`, `LengthResponse`, `SavePatternRequest`, `PatternEntry`; update `PatternListResponse`, `StateResponse` |
| `api/server.py` | Add `POST /length`, `POST /fill/{name}`; update `/patterns` save/load/list |
| `tui/src/hooks/useDigitakt.ts` | Add `pattern_length`, `fill_active`, `fill_queued` to state; handle new WS events; add `queueFill()` action |
| `tui/src/App.tsx` | Add `/length`, `/fill`, `/patterns` commands; update `/save` for `#tags` |
| `tui/src/components/PatternGrid.tsx` | Variable column count via new `patternLength` prop |
| `tui/src/components/Header.tsx` | FILL QUEUED / FILLING indicator |
| `tests/test_player.py` | Tests for variable step count, fill two-phase swap |
| `tests/test_server.py` | Tests for `/length`, `/fill/{name}`, tagged patterns |
| `tests/test_state.py` | Test `queue_fill()` |

---

## Task 1: Variable pattern length — AppState + Player

**Files:**
- Modify: `core/state.py`
- Modify: `core/player.py`
- Test: `tests/test_player.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_player.py`:

```python
def test_loop_respects_pattern_length_8():
    player, state, bus, _ = _make_player()
    state.bpm = 9000.0
    state.pattern_length = 8
    state.current_pattern = {k: [64] * 8 for k in TRACK_NAMES}
    steps_seen = []
    bus.subscribe("step_changed", lambda p: steps_seen.append(p["step"]))
    player.start()
    time.sleep(0.05)
    player.stop()
    assert steps_seen, "No steps emitted"
    assert all(s < 8 for s in steps_seen)


def test_loop_respects_pattern_length_32():
    player, state, bus, _ = _make_player()
    state.bpm = 9000.0
    state.pattern_length = 32
    state.current_pattern = {k: [64] * 32 for k in TRACK_NAMES}
    steps_seen = []
    bus.subscribe("step_changed", lambda p: steps_seen.append(p["step"]))
    player.start()
    time.sleep(0.05)
    player.stop()
    assert any(s >= 16 for s in steps_seen), "No steps > 15 seen for 32-step pattern"
    assert all(s < 32 for s in steps_seen)
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_player.py::test_loop_respects_pattern_length_8 tests/test_player.py::test_loop_respects_pattern_length_32 -v
```
Expected: `AttributeError: 'AppState' object has no attribute 'pattern_length'`

- [ ] **Step 3: Add `pattern_length` to `AppState`**

In `core/state.py`, add after `track_velocity`:

```python
    pattern_length: int = 16
```

- [ ] **Step 4: Update `Player._loop()` to use `pattern_length`**

In `core/player.py`, line 121, change:

```python
# Before
            for step in range(16):
# After
            for step in range(self.state.pattern_length):
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pytest tests/test_player.py::test_loop_respects_pattern_length_8 tests/test_player.py::test_loop_respects_pattern_length_32 -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add core/state.py core/player.py tests/test_player.py
git commit -m "feat(CP2): variable pattern length in AppState and Player loop"
```

---

## Task 2: Variable pattern length — API endpoint

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/server.py`
- Test: `tests/test_server.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_server.py`:

```python
def test_post_length_sets_pattern_length(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/length", json={"steps": 8})
    assert resp.status_code == 200
    assert resp.json()["steps"] == 8
    state_resp = client.get("/state")
    assert state_resp.json()["pattern_length"] == 8


def test_post_length_rejects_invalid_value(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/length", json={"steps": 7})
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_server.py::test_post_length_sets_pattern_length tests/test_server.py::test_post_length_rejects_invalid_value -v
```
Expected: FAIL (404)

- [ ] **Step 3: Add schemas**

Add to `api/schemas.py`:

```python
from pydantic import field_validator

class LengthRequest(BaseModel):
    steps: int

    @field_validator("steps")
    @classmethod
    def steps_must_be_valid(cls, v: int) -> int:
        if v not in (8, 16, 32):
            raise ValueError("steps must be 8, 16, or 32")
        return v


class LengthResponse(BaseModel):
    steps: int
```

Add `pattern_length: int = 16` to `StateResponse`:

```python
class StateResponse(BaseModel):
    current_pattern: dict
    pending_pattern: dict | None
    bpm: float
    is_playing: bool
    midi_port_name: str | None
    last_prompt: str | None
    pattern_history: list
    track_cc: dict
    track_muted: dict
    track_velocity: dict
    swing: int = 0
    pattern_length: int = 16       # NEW
```

- [ ] **Step 4: Add `POST /length` and update `GET /state`**

In `api/server.py`, add import for the new schemas (add to existing import line from `api.schemas`):
`LengthRequest, LengthResponse`

Add endpoint after `/swing`:

```python
@app.post("/length", response_model=LengthResponse)
async def set_length(req: LengthRequest):
    _state.pattern_length = req.steps
    # Resize current_pattern to match new length (pad with 0 or truncate)
    for track in TRACK_NAMES:
        cur = _state.current_pattern.get(track, [])
        if len(cur) < req.steps:
            _state.current_pattern[track] = cur + [0] * (req.steps - len(cur))
        elif len(cur) > req.steps:
            _state.current_pattern[track] = cur[:req.steps]
    _bus.emit("length_changed", {"steps": req.steps})
    _bus.emit("pattern_changed", {"pattern": _state.current_pattern, "prompt": _state.last_prompt or ""})
    return LengthResponse(steps=req.steps)
```

Import `TRACK_NAMES` from `core.state` in `api/server.py` (add to existing import).

In the `GET /state` handler, add `pattern_length=_state.pattern_length` to the `StateResponse(...)` constructor call.

- [ ] **Step 5: Run tests to confirm they pass**

```
pytest tests/test_server.py::test_post_length_sets_pattern_length tests/test_server.py::test_post_length_rejects_invalid_value -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/schemas.py api/server.py tests/test_server.py
git commit -m "feat(CP2): POST /length endpoint, length in StateResponse"
```

---

## Task 3: Variable pattern length — generator + TUI

**Files:**
- Modify: `core/generator.py`
- Modify: `tui/src/hooks/useDigitakt.ts`
- Modify: `tui/src/App.tsx`
- Modify: `tui/src/components/PatternGrid.tsx`

- [ ] **Step 1: Parameterize `_SYSTEM_PROMPT` in `core/generator.py`**

Replace the module-level `_SYSTEM_PROMPT` string constant with a function. The full current prompt stays identical except for the three places that mention step count:

```python
# Replace _SYSTEM_PROMPT = "..." with:

def _build_system_prompt(steps: int = 16) -> str:
    return (
        "You are an expert drum pattern generator specializing in techno and electronic music production. "
        "You understand groove, hypnotic repetition, tension, and the specific conventions of techno subgenres.\n\n"
        "SUBGENRE BPM RANGES — choose a BPM from the matching range based on the user's request:\n"
        "  detroit techno:          130–138\n"
        "  minimal techno:          130–136\n"
        "  acid techno:             138–145\n"
        "  hypnotic / trance techno: 140–148\n"
        "  industrial techno:       140–150\n"
        "  dark techno / hard techno: 142–155\n"
        "  schranz:                 150–162\n"
        "  generic / unspecified:   133–140\n\n"
        "GROOVE RULES:\n"
        "  - Kick: four-on-the-floor (steps 1,5,9,13) is the techno foundation; vary velocity 90–127 for feel\n"
        "  - Snare/clap: anchor on beats 2 and 4 (steps 5 and 13); ghost notes on steps 3,7,11,15 add groove\n"
        "  - Hihat: vary velocity across steps (range 40–100) — never use uniform flat values\n"
        "  - Open hat: off-beat placements (step 9 is classic) or syncopated 3-against-4 patterns\n"
        "  - Tom/cymbal/bell: use sparingly for fills, accents, or hypnotic motifs — silence is valid\n"
        "  - Techno thrives on space and repetition; not every track needs hits every bar\n"
        "  - Use the full velocity range 0–127, not just 0 and 100\n\n"
        f"Generate {steps}-step drum patterns as strict JSON. Each step is an integer 0–127 (velocity), 0 = silent.\n\n"
        "OPTIONAL CC ADJUSTMENTS:\n"
        "When a request adjusts sound parameters or velocity, include an optional \"cc\" key with only the\n"
        "tracks and params that should change. Valid params: tune, filter, resonance, attack, decay, volume,\n"
        "reverb, delay, velocity. All values 0–127. velocity scales the track's overall strike intensity.\n\n"
        "Respond ONLY with valid JSON in this exact format — no explanation, no markdown:\n"
        "{\n"
        '  "bpm":     <integer from subgenre range>,\n'
        f'  "kick":    [{steps} integers 0-127],\n'
        f'  "snare":   [{steps} integers 0-127],\n'
        f'  "tom":     [{steps} integers 0-127],\n'
        f'  "clap":    [{steps} integers 0-127],\n'
        f'  "bell":    [{steps} integers 0-127],\n'
        f'  "hihat":   [{steps} integers 0-127],\n'
        f'  "openhat": [{steps} integers 0-127],\n'
        f'  "cymbal":  [{steps} integers 0-127],\n'
        '  "cc": {"<track>": {"<param>": <0-127>, ...}, ...}  (optional)\n'
        "}"
        "\n\nOPTIONAL: Per-step probability (prob):\n"
        f"- Add a \"prob\" key containing a dict of track → {steps}-element list of integers (0–100).\n"
        "- 100 = always trigger. 75 = fires 75% of the time. 0 = never fires.\n"
        "- Omit tracks that should always fire. Omit \"prob\" entirely for fully deterministic patterns.\n"
        "- Use prob to: add ghost note uncertainty (snare ghost notes at 50–75%), randomize hi-hat repetitions, make fills feel organic. Do NOT apply prob to kick on downbeats.\n"
        f"- Example: \"prob\": {{\"snare\": [100,100,50,100,100,100,75,100,100,100,50,100,100,100,75,100]}}\n"
        "\n"
        "OPTIONAL: Swing (swing):\n"
        "- Add a \"swing\" key with a single integer 0–100.\n"
        "- 0 = perfectly quantized (no swing). 25 = light shuffle. 50 = strong triplet shuffle.\n"
        "- Swing delays the even 16th-note positions (the \"and\" of each beat).\n"
        "- Use swing for: shuffle techno (20–35), house groove (30–45), funk/break feel (40–55).\n"
        "- Omit \"swing\" for straight, mechanical patterns (industrial, hard techno)."
    )
```

- [ ] **Step 2: Update `Generator._call_api()` to use `_build_system_prompt`**

In `generator.py`, `_call_api()` (line 184) currently passes `system=_SYSTEM_PROMPT`. Change it to:

```python
def _call_api(self, user_prompt: str, strict: bool = False) -> str:
    content = user_prompt + (_STRICT_SUFFIX if strict else "")
    response = self._client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=_build_system_prompt(self.state.pattern_length),   # was _SYSTEM_PROMPT
        messages=[{"role": "user", "content": content}],
    )
    return response.content[0].text
```

Note: `_STRICT_SUFFIX` is appended to the user content (not system), so it is unchanged.

- [ ] **Step 3: Update `_parse_pattern()` to accept `steps` parameter**

In `Generator._parse_pattern()`, change the signature and the two hardcoded `16` checks:

```python
def _parse_pattern(self, text: str, steps: int = 16) -> tuple[dict, int | None, dict] | None:
    ...
    # Line 136 — change 16 to steps:
    if not all(len(data[k]) == steps for k in TRACK_NAMES):
        return None
    ...
    # In the prob section, line 151 — change 16 to steps:
    if not isinstance(values, list) or len(values) != steps:
        return None
```

Update the call sites that invoke `_parse_pattern` to pass `steps=self.state.pattern_length`.

- [ ] **Step 4: Add `length_changed` handler and `pattern_length` to TUI state**

In `tui/src/hooks/useDigitakt.ts`:

Add `pattern_length: 16` to the default state object.

In `fetchState()`, add `pattern_length: d.pattern_length ?? 16` to the `setState` call.

Add WebSocket event handler after `swing_changed`:

```typescript
case "length_changed":
  setState(s => ({ ...s, pattern_length: (data.steps as number) ?? 16 }));
  addLog(`Pattern length → ${data.steps} steps`);
  break;
```

- [ ] **Step 5: Add `/length` command to `App.tsx`**

In `handleCommand()`, add a case after the `swing` handler:

```typescript
case "length": {
  const steps = parseInt(parts[1] ?? "", 10);
  if (![8, 16, 32].includes(steps)) {
    addLog("Usage: /length [8|16|32]");
    return;
  }
  setState(s => ({ ...s, pattern_length: steps }));
  fetch(`${baseUrl}/length`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steps }),
  });
  break;
}
```

- [ ] **Step 6: Update `PatternGrid.tsx` for variable column count**

Add `patternLength: number` to the props type. Replace every occurrence of `16` in the rendering loop (step header row, per-track step cells) with `patternLength`. Use `Array.from({ length: patternLength }, (_, i) => i)` for both the header and the cell arrays.

In `App.tsx`, pass `patternLength={state.pattern_length}` to `<PatternGrid>`.

- [ ] **Step 7: Run full test suite**

```
pytest -v
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add core/generator.py tui/src/hooks/useDigitakt.ts tui/src/App.tsx tui/src/components/PatternGrid.tsx
git commit -m "feat(CP2): parameterize generator prompt and TUI grid for variable pattern length"
```

---

## Task 4: Fill pattern — AppState + Player

**Files:**
- Modify: `core/state.py`
- Modify: `core/player.py`
- Test: `tests/test_player.py`, `tests/test_state.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_state.py`:

```python
def test_queue_fill_sets_fill_pattern():
    state = AppState()
    fill = {k: [50] * 16 for k in TRACK_NAMES}
    state.queue_fill(fill)
    assert state.fill_pattern == fill
```

Add to `tests/test_player.py`:

```python
def test_fill_plays_once_then_reverts():
    player, state, bus, _ = _make_player()
    state.bpm = 9000.0
    original = {k: [10] * 16 for k in TRACK_NAMES}
    fill_pat = {k: [99] * 16 for k in TRACK_NAMES}
    state.current_pattern = dict(original)

    fill_events = []
    bus.subscribe("fill_started", lambda p: fill_events.append("started"))
    bus.subscribe("fill_ended", lambda p: fill_events.append("ended"))

    player.start()
    time.sleep(0.05)
    state.queue_fill(fill_pat)
    time.sleep(0.3)  # wait for fill loop + revert at 9000 BPM
    player.stop()

    assert "started" in fill_events
    assert "ended" in fill_events
    assert state.current_pattern[TRACK_NAMES[0]][0] == 10  # reverted
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_state.py::test_queue_fill_sets_fill_pattern tests/test_player.py::test_fill_plays_once_then_reverts -v
```
Expected: `AttributeError: 'AppState' object has no attribute 'queue_fill'`

- [ ] **Step 3: Add fill fields and `queue_fill()` to `AppState`**

In `core/state.py`, add after `pattern_length`:

```python
    fill_pattern: dict | None = None
    _fill_active: bool = field(default=False, init=False, repr=False)
    _pre_fill_pattern: dict | None = field(default=None, init=False, repr=False)
```

Add method:

```python
    def queue_fill(self, pattern: dict) -> None:
        with self._lock:
            self.fill_pattern = pattern
```

- [ ] **Step 4: Add fill two-phase swap to `Player._loop()`**

In `core/player.py`, replace the end-of-loop block (currently lines 157–167) with:

```python
            # End of loop: permanent swap, then fill logic

            if self.state.pending_pattern is not None:
                self.state.current_pattern = self.state.pending_pattern
                self.state.pending_pattern = None
                self.bus.emit(
                    "pattern_changed",
                    {"pattern": self.state.current_pattern, "prompt": self.state.last_prompt or ""},
                )

            if self.state.fill_pattern is not None:
                # Begin fill: save current, play fill next loop
                self.state._pre_fill_pattern = self.state.current_pattern
                self.state.current_pattern = self.state.fill_pattern
                self.state.fill_pattern = None
                self.state._fill_active = True
                self.bus.emit("fill_started", {"pattern": self.state.current_pattern})
            elif self.state._fill_active:
                # End fill: restore pre-fill pattern
                self.state.current_pattern = self.state._pre_fill_pattern
                self.state._pre_fill_pattern = None
                self.state._fill_active = False
                self.bus.emit("fill_ended", {"pattern": self.state.current_pattern})
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pytest tests/test_state.py::test_queue_fill_sets_fill_pattern tests/test_player.py::test_fill_plays_once_then_reverts -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add core/state.py core/player.py tests/test_player.py tests/test_state.py
git commit -m "feat(CP2): one-shot fill pattern with two-phase Player swap"
```

---

## Task 5: Fill pattern — API + TUI

**Files:**
- Modify: `api/server.py`
- Modify: `tui/src/App.tsx`
- Modify: `tui/src/hooks/useDigitakt.ts`
- Modify: `tui/src/components/Header.tsx`
- Test: `tests/test_server.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_server.py`:

```python
def test_post_fill_queues_saved_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/patterns/myfill")        # save current as "myfill"
    resp = client.post("/fill/myfill")
    assert resp.status_code == 200
    assert resp.json()["queued"] == "myfill"


def test_post_fill_missing_pattern_returns_404(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/fill/doesnotexist")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_server.py::test_post_fill_queues_saved_pattern tests/test_server.py::test_post_fill_missing_pattern_returns_404 -v
```
Expected: FAIL (404)

- [ ] **Step 3: Add `POST /fill/{name}` to `api/server.py`**

Add after the existing `/patterns/{name}` handlers:

```python
@app.post("/fill/{name}")
async def queue_fill_pattern(name: str):
    path = os.path.join(_patterns_dir, f"{name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    with open(path) as f:
        data = json.load(f)
    # Support both old format (raw pattern dict) and new format ({"pattern": ...})
    pattern = data.get("pattern", data)
    _state.queue_fill(pattern)
    return {"queued": name}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
pytest tests/test_server.py::test_post_fill_queues_saved_pattern tests/test_server.py::test_post_fill_missing_pattern_returns_404 -v
```
Expected: PASS

- [ ] **Step 5: Add fill state and events to `useDigitakt.ts`**

Add to default state:

```typescript
fill_active: false,
fill_queued: false,
```

Add WebSocket event handlers (after `swing_changed`):

```typescript
case "fill_started":
  setState(s => ({ ...s, fill_active: true, fill_queued: false }));
  addLog("Fill playing");
  break;
case "fill_ended":
  setState(s => ({ ...s, fill_active: false }));
  addLog("Fill ended — reverted");
  break;
```

Add `queueFill` action:

```typescript
queueFill: async (name: string) => {
  setState(s => ({ ...s, fill_queued: true }));
  const resp = await fetch(`${baseUrl}/fill/${encodeURIComponent(name)}`, { method: "POST" });
  if (!resp.ok) {
    setState(s => ({ ...s, fill_queued: false }));
    throw new Error(`Pattern '${name}' not found`);
  }
},
```

- [ ] **Step 6: Add `/fill` command to `App.tsx`**

In `handleCommand()`, add:

```typescript
case "fill": {
  const name = parts[1];
  if (!name) {
    addLog("Usage: /fill <pattern-name>");
    return;
  }
  actions.queueFill(name).catch((err: Error) => addLog(`Error: ${err.message}`));
  break;
}
```

- [ ] **Step 7: Add fill indicator to `Header.tsx`**

Add `fillActive: boolean` and `fillQueued: boolean` to the `Header` props type. In the render, add alongside the playback status display:

```typescript
{fillQueued && <Text color="yellow"> FILL QUEUED</Text>}
{fillActive && <Text color="cyan"> FILLING</Text>}
```

In `App.tsx`, pass `fillActive={state.fill_active}` and `fillQueued={state.fill_queued}` to `<Header>`.

- [ ] **Step 8: Commit**

```bash
git add api/server.py tui/src/App.tsx tui/src/hooks/useDigitakt.ts tui/src/components/Header.tsx tests/test_server.py
git commit -m "feat(CP2): POST /fill/{name} API, /fill TUI command, fill indicator in Header"
```

---

## Task 6: Named pattern library with optional tags

**Files:**
- Modify: `api/schemas.py`
- Modify: `api/server.py`
- Modify: `tui/src/App.tsx`
- Test: `tests/test_server.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_server.py`:

```python
def test_save_pattern_with_tags(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/patterns/groove", json={"tags": ["dark", "kick-heavy"]})
    assert resp.status_code == 200
    data = json.loads((tmp_path / "groove.json").read_text())
    assert data["tags"] == ["dark", "kick-heavy"]
    assert "pattern" in data
    assert "saved_at" in data


def test_list_patterns_includes_tags(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/patterns/groove", json={"tags": ["dark"]})
    client.post("/patterns/simple", json={})
    resp = client.get("/patterns")
    assert resp.status_code == 200
    names = {item["name"]: item for item in resp.json()["patterns"]}
    assert names["groove"]["tags"] == ["dark"]
    assert names["simple"]["tags"] == []


def test_load_old_format_pattern_backwards_compat(tmp_path):
    old = {k: [0] * 16 for k in ["kick","snare","tom","clap","bell","hihat","openhat","cymbal"]}
    (tmp_path / "legacy.json").write_text(json.dumps(old))
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns/legacy")
    assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_server.py::test_save_pattern_with_tags tests/test_server.py::test_list_patterns_includes_tags tests/test_server.py::test_load_old_format_pattern_backwards_compat -v
```
Expected: FAIL

- [ ] **Step 3: Update schemas in `api/schemas.py`**

Add:

```python
class SavePatternRequest(BaseModel):
    tags: list[str] = []


class PatternEntry(BaseModel):
    name: str
    tags: list[str]
```

Replace the existing `PatternListResponse`:

```python
class PatternListResponse(BaseModel):
    patterns: list[PatternEntry]
```

(The old schema had `names: list[str]`. Any TUI code reading `resp.names` must be updated in a later step.)

- [ ] **Step 4: Update `api/server.py` save/load/list handlers**

Add import: `import datetime` at top of `api/server.py`.

Also add `SavePatternRequest, PatternEntry` to the imports from `api.schemas`.

Update `POST /patterns/{name}`:

```python
@app.post("/patterns/{name}")
async def save_pattern(name: str, req: SavePatternRequest = SavePatternRequest()):
    path = os.path.join(_patterns_dir, f"{name}.json")
    payload = {
        "pattern": _state.current_pattern,
        "tags": req.tags,
        "saved_at": datetime.datetime.utcnow().isoformat(),
    }
    with open(path, "w") as f:
        json.dump(payload, f)
    return {"saved": name}
```

Update `GET /patterns`:

```python
@app.get("/patterns", response_model=PatternListResponse)
async def list_patterns():
    entries = []
    for fname in sorted(os.listdir(_patterns_dir)):
        if not fname.endswith(".json"):
            continue
        name = fname[:-5]
        try:
            with open(os.path.join(_patterns_dir, fname)) as f:
                data = json.load(f)
            tags = data.get("tags", []) if isinstance(data, dict) and isinstance(data.get("tags"), list) else []
        except Exception:
            tags = []
        entries.append(PatternEntry(name=name, tags=tags))
    return PatternListResponse(patterns=entries)
```

Update `GET /patterns/{name}` for backwards-compatible load:

```python
@app.get("/patterns/{name}")
async def load_pattern(name: str):
    path = os.path.join(_patterns_dir, f"{name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    with open(path) as f:
        data = json.load(f)
    # Old format: raw pattern dict. New format: {"pattern": {...}, "tags": [...]}
    pattern = data.get("pattern", data) if isinstance(data, dict) and "pattern" in data else data
    _player.queue_pattern(pattern)
    _state.last_prompt = name
    return {"loaded": name}
```

- [ ] **Step 5: Run tests to confirm they pass**

```
pytest tests/test_server.py::test_save_pattern_with_tags tests/test_server.py::test_list_patterns_includes_tags tests/test_server.py::test_load_old_format_pattern_backwards_compat -v
```
Expected: PASS

- [ ] **Step 6: Update `App.tsx` — `/save` tags + `/patterns` command**

Update `save` case:

```typescript
case "save": {
  const name = parts[1];
  if (!name) {
    addLog("Usage: /save <name> [#tag1 #tag2]");
    return;
  }
  const tags = parts.slice(2)
    .filter(p => p.startsWith("#"))
    .map(p => p.slice(1));
  fetch(`${baseUrl}/patterns/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  }).then(() => addLog(`Saved "${name}"${tags.length ? `  [${tags.join(", ")}]` : ""}`));
  break;
}
```

Update `load` case to use `encodeURIComponent`:

```typescript
case "load": {
  if (parts[1]) {
    fetch(`${baseUrl}/patterns/${encodeURIComponent(parts[1])}`)
      .then(r => { if (!r.ok) addLog(`Pattern "${parts[1]}" not found`); });
  }
  break;
}
```

Add `/patterns` command after `load`:

```typescript
case "patterns": {
  const filterTag = parts[1]?.startsWith("#") ? parts[1].slice(1) : null;
  fetch(`${baseUrl}/patterns`)
    .then(r => r.json())
    .then((d: { patterns: Array<{ name: string; tags: string[] }> }) => {
      const list = filterTag
        ? d.patterns.filter(p => p.tags.includes(filterTag))
        : d.patterns;
      if (list.length === 0) {
        addLog(filterTag ? `No patterns tagged #${filterTag}.` : "No saved patterns.");
      } else {
        list.forEach(p =>
          addLog(`  ${p.name}${p.tags.length ? `  [${p.tags.join(", ")}]` : ""}`)
        );
      }
    });
  break;
}
```

- [ ] **Step 7: Commit**

```bash
git add api/schemas.py api/server.py tui/src/App.tsx tests/test_server.py
git commit -m "feat(CP2): tagged named pattern library with backwards-compatible load"
```

---

## Task 7: Full suite + docs

- [ ] **Step 1: Run full test suite**

```
pytest -v
```
Expected: all tests pass

- [ ] **Step 2: Update `CLAUDE.md` — add new API endpoints and commands**

Under "Key endpoints", add:
- `POST /length` — set pattern step count (8, 16, 32)
- `POST /fill/{name}` — queue saved pattern as one-shot fill

Under the `/help` command reference (or equivalent), add:
- `/length [8|16|32]` — set pattern step count
- `/fill <name>` — queue saved pattern as one-shot fill (plays once, reverts)
- `/patterns [#tag]` — list saved patterns, optionally filtered by tag
- `/save <name> [#tag1 #tag2]` — save pattern with optional tags

- [ ] **Step 3: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs(CP2): update CLAUDE.md with new commands and endpoints"
```

---

## Verification

1. `pytest -v` — all tests pass
2. Launch: `digitakt`
3. `/length 8` — PatternGrid shows 8 columns
4. `heavy kick` (beat mode) — Claude generates 8-step pattern
5. `/save groove #dark #minimal` — file contains `{"pattern": ..., "tags": ["dark", "minimal"], "saved_at": ...}`
6. `/patterns #dark` — logs "groove  [dark, minimal]"
7. `/save fill1` — save a second pattern
8. `/fill fill1` — Header shows FILL QUEUED → FILLING → reverts, logs "Fill ended"
9. `/length 32` — PatternGrid renders 32 columns
10. `schranz brutal` — Claude generates 32-step pattern
