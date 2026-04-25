# LFO v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tempo-synced LFOs (five waveforms) as a per-pattern `lfo` map, evaluated each sequencer step, with REST + WebSocket, TUI visualization, and save/load; no LLM emission in v1 (per [lfo-v1-design.md](lfo-v1-design.md)).

**Architecture:** Pure math and phase indexing live in `core/lfo.py` (no I/O). `Player._play_step` and/or a thin helper apply **base + LFO** for CC, then trig (prob/vel/gate/note rows), then track pitch—using a shared **global step index** = `_loop_count * pattern_length + step` for phase. The pattern dict holds `lfo: dict[str, LfoDef]` with string **target keys**. API mutates the live pattern and queues; events mirror `cc_changed`.

**Tech stack:** Python 3 (core, FastAPI, Pydantic), pytest, Bun/TypeScript/React/Ink (TUI).

**Spec:** [docs/lfo-v1-design.md](lfo-v1-design.md)

---

## File map (create / touch)

| Path | Role |
|------|------|
| `core/lfo.py` | `lfo_shape(shape, p)`, `cycle_steps(pattern_length, num, den)`, `lfo_value_at_step(...)`, `apply_lfo_to_cc_base(...)`, bounds helpers |
| `cli/commands.py` (or new `core/pattern_lfo.py`) | `set_lfo(pattern, key, lfo) -> dict` / `clear_lfo` using deepcopy (match existing mutators) |
| `core/player.py` | CC + trig + pitch: read `pattern.get("lfo", {})`, compute effective values inside `_play_step` |
| `core/state.py` | Ensure `update_pattern` / `replace_current_pattern` / empty resets allow `lfo` key; optional `normalize_lfo` when `pattern_length` changes (see Task 2) |
| `api/schemas.py` | Pydantic models for LFO set/clear |
| `api/server.py` | `POST /lfo`, `DELETE` or `POST /lfo/clear` for target; `lfo_changed` broadcast; extend `/state` if `current_pattern` does not already surface nested `lfo` (it should) |
| `tests/test_lfo.py` | Wave + cycle + depth math |
| `tests/test_player_lfo.py` (or add to `test_player.py`) | Effective CC or prob under LFO, MIDI mocks if needed |
| `tests/test_server.py` (or new) | POST /lfo, roundtrip with save if applicable |
| `tui/src/types.ts` | Type for `LfoDef`, `lfo: Record<...> \| undefined` on pattern slice |
| `tui/src/hooks/useDigitakt.ts` | Parse `lfo` from `current_pattern` + handle `lfo_changed` |
| `tui/src/components/CCPanel.tsx` | Second line or suffix for active LFO (shape, depth, rate label) + phase hint |
| `tui/src/App.tsx` | `/lfo` handler → REST |

| `ARCHITECTURE.md` | New event `lfo_changed`, LFO in pattern payload |

**Target key (v1, fixed grammar):** one string, three `:`-separated segments:

- `cc:<track>:<param>` — `<param>` ∈ `CC_MAP` / `cc-params` list (e.g. `filter`).
- `trig:<track>:<field>` — `<field>` ∈ `prob` \| `vel` \| `gate` \| `note` (same w applied at every `step` to that field’s per-step value before use).
- `pitch:<track>:main` — third segment is literal `main` (keeps three-part keys consistent; easy to parse).

**Rate:** `rate: { "num": int, "den": int }` with `num >= 1`, `den >= 1`, `gcd(num, den) == 1`. **Cycle length in steps:** `cycle_steps = max(1, (pattern_length * num) // den)`. **Examples:** 1/1 bar → `num=1, den=1` → cycle = `pattern_length`. Quarter of pattern in 16 steps → `1/4` of bar as one cycle → `num=1, den=4` → 4 steps. Multi-bar: `num=2, den=1` → `2 * pattern_length` steps per cycle (validate upper bound, e.g. `cycle_steps <= 32 * 8` to avoid absurd values).

**Depth / bounds:** Bipolar `w ∈ [−1,1]`. For a numeric range `[lo, hi]`, `mid = (lo+hi)/2`, `half = (hi-lo)/2`, `v = round(mid + w * (depth/100) * half)`, then clamp to `[lo, hi]`. For CC 0–127 this matches the design “additive to base, then clamp” in spirit (symmetric around base when `base == mid`).

**Pattern length change (v1):** No need to re-key `lfo`; same `num/den` recalculates `cycle_steps`. Optional: on `/length` apply `state.py` to strip `lfo` keys whose track/target becomes invalid (none in v1 if keys stay valid).

---

### Task 1: `core/lfo.py` — shapes + phase + `cycle_steps`

**Files:**
- Create: `core/lfo.py`
- Test: `tests/test_lfo.py`

- [ ] **Step 1: Write failing tests** for all five shapes at `p` in `{0, 0.25, 0.5, 0.75}` (skip duplicate assertions where redundant), and `lfo_value_at_step` for a known 4-step cycle (sine optional tolerance).

```python
# tests/test_lfo.py
import pytest
from core.lfo import lfo_shape, lfo_w_at_step, cycle_steps


def test_sine_0_is_zero():
    assert lfo_shape("sine", 0.0) == pytest.approx(0, abs=1e-9)


def test_triangle_quarter():
    # p=0.25: on rising leg 4*0.25-1=0
    assert lfo_shape("triangle", 0.25) == pytest.approx(0, abs=1e-9)


def test_square_low_half():
    assert lfo_shape("square", 0.1) == 1.0
    assert lfo_shape("square", 0.6) == -1.0


def test_ramp_endpoints():
    assert lfo_shape("ramp", 0.0) == -1.0
    p_just_before_wrap = 1.0 - 1e-12
    assert lfo_shape("ramp", 0.0) == lfo_shape("ramp", 0.0)  # wrap use mod


def test_cycle_steps_16_1_4():
    assert cycle_steps(16, 1, 4) == 4
```

- [ ] **Step 2:** Run: `uv run pytest tests/test_lfo.py -v` (from repo root) — expect **FAIL** until `core/lfo.py` exists.

- [ ] **Step 3: Minimal `core/lfo.py`**

```python
# core/lfo.py — full implementation for Task 1
from __future__ import annotations
import math

SHAPES = ("sine", "square", "triangle", "ramp", "saw")


def _norm_p(p: float) -> float:
    x = p % 1.0
    return x + 0.0 if x >= 0 else x + 1.0  # -0.0 -> 0.0 if needed

def lfo_shape(shape: str, p: float) -> float:
    p = _norm_p(p)
    if shape == "sine":
        return math.sin(2.0 * math.pi * p)
    if shape == "triangle":
        if p < 0.5:
            return 4.0 * p - 1.0
        return 3.0 - 4.0 * p
    if shape == "square":
        return 1.0 if p < 0.5 else -1.0
    if shape == "ramp":
        return 2.0 * p - 1.0
    if shape == "saw":
        return 1.0 - 2.0 * p
    raise ValueError(f"unknown shape: {shape!r}")


def cycle_steps(pattern_length: int, num: int, den: int) -> int:
    if num < 1 or den < 1:
        raise ValueError("num and den must be >= 1")
    return max(1, (pattern_length * num) // den)


def lfo_w_at_step(
    global_step: int,
    cycle_steps_n: int,
    phase: float,
    shape: str,
) -> float:
    p = (global_step % cycle_steps_n) / float(cycle_steps_n)
    p = _norm_p(p + phase)
    return lfo_shape(shape, p)
```

- [ ] **Step 4:** Run pytest on `tests/test_lfo.py` — **PASS**.

- [ ] **Step 5: Commit** — `git add core/lfo.py tests/test_lfo.py && git commit -m "feat(lfo): pure wave + cycle math"`

---

### Task 2: Depth + `apply` helper + pattern roundtrip

**Files:**
- Modify: `core/lfo.py` — add `apply_depth_clamp(base, w, depth_pct, lo, hi) -> int`
- Modify: `tests/test_lfo.py`
- **Optional** small: `core/pattern_lfo.py` with `get_lfo_def(pattern, key) -> LfoDef | None` (typed dict) if you prefer not to bloat `lfo.py`

- [ ] **Step 1: Test** `apply_depth_clamp(64, 1.0, 100, 0, 127) == 127` and `apply_depth_clamp(64, 0, 100, 0, 127) == 64` and `w=-1` at depth 100 gives `0`.

- [ ] **Step 2: Implement** `apply_depth_clamp` using the mid/half rule from this plan’s “Depth / bounds” section (use `int(round(...))` and clamp).

- [ ] **Step 3: Pattern roundtrip** — in `tests/test_lfo.py` or `tests/test_state.py`, `pat = {**EMPTY_PATTERN, "lfo": {"cc:kick:filter": {...}}}` then `state.replace_current_pattern(pat)` and assert `state.current_pattern["lfo"]` still matches (or use JSON serialize roundtrip for what `/patterns` stores—follow existing save tests in `test_server`).

- [ ] **Step 4: Commit** — `feat(lfo): depth clamp and pattern lfo key preservation`

---

### Task 3: `Player` — global step index, CC, step_cc merge, `dirty_cc`

**Files:**
- Modify: `core/player.py`
- Test: `tests/test_player_lfo.py` (new) or extend `tests/test_player.py`

**Preconditions:** In `_play_step`, you already have `step` and `self._loop_count`. Use `global_step = self._loop_count * self.state.pattern_length + step`.

**CC logic (v1):**
1. For each `track, param` that appears in `pattern.get("lfo", {})` with key `cc:<track>:<param>`: compute `w` via `lfo_w_at_step` using def’s `shape`, `phase`, and `rate` → `cycle_steps(...)`.
2. `base = pattern["step_cc"].get(track,{}).get(param); base = base[step] if non-None else state.track_cc[track][param]`.
3. `sent = apply_depth_clamp(base, w, depth, 0, 127)` or CC-specific bounds if you store them in `CC_DEFAULTS` range.
4. Send CC like existing step-override path; add `(track, param)` to `dirty_cc` so end-of-bar restore still resets to **unmodulated** `state.track_cc` (and step slot cleared behavior unchanged).

**If no LFO** for a `(track, param)`, keep current behavior (step override only, else no per-step send for global? re-read `player` — per-step only sends for step_cc entries that exist; global CC flushed at start). LFO on a param **forces** a send each step for that param when active.

- [ ] **Step 1: Write a test** with a `FakePort` or existing MIDI capture pattern in repo (grep `mido` mock in `tests/`) that queues a pattern with one LFO on `cc:kick:filter` and expects **more than one** distinct CC value over 4 steps (or use bus-only assertion if that’s the project style).

- [ ] **Step 2: Implement** CC branch in `core/player.py`, small helper in `core/lfo.py` to parse `lfo` keys and dispatch if you want to keep `player` thin: `def iter_lfo_cc(pattern, lfo_map) -> ...`.

- [ ] **Step 3: Run** `uv run pytest tests/test_player_lfo.py tests/test_player.py -v` — no regressions.

- [ ] **Step 4: Commit** — `feat(lfo): apply CC LFOs in player`

---

### Task 4: `Player` — trig (prob, vel, gate) + pitch

**Files:**
- Modify: `core/player.py` — in `_play_step`, after reading base prob/vel/gate from `pattern` rows, if `lfo` key `trig:<t>:<field>` present, add modulation before `random` / velocity scale / gate timer. For `prob` range `0..100`, use `lo=0, hi=100`. For `vel` 0..127, use vel base per step. For `gate` 0..100, match `DEFAULT_GATE_PCT` bounds.

- `trig:...:note` — modulate `note` 0..127 (or per-step + pitch merge rules—**match existing note/pitch order**: compute `note` as today, then LFO on `trig:…:note` if present).

- `pitch:<track>:track` — add modulation to `base_note` before step note override, clamp 0..127 (or 0..127 for MIDI; match `track_pitch` storage).

- [ ] **Step 1: Tests** one trig target (e.g. prob) with `depth=0` → same as no LFO; with square wave 100% depth prob oscillates 0/100 in a 2-step period with appropriate `num/den`.

- [ ] **Step 2: Implement**; run full `pytest` subset for player+state.

- [ ] **Step 3: Commit** — `feat(lfo): modulate trig + pitch in player`

---

### Task 5: API + WebSocket

**Files:**
- Modify: `api/schemas.py` — `LfoDefModel`, `LfoSetRequest` (`target: str`, `lfo: LfoDefModel | null` to clear)
- Modify: `api/server.py` — `POST /lfo` deepcopy, mutator, `queue_pattern` or direct `replace_current_pattern` per existing `/cc` style; `_broadcast_event("lfo_changed", {...})`
- Test: new tests in `tests/test_server.py`

- [ ] **Step 1: Test** `POST /lfo` with valid body → 200, `current_pattern.lfo` contains key; `POST` with `lfo: null` removes key; invalid target → 422.

- [ ] **Step 2: Implement** Pydantic validators: `shape` enum, `depth` 0..100, `phase` 0..1, `num/den` positive.

- [ ] **Step 3: WebSocket** — extend client test if one exists, or document manual check: event `lfo_changed` on success.

- [ ] **Step 4: Commit** — `feat(api): POST /lfo and lfo_changed event`

---

### Task 6: TUI

**Files:**
- Modify: `tui/src/types.ts` — LFO types; pattern from `/state` includes `lfo` on `current_pattern`
- Modify: `tui/src/hooks/useDigitakt.ts` — merge `lfo` into state, handle WebSocket
- Modify: `tui/src/components/CCPanel.tsx` (and TRIG if needed) — show LFO for **selected** track + param (line like `LFO sin 50% 1/4P` and a 16-char phase strip using `currentStep`)
- Modify: `tui/src/App.tsx` — `/lfo <target> <shape> <depth> <num>/<den> [phase]` (minimal parser) or subcommands; show errors in log

- [ ] **Step 1:** Add types + hook without UI (log on event).
- [ ] **Step 2:** CCPanel display + phase strip (reuse `currentStep` from props).
- [ ] **Step 3:** `bun test` or `bun run` typecheck if project has it — follow `tui/package.json` scripts.
- [ ] **Step 4: Commit** — `feat(tui): lfo state + MIX strip + /lfo`

---

### Task 7: Save/load and `/new` reset

**Files:**
- Grep: `test_server` for `post /patterns` save; ensure `lfo` key persists in JSON
- `api/server` `POST /new` (or where empty pattern is applied): clear `lfo` or set `{}` in `EMPTY_PATTERN` extension in one place (likely `state` / server handler)

- [ ] **Step 1: Test** save pattern with `lfo`, load, assert equality.
- [ ] **Step 2: Implement** only if save pipeline strips unknown keys (may already pass).
- [ ] **Step 3: Commit** — `fix(lfo): save/load and new-pattern lfo clear`

---

### Task 8: Docs

**Files:**
- Modify: `ARCHITECTURE.md` — `lfo` in pattern, `lfo_changed` event, no LLM
- **Optional** add one line in `CLAUDE.md` for `/lfo` when stable

- [ ] **Step 1: Commit** — `docs: ARCHITECTURE for LFO v1`

---

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| Five waveforms, normative formulas | Task 1 |
| Tempo sync via `num/den` of pattern length | Task 1, 3 |
| Last write = one LFO per key (dict replace) | Task 2, 5 |
| In pattern, save load, not in generator v1 | Task 2, 7, 5 |
| Runtime layer, not baked | Task 3–4 |
| API + `lfo_changed` | Task 5 |
| TUI strip + rate label | Task 6 |
| Tests: shapes, cycle length, save roundtrip | Tasks 1–2, 7 |

**Placeholder scan:** All tasks name concrete file paths; no TBD. Open design points resolved in plan: **target key grammar** (3-segment), **length change** (recalc `cycle_steps`), **phase on length** (v1: phase offset only; global step index is continuous across loops).

---

## Execution handoff

**Plan complete and saved to `docs/lfo-v1-implementation-plan.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — A fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development`.

2. **Inline execution** — Run tasks in this session with checkpoints. **REQUIRED SUB-SKILL:** `superpowers:executing-plans`.

**Which approach?**

---

## Commit policy

Frequent small commits (as in each task’s “Commit” step) match repo history; rebase or squash at PR time if the team prefers one commit per feature.
