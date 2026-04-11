# CP3 — Music Depth 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-step note gate, per-track pitch control, Elektron-style conditional trigs (1:2 / not:2 / fill), and a SysEx investigation doc.

**Architecture:** Gate sends a deferred `note_off` via `threading.Timer` when `gate < 100`; default gate=100 preserves current no-note-off behavior. Track pitch is stored in `AppState.track_pitch` and replaces the static `NOTE_MAP` lookup in `Player._play_step`. Conditional trigs are stored in `pattern["cond"][track][step]` and evaluated against `Player._loop_count` (incremented each full loop) and `AppState._fill_active` (from CP2). SysEx is a research-only deliverable.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2, Bun/Ink TypeScript TUI, pytest.

**Prerequisite:** CP2 complete (fills land `AppState._fill_active`; fill condition trig depends on it).

---

## File Map

| File | Changes |
|------|---------|
| `core/state.py` | Add `track_pitch` dict |
| `core/player.py` | Gate note_off via Timer; use `track_pitch`; add `_loop_count`; condition check in `_play_step` |
| `cli/commands.py` | Add `apply_gate_step()`, `apply_cond_step()` |
| `api/schemas.py` | Add `GateRequest`, `PitchRequest`, `PitchResponse`, `CondRequest`; add `track_pitch` to `StateResponse` |
| `api/server.py` | Add `POST /gate`, `POST /pitch`, `POST /cond` |
| `tui/src/hooks/useDigitakt.ts` | Add `track_pitch` to state; handle `gate_changed`, `pitch_changed`, `cond_changed` WS events; add `setGate`, `setPitch`, `setCond` actions |
| `tui/src/App.tsx` | Add `/gate`, `/pitch`, `/cond` commands |
| `tui/src/components/PatternGrid.tsx` | Show `◆` marker for steps with a condition |
| `docs/sysex-investigation.md` | SysEx research notes |
| `tests/test_player.py` | Tests for gate timing, pitch, conditional trigs |
| `tests/test_server.py` | Tests for `/gate`, `/pitch`, `/cond` |
| `tests/test_commands.py` | Tests for `apply_gate_step`, `apply_cond_step` |

---

## Task 1: Per-step gate — commands + API

Gate `0–100` = percentage of step duration before `note_off` is sent. Default `100` = no note_off (preserves current behavior). Gate `< 100` = schedule `note_off` via `threading.Timer`.

**Files:**
- Modify: `cli/commands.py`
- Modify: `api/schemas.py`
- Modify: `api/server.py`
- Test: `tests/test_commands.py`, `tests/test_server.py`

- [ ] **Step 1: Write failing tests for `apply_gate_step`**

Add to `tests/test_commands.py`:

```python
from cli.commands import apply_gate_step
from core.state import TRACK_NAMES


def test_apply_gate_step_sets_value():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    result = apply_gate_step(pattern, "kick", 0, 50)
    assert result["gate"]["kick"][0] == 50


def test_apply_gate_step_creates_gate_key_if_missing():
    pattern = {k: [64] * 16 for k in TRACK_NAMES}
    result = apply_gate_step(pattern, "hihat", 3, 75)
    assert "gate" in result
    assert result["gate"]["hihat"][3] == 75
    # Other steps default to 100
    assert result["gate"]["hihat"][0] == 100


def test_apply_gate_step_rejects_out_of_range():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    import pytest
    with pytest.raises(ValueError):
        apply_gate_step(pattern, "kick", 0, 101)
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_commands.py::test_apply_gate_step_sets_value tests/test_commands.py::test_apply_gate_step_creates_gate_key_if_missing tests/test_commands.py::test_apply_gate_step_rejects_out_of_range -v
```
Expected: `ImportError` or `AttributeError` — `apply_gate_step` does not exist yet

- [ ] **Step 3: Implement `apply_gate_step` in `cli/commands.py`**

Add to `cli/commands.py`:

```python
def apply_gate_step(pattern: dict, track: str, step: int, value: int) -> dict:
    """Set gate (0–100) for a single step. 100 = full step duration, 0 = immediate note_off."""
    if not (0 <= value <= 100):
        raise ValueError(f"Gate value must be 0–100, got {value}")
    pattern = dict(pattern)
    if "gate" not in pattern:
        # Initialize all tracks/steps to 100 (full gate = current behavior)
        length = len(pattern.get("kick", [None] * 16))
        pattern["gate"] = {t: [100] * length for t in TRACK_NAMES}
    pattern["gate"] = dict(pattern["gate"])
    pattern["gate"][track] = list(pattern["gate"][track])
    pattern["gate"][track][step] = value
    return pattern
```

You'll need `from core.state import TRACK_NAMES` at the top of `cli/commands.py` (it may already be imported).

- [ ] **Step 4: Run tests to confirm they pass**

```
pytest tests/test_commands.py::test_apply_gate_step_sets_value tests/test_commands.py::test_apply_gate_step_creates_gate_key_if_missing tests/test_commands.py::test_apply_gate_step_rejects_out_of_range -v
```
Expected: PASS

- [ ] **Step 5: Add `GateRequest` schema and `POST /gate` endpoint**

Write failing test first:

```python
# tests/test_server.py
def test_post_gate_sets_step_gate(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/gate", json={"track": "kick", "step": 1, "value": 50})
    assert resp.status_code == 200
    assert resp.json()["track"] == "kick"
    assert resp.json()["step"] == 1
    assert resp.json()["value"] == 50
```

Run to confirm it fails:
```
pytest tests/test_server.py::test_post_gate_sets_step_gate -v
```
Expected: FAIL (404)

Add to `api/schemas.py`:

```python
class GateRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=32)   # 1-indexed; max 32 for longest pattern
    value: int = Field(..., ge=0, le=100)


class GateResponse(BaseModel):
    track: str
    step: int
    value: int
```

Add to `api/server.py` (after `/vel` endpoint):

```python
@app.post("/gate", response_model=GateResponse)
async def set_gate(req: GateRequest):
    step_0 = req.step - 1  # convert to 0-indexed
    pattern = apply_gate_step(_state.current_pattern, req.track, step_0, req.value)
    _state.update_pattern(pattern)
    _player.queue_pattern(pattern)
    _bus.emit("gate_changed", {"track": req.track, "step": req.step, "value": req.value})
    return GateResponse(track=req.track, step=req.step, value=req.value)
```

Import `apply_gate_step` from `cli.commands` at the top of `api/server.py` (add to existing import line).
Import `GateRequest, GateResponse` from `api.schemas`.

Run test to confirm it passes:
```
pytest tests/test_server.py::test_post_gate_sets_step_gate -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/commands.py api/schemas.py api/server.py tests/test_commands.py tests/test_server.py
git commit -m "feat(CP3): per-step gate — apply_gate_step helper and POST /gate endpoint"
```

---

## Task 2: Per-step gate — Player execution

**Files:**
- Modify: `core/player.py`
- Test: `tests/test_player.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_player.py`:

```python
from unittest.mock import call as mock_call


def test_gate_under_100_sends_note_off():
    """A step with gate < 100 should trigger a note_off after a delay."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0

    # Give kick step 0 a gate of 50% so note_off is sent
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    pattern["gate"] = {k: [100] * 16 for k in TRACK_NAMES}
    pattern["gate"]["kick"][0] = 50
    state.current_pattern = pattern

    player.start()
    time.sleep(0.15)
    player.stop()

    # midi_utils.send_note sends [0x90 | channel, note, velocity]
    # For kick (channel 0, note 60 by default), a note_off is [0x90, 60, 0]
    kick_note_offs = [
        c for c in port.send_message.call_args_list
        if c[0][0] == [0x90, 60, 0]  # kick channel=0, note=60, velocity=0
    ]
    assert kick_note_offs, "Expected a note_off (velocity=0) for kick with gate=50"


def test_gate_100_does_not_send_note_off():
    """Default gate=100 should not send any note_off (preserves original behavior)."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    state.current_pattern = pattern  # no gate key = default 100

    call_count_before = port.send_message.call_count
    player.start()
    time.sleep(0.15)
    player.stop()
    call_count_after = port.send_message.call_count

    # All calls should be note_on (velocity > 0) or clock/start messages
    # Check that no zero-velocity note was sent for kick channel (channel 0)
    kick_channel = 0
    for c in port.send_message.call_args_list:
        args = c[0][0]  # first positional arg is the MIDI message list
        if len(args) >= 3 and (args[0] & 0xF0) == 0x90 and (args[0] & 0x0F) == kick_channel:
            assert args[2] != 0, "Unexpected note_off found for kick with gate=100"
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_player.py::test_gate_under_100_sends_note_off tests/test_player.py::test_gate_100_does_not_send_note_off -v
```
Expected: FAIL (first test: no note_off sent; second test may pass accidentally)

- [ ] **Step 3: Update `Player._play_step()` to schedule note_off for gate < 100**

In `core/player.py`, add `import threading` (already imported at top).

In `_play_step()`, after the `send_note` call for a playing step (around line 91), add:

```python
                try:
                    midi_utils.send_note(self.port, note, velocity, channel=TRACK_CHANNELS[track])
                except Exception:
                    self.bus.emit(
                        "midi_disconnected",
                        {"port": self.state.midi_port_name},
                    )
                    self._stop_event.set()
                    return

                # Schedule note_off if gate < 100
                gate_track = pattern.get("gate", {}).get(track)
                gate_pct = gate_track[step] if gate_track is not None else 100
                if gate_pct < 100:
                    note_off_delay = max(0.001, gate_pct / 100.0 * self._step_duration())
                    port_ref = self.port
                    note_ref = note
                    ch_ref = TRACK_CHANNELS[track]
                    def _send_off(p=port_ref, n=note_ref, ch=ch_ref):
                        try:
                            midi_utils.send_note(p, n, 0, channel=ch)
                        except Exception:
                            pass
                    threading.Timer(note_off_delay, _send_off).start()
```

- [ ] **Step 4: Run tests to confirm they pass**

```
pytest tests/test_player.py::test_gate_under_100_sends_note_off tests/test_player.py::test_gate_100_does_not_send_note_off -v
```
Expected: PASS

- [ ] **Step 5: Add `gate_changed` WebSocket handler to TUI**

In `tui/src/hooks/useDigitakt.ts`, add handler after `vel_changed`:

```typescript
case "gate_changed":
  // Gate is stored inside the pattern dict on the backend.
  // Re-fetch full state so current_pattern["gate"] is current.
  fetchState();
  break;
```

Add `/gate` action:

```typescript
setGate: (track: string, step: number, value: number) =>
  fetch(`${baseUrl}/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, step, value }),
  }),
```

- [ ] **Step 6: Add `/gate` command to `App.tsx`**

In `handleCommand()`, add after the `vel` case:

```typescript
case "gate": {
  // /gate <track> <step 1-16> <0-100>
  const [, trackArg, stepArg, valArg] = parts;
  const stepN = parseInt(stepArg ?? "", 10);
  const valN = parseInt(valArg ?? "", 10);
  if (!trackArg || isNaN(stepN) || isNaN(valN)) {
    addLog("Usage: /gate <track> <step> <0-100>");
    return;
  }
  actions.setGate(trackArg, stepN, valN)
    .catch(() => addLog("Error setting gate"));
  break;
}
```

- [ ] **Step 7: Commit**

```bash
git add core/player.py tui/src/hooks/useDigitakt.ts tui/src/App.tsx tests/test_player.py
git commit -m "feat(CP3): per-step gate — Player schedules note_off, TUI /gate command"
```

---

## Task 3: Track pitch control

**Files:**
- Modify: `core/state.py`
- Modify: `core/player.py`
- Modify: `api/schemas.py`
- Modify: `api/server.py`
- Modify: `tui/src/hooks/useDigitakt.ts`
- Modify: `tui/src/App.tsx`
- Test: `tests/test_player.py`, `tests/test_server.py`, `tests/test_state.py`

Currently all tracks use note 60 (`NOTE_MAP = {track: 60}`). `track_pitch` in `AppState` will override this per track.

- [ ] **Step 1: Write failing tests**

Add to `tests/test_state.py`:

```python
def test_track_pitch_defaults_to_60():
    state = AppState()
    from core.state import TRACK_NAMES
    for track in TRACK_NAMES:
        assert state.track_pitch[track] == 60
```

Add to `tests/test_player.py`:

```python
def test_player_uses_track_pitch():
    """When track_pitch[kick] = 48, the note sent for kick should be 48."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0
    state.track_pitch["kick"] = 48
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    state.current_pattern = pattern

    player.start()
    time.sleep(0.1)
    player.stop()

    # Check that a note_on with note=48 on channel 0 was sent
    found = False
    for c in port.send_message.call_args_list:
        args = c[0][0]
        if len(args) >= 3 and (args[0] & 0xF0) == 0x90 and (args[0] & 0x0F) == 0 and args[1] == 48 and args[2] > 0:
            found = True
            break
    assert found, "Expected note_on with pitch 48 for kick"
```

Add to `tests/test_server.py`:

```python
def test_post_pitch_sets_track_pitch(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/pitch", json={"track": "kick", "value": 48})
    assert resp.status_code == 200
    assert resp.json()["track"] == "kick"
    assert resp.json()["value"] == 48
    state_resp = client.get("/state")
    assert state_resp.json()["track_pitch"]["kick"] == 48
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_state.py::test_track_pitch_defaults_to_60 tests/test_player.py::test_player_uses_track_pitch tests/test_server.py::test_post_pitch_sets_track_pitch -v
```
Expected: `AttributeError: 'AppState' object has no attribute 'track_pitch'`

- [ ] **Step 3: Add `track_pitch` to `AppState`**

In `core/state.py`, add after `track_velocity`:

```python
    track_pitch: dict = field(default_factory=lambda: {
        track: 60 for track in TRACK_NAMES
    })
```

- [ ] **Step 4: Update `Player._play_step()` to use `track_pitch`**

In `core/player.py`, `_play_step()` currently reads:

```python
note = midi_utils.NOTE_MAP.get(track)
```

Change to:

```python
note = self.state.track_pitch.get(track, midi_utils.NOTE_MAP.get(track, 60))
```

- [ ] **Step 5: Add schemas and `POST /pitch` endpoint**

Add to `api/schemas.py`:

```python
class PitchRequest(BaseModel):
    track: str
    value: int = Field(..., ge=0, le=127)


class PitchResponse(BaseModel):
    track: str
    value: int
```

Add `track_pitch: dict` to `StateResponse` (after `track_velocity`):

```python
    track_pitch: dict = field(default_factory=dict)
```

Actually for Pydantic v2 BaseModel (not dataclass), use:

```python
class StateResponse(BaseModel):
    ...
    track_velocity: dict
    track_pitch: dict       # NEW
    swing: int = 0
    pattern_length: int = 16
```

In `api/server.py`, add `PitchRequest, PitchResponse` to schemas import.

Add endpoint after `/velocity`:

```python
@app.post("/pitch", response_model=PitchResponse)
async def set_pitch(req: PitchRequest):
    if req.track not in TRACK_NAMES:
        raise HTTPException(status_code=422, detail=f"Unknown track: {req.track}")
    _state.track_pitch[req.track] = req.value
    _bus.emit("pitch_changed", {"track": req.track, "value": req.value})
    return PitchResponse(track=req.track, value=req.value)
```

Import `TRACK_NAMES` from `core.state` in `api/server.py` (add to existing import).

Update `GET /state` to include `track_pitch=_state.track_pitch` in the `StateResponse(...)` call.

- [ ] **Step 6: Run tests to confirm they pass**

```
pytest tests/test_state.py::test_track_pitch_defaults_to_60 tests/test_player.py::test_player_uses_track_pitch tests/test_server.py::test_post_pitch_sets_track_pitch -v
```
Expected: PASS

- [ ] **Step 7: Add pitch state and events to TUI**

In `tui/src/hooks/useDigitakt.ts`:

Add `track_pitch` to the default state (initialize with `{kick:60, ...}` for all 8 tracks, or just `{}` and populate from `/state` on connect).

Add a `pitch_changed` WebSocket handler after `velocity_changed`:

```typescript
case "pitch_changed":
  setState(s => ({
    ...s,
    track_pitch: { ...s.track_pitch, [data.track as string]: data.value as number },
  }));
  addLog(`Pitch ${data.track}: ${data.value}`);
  break;
```

In `fetchState()`, add `track_pitch: d.track_pitch ?? {}` to the `setState` call.

Add `setPitch` action:

```typescript
setPitch: (track: string, value: number) =>
  fetch(`${baseUrl}/pitch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, value }),
  }),
```

- [ ] **Step 8: Add `/pitch` command to `App.tsx`**

In `handleCommand()`, add after the `velocity` or `cc` section:

```typescript
case "pitch": {
  // /pitch <track> <0-127>
  const [, trackArg, valArg] = parts;
  const valN = parseInt(valArg ?? "", 10);
  if (!trackArg || isNaN(valN) || valN < 0 || valN > 127) {
    addLog("Usage: /pitch <track> <0-127>");
    return;
  }
  setState(s => ({
    ...s,
    track_pitch: { ...s.track_pitch, [trackArg]: valN },
  }));
  actions.setPitch(trackArg, valN);
  break;
}
```

- [ ] **Step 9: Commit**

```bash
git add core/state.py core/player.py api/schemas.py api/server.py tui/src/hooks/useDigitakt.ts tui/src/App.tsx tests/test_state.py tests/test_player.py tests/test_server.py
git commit -m "feat(CP3): track pitch control — AppState, Player, POST /pitch, TUI /pitch command"
```

---

## Task 4: Conditional trigs

Supported conditions: `"1:2"` (fires on every 2nd loop, starting loop 0), `"not:2"` (fires on every loop except 2nd), `"fill"` (fires only when `AppState._fill_active` is True — requires CP2). A step with `null` condition always fires (default behavior).

**Files:**
- Modify: `core/player.py`
- Modify: `cli/commands.py`
- Modify: `api/schemas.py`
- Modify: `api/server.py`
- Modify: `tui/src/hooks/useDigitakt.ts`
- Modify: `tui/src/App.tsx`
- Modify: `tui/src/components/PatternGrid.tsx`
- Test: `tests/test_player.py`, `tests/test_commands.py`, `tests/test_server.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_commands.py`:

```python
from cli.commands import apply_cond_step


def test_apply_cond_step_sets_condition():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    result = apply_cond_step(pattern, "kick", 0, "1:2")
    assert result["cond"]["kick"][0] == "1:2"


def test_apply_cond_step_clears_condition():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["cond"] = {"kick": ["1:2"] + [None] * 15}
    result = apply_cond_step(pattern, "kick", 0, None)
    assert result["cond"]["kick"][0] is None


def test_apply_cond_step_rejects_unknown_condition():
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    import pytest
    with pytest.raises(ValueError):
        apply_cond_step(pattern, "kick", 0, "bogus")
```

Add to `tests/test_player.py`:

```python
def test_condition_1_2_fires_on_even_loops():
    """A step with condition '1:2' should fire on loop 0, 2, 4 but not 1, 3."""
    player, state, bus, port = _make_player()
    state.bpm = 9000.0
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    pattern["kick"][0] = 100
    pattern["cond"] = {k: [None] * 16 for k in TRACK_NAMES}
    pattern["cond"]["kick"][0] = "1:2"
    state.current_pattern = pattern

    loop_note_counts: list[int] = []

    player.start()
    # Let 4 loops complete at 9000 BPM and count note_on calls per loop
    # Instead of timing, record all note_on calls and check parity via _loop_count
    time.sleep(0.3)
    player.stop()

    # We can't directly inspect loop count from outside, but we can verify
    # that port.send_message was called an even number of times for kick note_on
    kick_note_ons = [
        c for c in port.send_message.call_args_list
        if len(c[0][0]) >= 3
        and (c[0][0][0] & 0xF0) == 0x90
        and (c[0][0][0] & 0x0F) == 0   # kick channel
        and c[0][0][2] > 0              # velocity > 0
        and c[0][0][1] == state.track_pitch.get("kick", 60)
    ]
    # With 4+ loops and 1:2 condition, should fire ~half the loops
    total_loops_approx = 4
    assert len(kick_note_ons) <= total_loops_approx // 2 + 1  # at most half + 1 for rounding
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pytest tests/test_commands.py::test_apply_cond_step_sets_condition tests/test_commands.py::test_apply_cond_step_clears_condition tests/test_commands.py::test_apply_cond_step_rejects_unknown_condition -v
```
Expected: `ImportError` — `apply_cond_step` does not exist

- [ ] **Step 3: Implement `apply_cond_step` in `cli/commands.py`**

```python
_VALID_CONDITIONS = frozenset({"1:2", "not:2", "fill"})


def apply_cond_step(pattern: dict, track: str, step: int, value: str | None) -> dict:
    """Set or clear a conditional trig on a step. value must be '1:2', 'not:2', 'fill', or None."""
    if value is not None and value not in _VALID_CONDITIONS:
        raise ValueError(f"Unknown condition '{value}'. Valid: {sorted(_VALID_CONDITIONS)}")
    pattern = dict(pattern)
    length = len(pattern.get("kick", [None] * 16))
    if "cond" not in pattern:
        pattern["cond"] = {t: [None] * length for t in TRACK_NAMES}
    pattern["cond"] = dict(pattern["cond"])
    pattern["cond"][track] = list(pattern["cond"][track])
    pattern["cond"][track][step] = value
    return pattern
```

- [ ] **Step 4: Run `apply_cond_step` tests to confirm they pass**

```
pytest tests/test_commands.py::test_apply_cond_step_sets_condition tests/test_commands.py::test_apply_cond_step_clears_condition tests/test_commands.py::test_apply_cond_step_rejects_unknown_condition -v
```
Expected: PASS

- [ ] **Step 5: Add `_loop_count` to Player and condition evaluation in `_play_step`**

In `core/player.py`, add `self._loop_count: int = 0` in `__init__` (after `self._stop_event`):

```python
        self._loop_count: int = 0
```

In `_loop()`, at the very end (after the fill logic), add:

```python
            self._loop_count += 1
```

In `_play_step()`, add condition check before the `velocity > 0` check. After the probability check (around line 85), add:

```python
            # Check conditional trig
            cond_track = pattern.get("cond", {}).get(track)
            if cond_track is not None:
                cond = cond_track[step]
                if cond == "1:2" and self._loop_count % 2 != 0:
                    continue
                elif cond == "not:2" and self._loop_count % 2 == 0:
                    continue
                elif cond == "fill" and not self.state._fill_active:
                    continue
```

The `_loop_count` is read inside `_play_step`, but it lives on `self`. No extra parameter needed.

- [ ] **Step 6: Run the condition player test**

```
pytest tests/test_player.py::test_condition_1_2_fires_on_even_loops -v
```
Expected: PASS

- [ ] **Step 7: Add `CondRequest` schema and `POST /cond` endpoint**

Write failing test:

```python
# tests/test_server.py
def test_post_cond_sets_step_condition(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/cond", json={"track": "kick", "step": 1, "value": "1:2"})
    assert resp.status_code == 200
    assert resp.json()["track"] == "kick"
    assert resp.json()["value"] == "1:2"


def test_post_cond_clears_step_condition(tmp_path):
    client = _make_test_client(tmp_path)
    client.post("/cond", json={"track": "kick", "step": 1, "value": "1:2"})
    resp = client.post("/cond", json={"track": "kick", "step": 1, "value": None})
    assert resp.status_code == 200
    assert resp.json()["value"] is None
```

Run to confirm failure:
```
pytest tests/test_server.py::test_post_cond_sets_step_condition tests/test_server.py::test_post_cond_clears_step_condition -v
```

Add to `api/schemas.py`:

```python
class CondRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=32)   # 1-indexed
    value: str | None = None              # None = clear condition


class CondResponse(BaseModel):
    track: str
    step: int
    value: str | None
```

Add to `api/server.py` (after `/gate`), importing `apply_cond_step` and the new schemas:

```python
@app.post("/cond", response_model=CondResponse)
async def set_cond(req: CondRequest):
    if req.value is not None and req.value not in ("1:2", "not:2", "fill"):
        raise HTTPException(status_code=422, detail=f"Invalid condition '{req.value}'")
    step_0 = req.step - 1
    pattern = apply_cond_step(_state.current_pattern, req.track, step_0, req.value)
    _state.update_pattern(pattern)
    _player.queue_pattern(pattern)
    _bus.emit("cond_changed", {"track": req.track, "step": req.step, "value": req.value})
    return CondResponse(track=req.track, step=req.step, value=req.value)
```

Run tests to confirm they pass:
```
pytest tests/test_server.py::test_post_cond_sets_step_condition tests/test_server.py::test_post_cond_clears_step_condition -v
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add core/player.py cli/commands.py api/schemas.py api/server.py tests/test_player.py tests/test_commands.py tests/test_server.py
git commit -m "feat(CP3): conditional trigs — 1:2, not:2, fill; loop counter in Player; POST /cond"
```

---

## Task 5: Conditional trigs — TUI

**Files:**
- Modify: `tui/src/hooks/useDigitakt.ts`
- Modify: `tui/src/App.tsx`
- Modify: `tui/src/components/PatternGrid.tsx`

- [ ] **Step 1: Add `cond_changed` handler and actions to `useDigitakt.ts`**

Add `cond_changed` WebSocket handler after `gate_changed`:

```typescript
case "cond_changed":
  fetchState();  // refetch to get updated pattern["cond"]
  break;
```

Add `setCond` action:

```typescript
setCond: (track: string, step: number, value: string | null) =>
  fetch(`${baseUrl}/cond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, step, value }),
  }),
```

- [ ] **Step 2: Add `/cond` command to `App.tsx`**

In `handleCommand()`, add after `/gate`:

```typescript
case "cond": {
  // /cond <track> <step 1-32> <1:2|not:2|fill|clear>
  const [, trackArg, stepArg, condArg] = parts;
  const stepN = parseInt(stepArg ?? "", 10);
  if (!trackArg || isNaN(stepN) || !condArg) {
    addLog("Usage: /cond <track> <step> <1:2|not:2|fill|clear>");
    return;
  }
  const condValue = condArg === "clear" ? null : condArg;
  if (condValue !== null && !["1:2", "not:2", "fill"].includes(condValue)) {
    addLog("Condition must be: 1:2, not:2, fill, or clear");
    return;
  }
  actions.setCond(trackArg, stepN, condValue)
    .catch(() => addLog("Error setting condition"));
  break;
}
```

- [ ] **Step 3: Show conditional markers in `PatternGrid.tsx`**

In `PatternGrid.tsx`, the component currently receives `pattern` (velocities only). To show conditions, it also needs `pattern["cond"]`. Pass the full pattern object (or just `condMap`) as an additional prop:

```typescript
// Add to Props type:
condMap?: Record<string, (string | null)[]>;  // pattern["cond"]
```

In the cell render logic, change the marker character for steps that have a condition set. Currently it renders `●` for active steps. Change to render `◆` when a condition is set:

```typescript
const cond = condMap?.[trackName]?.[i];
const hasCond = cond != null;
const marker = velocity > 0
  ? (hasCond ? "◆" : "●")
  : (hasCond ? "◇" : "·");
```

In `App.tsx`, pass `condMap={state.current_pattern?.cond}` to `<PatternGrid>`.

- [ ] **Step 4: Commit**

```bash
git add tui/src/hooks/useDigitakt.ts tui/src/App.tsx tui/src/components/PatternGrid.tsx
git commit -m "feat(CP3): TUI /cond command and conditional trig markers in PatternGrid"
```

---

## Task 6: SysEx investigation

**Files:**
- Create: `docs/sysex-investigation.md`

- [ ] **Step 1: Research Digitakt SysEx**

Look up the Elektron Digitakt MIDI SysEx specification. Key sources:
- Elektron's official Digitakt MIDI implementation chart (downloadable from elektron.se)
- Community resources: lines.llll.ee, elektronauts.com

Key questions to investigate:
1. Does the Digitakt accept SysEx pattern dumps (import/export)?
2. Can pattern data be sent/received via SysEx (alternative to step-by-step CC)?
3. Are there undocumented SysEx messages known to the community?
4. Does Overbridge expose SysEx access?
5. What USB MIDI class compliance level does the Digitakt operate at?

- [ ] **Step 2: Write investigation notes**

Create `docs/sysex-investigation.md` with the following structure:

```markdown
# Digitakt SysEx Investigation

## Summary

[1-paragraph summary of findings]

## Protocol Support

| Feature | Supported | Notes |
|---------|-----------|-------|
| Pattern dump (send/receive) | TBD | |
| Sample management | TBD | |
| Project backup | TBD | |
| Real-time parameter change | TBD | |

## Known SysEx Messages

[Document any confirmed messages with format]

## Community Findings

[Links to relevant forum threads]

## Overbridge

[Notes on whether Overbridge exposes SysEx or provides a higher-level API]

## Recommendation for CP4+

[Whether SysEx is worth pursuing and what for]
```

- [ ] **Step 3: Commit**

```bash
git add docs/sysex-investigation.md
git commit -m "docs(CP3): SysEx investigation notes"
```

---

## Task 7: Full suite + docs

- [ ] **Step 1: Run full test suite**

```
pytest -v
```
Expected: all tests pass

- [ ] **Step 2: Update `CLAUDE.md`**

Under "Key endpoints", add:
- `POST /gate` — set per-step gate (0–100% of step duration)
- `POST /pitch` — set per-track MIDI note pitch (0–127)
- `POST /cond` — set conditional trig on a step (1:2 / not:2 / fill / null)

Under commands, add:
- `/gate <track> <step> <0-100>` — set note gate length
- `/pitch <track> <0-127>` — set MIDI note number for track
- `/cond <track> <step> <1:2|not:2|fill|clear>` — set/clear conditional trig

- [ ] **Step 3: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs(CP3): update CLAUDE.md with gate, pitch, cond endpoints and commands"
```

---

## Verification

1. `pytest -v` — all tests pass
2. Launch: `digitakt`
3. `/pitch kick 48` — kick plays at note 48 (lower pitch)
4. `/pitch bell 72` — bell plays at note 72 (higher octave)
5. `/cond snare 5 1:2` — snare on step 5 fires every other loop; PatternGrid shows `◆` on that step
6. `/cond snare 5 clear` — reverts to normal; marker back to `●`
7. `/save fill1` → `/fill fill1` — activate a fill; steps with `fill` condition fire only during fill
8. `/gate kick 1 25` — kick step 1 gate 25%; note_off fires quickly after note_on
9. `gate 100` behavior: no note_off scheduled (default behavior preserved)
10. Check `docs/sysex-investigation.md` exists with research notes
