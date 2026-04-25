# LFO — design spec (v1)

## Goal

Add **LFOs** so patterns gain movement, controllable in **natural language** and shown in the **TUI**, without requiring the LLM to emit LFO data in the first release.

## Requirements (agreed)

| Topic | Choice |
|-------|--------|
| Targets | **Any numeric param** the app already models (MIX / CC, TRIG, track pitch, etc.), resolved from the same vocabulary as `/cc`, trig, etc. |
| Rate | **Tempo-synced only** — LFO **period** is defined relative to the **current pattern loop** (e.g. fractions of a bar in steps), not free-running Hz. |
| Conflicts | **Last write wins** — at most one active LFO per **target key**; a new assignment **replaces** the previous. |
| Persistence | **(C)** LFO definitions are **first-class in saved pattern state** and round-trip with `/save` / load. **Generator/LLM does not** emit LFO fields in v1; later, extend `POST /generate` once schema and prompts are stable. |
| Waveforms | **sine, square, triangle, ramp, saw** (definitions below). |

## Non-goals (v1)

- LLM-generated LFOs in `POST /generate` output.
- Free-running (Hz) LFO rate.
- Modulating **non-numeric** fields (e.g. conditional trigs as named enums) unless we add an explicit, separate rule later.

## Waveforms (normative)

Phase **p** advance along one LFO cycle: **p ∈ [0, 1)**, increasing monotonically with transport and wrapping at 1. All shapes below output **bipolar** **w ∈ [−1, 1]** before **depth** and **clamp** to the target range.

1. **sine**  
   - `w = sin(2πp)`

2. **triangle**  
   - `p < 0.5` → `w = 4p − 1` (linear −1 → +1)  
   - `p ≥ 0.5` → `w = 3 − 4p` (linear +1 → −1)

3. **square**  
   - `p < 0.5` → `w = +1`  
   - `p ≥ 0.5` → `w = −1`

4. **ramp** (rising saw)  
   - `w = 2p − 1` (linear −1 → +1; wrap discontinuity: value jumps from +1 to −1 as **p** crosses 0 mod 1)

5. **saw** (falling saw)  
   - `w = 1 − 2p` (linear +1 → −1; jump from −1 to +1 as **p** wraps)

**Note:** *ramp* and *saw* are distinguishable, phase-inverted saws. No separate “saw up vs saw down” option beyond these two.

## Data model

- A map on the **live pattern** (e.g. `lfo` or `lfo_routes`), separate from `track_cc` and `step_cc`, keyed by a stable **target key** (examples: `cc:filter`, `trig:prob` with rules for per-step vs track-wide as already encoded elsewhere).
- **LfoDef** (minimum for v1):
  - `shape`: one of `sine` | `square` | `triangle` | `ramp` | `saw`
  - `depth`: 0–100 (depth of sweep within the **legal numeric span** of the target after combining with the static base; exact combine rule: **base + depth-scaled w**, then clamp; alternative **multiply** is out of scope unless we standardize in implementation plan)
  - `phase`: 0–1 (cycle offset, optional; default 0)
  - **Rate:** encoded as a **rational of `pattern_length` in steps** so one full LFO cycle spans a musically describable **fraction of the bar** (e.g. one cycle per 1/1 pattern, 1/2, 1/4, …) and stays consistent when `pattern_length` is 8 / 16 / 32. Exact enum or fraction representation is left to the implementation plan (must be unambiguous in tests).
- **Cardinality:** at most one `LfoDef` per `targetKey` (last write wins on API, slash command, and any future NL parser).

## Engine

- On each **sequencer step** (same cadence as current CC and trig evaluation), update **p** from **global play position** and the chosen **cycle length in steps**, evaluate **w = shape(p + phase)**, apply to the **static base** for that **track** (and **step** where applicable), then **clamp** to valid bounds.
- LFO is a **runtime combination layer**; static pattern data (base CC, per-step prob, etc.) remain the **source of truth** for editing; the LFO is **not** “baked” into `step_cc` in v1.

## Natural language (v1)

- Exposed via a **slash command** and/or a small **parser path** in the TUI that maps phrasing → `{ targetKey, LfoDef }`, aligned with the REST API. **No** `POST /generate` LFO field until a later phase.

## API / events

- REST mutation for set/clear LFO (per target or bulk clear for a track, if we want that ergonomic).
- WebSocket event, e.g. `lfo_changed`, mirroring the style of `cc_changed` / `gate_changed`.

## TUI

- In **MIX** and relevant **TRIG** views: for any target with an active LFO, show a compact **line** (wave icon or ASCII/Unicode strip), **shape name**, **depth**, and **tempo-synced rate** (in musical/pattern terms). **Animate** a playhead/phase with `currentStep` / transport so movement is **visible in the terminal** (Ink-only; no new graphics stack in v1).

## Testing (must-have)

- Pure unit tests: **p → w** for all five shapes at representative **p** (including 0, mid-segment, wrap).
- **Cycle length** in steps: for several `pattern_length` and rate choices, one full LFO period equals the expected number of **steps** (integer math, no off-by-one surprises).
- **Save/load** roundtrip for patterns carrying `LfoDef` maps.

## Related code (context)

- Today: `track_cc`, `step_cc`, player per-step send/eval; **ARCHITECTURE.md** documents CC and event names — update when implemented.

## Open points (for implementation plan, not blockers for this spec)

- Exact **target key** grammar for per-step prob vs “every step the same LFO” (likely one LFO modulates the **entire** per-step array by **global phase**; edge cases in plan).
- **Depth** as additive offset vs multiplicative: design assumes **additive to base, then clamp**; confirm in code review.
- **Phase** when switching pattern length: reset vs preserve proportional phase (plan + tests).
