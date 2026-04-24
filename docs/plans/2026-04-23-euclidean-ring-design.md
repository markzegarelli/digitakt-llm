# Euclidean Ring — Visual Sequencer Mode

**Date:** 2026-04-23  
**Status:** Approved for implementation

---

## Overview

Add a vpme-inspired LED ring display to the TUI for euclidean sequencing mode. When the user switches to `/mode euclidean`, the standard step grid is replaced by a hero dot-ring for the focused track, plus interactive k/n/r editing controls below it. The ring updates live as the pattern plays.

---

## Approach

Approach A: separate `EuclidRingPanel` component, rendered in place of `StepGrid` + `TrigEditPanel` in `App.tsx` when `state.seq_mode === "euclidean"`. No changes to `StepGrid` or `TrigEditPanel`.

---

## Ring Rendering

### Grid sizes

| Terminal width | Grid | Description |
|---|---|---|
| < 120 cols (primary) | 7×7 | Default |
| ≥ 120 cols (wide) | 9×9 | Larger ring, same 16 vertices |

### Vertex positions — 7×7 grid

16 vertices, clockwise from top, center=(3,3), radius=3:

```
v0=(0,3)  v1=(0,4)  v2=(1,5)  v3=(2,6)  v4=(3,6)
v5=(4,6)  v6=(5,5)  v7=(6,4)  v8=(6,3)  v9=(6,2)
v10=(5,1) v11=(4,0) v12=(3,0) v13=(2,0) v14=(1,1) v15=(0,2)
```

Visual shape (k=16, all hits — non-vertex cells are blank):

```
      ● ● ●      
    ●       ●    
  ●           ●  
  ●           ●  
  ●           ●  
    ●       ●    
      ● ● ●      
```

### Vertex positions — 9×9 grid

Center=(4,4), radius=4. Same 16 vertices mapped to the larger grid:

```
v0=(0,4)  v1=(0,6)  v2=(1,7)  v3=(2,8)  v4=(4,8)
v5=(6,8)  v6=(7,7)  v7=(8,6)  v8=(8,4)  v9=(8,2)
v10=(7,1) v11=(6,0) v12=(4,0) v13=(2,0) v14=(1,1) v15=(0,2)
```

### n-to-vertex mapping rule

The ring always displays exactly 16 vertex positions regardless of `n`. For a given `n` and step `i` (0-based), the vertex index is:

```
vertex(i) = floor(i * 16 / n)
```

When `n < 16`, multiple steps map to the same vertex (the vertex lights up if any mapped step is a hit). When `n > 16`, some vertices have no mapped step (treated as rest/dim).

### Cell rendering

Only vertex cells are rendered. Non-vertex cells are blank (empty string, not `·`).

| State | Glyph | Color |
|---|---|---|
| Hit + playhead at this vertex | `●` | `theme.accent` (#FFB020) |
| Hit (no playhead) | `●` | `theme.accentMuted` (#C49A40) |
| Rest (vertex, no hit) | `○` | `theme.textGhost` (#3a3c38) |
| Non-vertex cell | ` ` | — |

---

## Component: `EuclidRingPanel`

**File:** `tui/src/components/EuclidRingPanel.tsx`

### Props

```ts
interface EuclidRingPanelProps {
  width: number;               // full stackWidth budget
  track: TrackName;            // focused track
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  currentStep: number | null;  // global playhead step (0-based)
  isFocused: boolean;          // SEQ panel has focus
  // k/n/r edit state (owned by App.tsx)
  editBox: number | null;      // null = no box focused; 0=k, 1=n, 2=r
  onEditBoxChange: (box: number | null) => void;
  onValueChange: (field: "k" | "n" | "r", delta: number) => void;
}
```

### Layout

```
┌─ EuclidRingPanel (width = stackWidth) ──────────────────┐
│  BD  euclidean                                           │
│                                                          │
│    [7×7 or 9×9 ring grid]                                │
│                                                          │
│    [ K: 5 ]  [ N: 16 ]  [ R: 0 ]                        │
│    Tab  ↑↓ value  (↑↓ track when unfocused)             │
└──────────────────────────────────────────────────────────┘
```

- Ring grid is centered horizontally within `width`
- k/n/r boxes are monospace, rendered with `<Box>` + `<Text>` using Ink
- Active box has `borderColor={theme.borderActive}`, inactive has `borderColor={theme.border}`
- Grid size: 9×9 if `width ≥ 60`, else 7×7

---

## State additions

### `types.ts` — `DigitaktState`

```ts
seq_mode: "standard" | "euclidean";
euclid: Record<TrackName, { k: number; n: number; r: number }>;
```

TypeScript initial value: `seq_mode = "standard"`, all tracks `{ k: 16, n: 16, r: 0 }`. Real values are populated immediately from the first WebSocket `state` message.

### `useDigitakt.ts` — `pattern_changed` handler

Extract `seq_mode` and `euclid` from the incoming pattern payload alongside existing `prob`/`gate`/`cond` extraction. No new WebSocket events needed.

---

## App.tsx changes

### New state

```ts
const [euclidEditBox, setEuclidEditBox] = useState<number | null>(null);
// 0=k, 1=n, 2=r; null = no box focused
```

### Conditional render (in the SEQ row)

```tsx
{state.seq_mode === "euclidean" ? (
  <EuclidRingPanel
    width={stackWidth}
    track={TRACK_NAMES[patternTrack] as TrackName}
    euclid={state.euclid}
    currentStep={state.current_step}
    isFocused={focus === "pattern"}
    editBox={euclidEditBox}
    onEditBoxChange={setEuclidEditBox}
    onValueChange={handleEuclidValueChange}
  />
) : (
  <>
    <StepGrid ... />
    <TrigEditPanel ... />
  </>
)}
```

TRIG panel is hidden in euclidean mode (no per-step editing for euclidean tracks).

### `handleEuclidValueChange`

Calls `POST /seq-mode` with the updated `euclid` block for the affected track. Debounce is not required — each keypress fires a discrete change.

### Key bindings (SEQ panel focused, euclidean mode)

| Key | `euclidEditBox` state | Action |
|---|---|---|
| `↑` / `↓` | `null` | Change `patternTrack` ±1 |
| `Tab` | any | Cycle box: `null → 0 → 1 → 2 → null` |
| `↑` / `↓` | 0, 1, or 2 | `delta = ±1` on focused field |
| `Shift+↑` / `Shift+↓` | 0, 1, or 2 | `delta = ±10` |
| `Esc` | 0, 1, or 2 | Clear box focus (`null`) |

`euclidEditBox` is reset to `null` when focus leaves the SEQ panel (consistent with how `trigKeysActive` is cleared today).

### Value clamping

Delegate to the existing `clamp_euclid_triplet` on the server. The TUI sends the raw incremented value; the server normalises it. No client-side clamping needed beyond preventing obviously bad sends.

---

## Files changed

| File | Change |
|---|---|
| `tui/src/types.ts` | Add `seq_mode`, `euclid` to `DigitaktState` |
| `tui/src/hooks/useDigitakt.ts` | Extract `seq_mode`/`euclid` from `pattern_changed` WS payload |
| `tui/src/components/EuclidRingPanel.tsx` | **New** — ring grid + k/n/r boxes |
| `tui/src/App.tsx` | Add `euclidEditBox` state; conditional render; key handler; `handleEuclidValueChange` |

No backend changes required. `POST /seq-mode` and `core/euclidean.py` are already complete.

---

## Out of scope

- Per-step velocity/prob/gate in euclidean mode (no TRIG panel shown)
- 9-track or other grid configurations
- Animation/transitions between standard and euclidean mode
- SysEx/Overbridge integration
