# Design: Activity Panel Toggle, Agent BPM Auto-Apply, `/randbeat`

**Date:** 2026-04-09  
**Status:** Approved

---

## Context

Three UX/feature improvements to the Digitakt LLM TUI:

1. The event log is always visible as a cramped 8-line strip — it should be hidden by default and openable as a full-height right panel.
2. The agent already infers BPM from natural language prompts (subgenre ranges are in the system prompt), but the returned BPM is never applied to the player — the user must type `/bpm` manually.
3. There's no way to generate a structurally valid random techno beat without the LLM — useful for instant inspiration or when offline.

---

## Feature 1: Activity Panel Toggle (`/log`)

### What changes

The existing `RichLog` event log widget moves from its fixed 8-line bottom strip into the right column of the top layout row. By default it is hidden; `/log` swaps it with the CC panel.

### Layout

**Default (log hidden):**
```
┌─────────────────────────┬─────────────┐
│ PatternPanel (2fr)      │ CcPanel(1fr)│
│                         │             │
└─────────────────────────┴─────────────┘
> input
```

**Log open:**
```
┌─────────────────────────┬─────────────┐
│ PatternPanel (2fr)      │ ActivityPanel│
│                         │ (1fr, full  │
│                         │  height)    │
└─────────────────────────┴─────────────┘
> input
```

### Implementation

- **`cli/tui.py`**: Add `_log_visible: reactive(False)` to `DigitaktApp`
- In `compose()`, put both `CcPanel` and a renamed `ActivityPanel` (wrapping the existing `RichLog`) in the right-column slot — `CcPanel` visible by default, `ActivityPanel` `display: none`
- `watch__log_visible()` toggles `display` on both widgets
- Add `/log` to `_slash_handlers` → `_cmd_log()`; handler flips `_log_visible`
- `ActivityPanel` CSS: `height: 100%`, `border: solid $primary`, matches existing panel styling

### No new event/state logic needed

The `RichLog` already receives all log calls from `self._log()`. Only layout and visibility change.

---

## Feature 2: Agent Auto-Applies BPM

### What changes

One line in `cli/tui.py`: in the `generation_complete` event handler, if the event data includes a `bpm`, call `self._player.set_bpm(bpm)`.

The generator (`core/generator.py`) already:
- Has subgenre BPM ranges in the system prompt (detroit 130–138, industrial/hard techno 142–155, etc.)
- Extracts `bpm` from Claude's JSON response and returns it in the event
- The system prompt handles "fast industrial techno" → infers ~148–155 BPM

The handler currently queues the pattern but ignores `bpm`. After this fix, BPM is applied automatically on every generation, just like pattern and swing are.

### Testing requirements

- Unit test: `generation_complete` event with a `bpm` value calls `player.set_bpm()` with that value
- Unit test: `generation_complete` event without `bpm` does NOT call `player.set_bpm()` (no default override)
- Unit test: BPM in valid range (20–400) is accepted; outside range raises/is clamped (match existing player validation)
- Integration: generate with prompt "fast industrial techno" → BPM header updates to 142–155 range
- Integration: generate with prompt "minimal techno" → BPM header updates to 130–136 range

---

## Feature 3: `/randbeat` — Fully Random Techno Beat

### What changes

New function `generate_random_beat()` in `cli/commands.py`, and a new `/randbeat` slash command in `cli/tui.py`.

### Pattern generation logic

`generate_random_beat()` returns `(pattern: dict, bpm: int, swing: int)`:

**BPM:** `random.randint(128, 160)`

**Swing:** `random.randint(0, 30)`

**Kick** (steps are 0-indexed internally):
- Steps 0, 4, 8, 12 always on (4-on-the-floor), velocity 90–127
- 0–2 additional random steps, velocity 60–90
- Remaining steps: 0

**Snare:**
- Steps 4 and 12 always on, velocity 90–127
- 0–3 ghost notes on random other steps, velocity 15–45
- Remaining steps: 0

**Hihat:**
- Choose one pattern: 8th notes (even steps: 0,2,4,...14) or 16th notes (all steps)
- Each active step: velocity `random.randint(40, 100)`
- 2–4 steps have boosted velocity (80–110) for accent feel

**Openhat:**
- 1–3 hits, not on kick steps 0/4/8/12, velocity 60–90

**Clap:**
- 0–2 hits, velocity 50–90

**Tom, bell, cymbal:**
- 0–2 hits each, velocity 30–80

**CC (all 8 tracks):**
```
filter:    random in [40, 110]
resonance: random in [20, 80]
decay:     random in [30, 100]
tune:      random in [58, 70]
reverb:    random in [0, 40]
delay:     random in [0, 30]
attack:    random in [0, 30]
volume:    100 (fixed — don't randomize output level)
```

### TUI wiring (`cli/tui.py`)

`_cmd_randbeat()`:
1. Calls `generate_random_beat()`
2. Calls `self._player.queue_pattern(pattern)`
3. Calls `self._player.set_bpm(bpm)`
4. Sets swing via same path as `/swing` command (updates pattern's `swing` key before queuing)
5. Applies CC via `self._state.update_cc(track, param, value)` for all tracks
6. Logs: `randbeat: {bpm} BPM, swing {swing}`
7. Emits event `random_beat_generated` with `{bpm, swing}`

Add `/randbeat` to `_slash_handlers` and to `/help` text.

### Testing requirements

- Unit test: `generate_random_beat()` always has kick on steps 0/4/8/12
- Unit test: `generate_random_beat()` always has snare on steps 4/12
- Unit test: BPM is always in [128, 160]
- Unit test: swing is always in [0, 30]
- Unit test: all CC values are within their defined ranges
- Unit test: all velocity values are in [0, 127]
- Unit test: pattern has all 8 expected track keys
- Unit test: `/randbeat` command updates player BPM (mock player, assert `set_bpm` called)

---

## Files to Modify

| File | Change |
|------|--------|
| `cli/tui.py` | Add `_log_visible` reactive, restructure right column, add `/log` and `/randbeat` handlers, fix `generation_complete` to apply BPM |
| `cli/commands.py` | Add `generate_random_beat()` |
| `tests/test_tui.py` | Tests for `/log` toggle, BPM auto-apply on generation, `/randbeat` command |
| `tests/test_commands.py` | Tests for `generate_random_beat()` structure, ranges, validity |

---

## Verification

1. Run `pytest -v` — all 133 existing tests must pass, new tests added
2. Launch TUI: `/log` hides event log and shows CC panel by default; `/log` again reveals log, hides CC
3. Type `fast industrial techno` → pattern generates and BPM header updates automatically to 142–155 range
4. Type `minimal techno` → BPM updates to 130–136 automatically
5. Type `/randbeat` → pattern changes, BPM header updates, CC panel shows new values
6. Run `/randbeat` 10× — BPM always in 128–160, kick always on beats 1/3 (steps 0/4/8/12), snare always on 2/4 (steps 4/12)
