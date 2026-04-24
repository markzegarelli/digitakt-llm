# Euclidean Ring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the step grid with a 7×7 or 9×9 LED-ring view when euclidean sequencing mode is active, with interactive k/n/r editing via Tab + ↑/↓.

**Architecture:** New `EuclidRingPanel` component conditionally replaces `StepGrid` + `TrigEditPanel` in `App.tsx` when `state.seq_mode === "euclidean"`. Pure ring logic (Bjorklund, vertex lookup, n-mapping) lives in a standalone `euclidRing.ts` module so it can be tested without React. State flows in from the existing WebSocket `pattern_changed` event — no backend changes needed.

**Tech Stack:** TypeScript, React, Ink 5, Bun (test runner)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `tui/src/euclidRing.ts` | **Create** | Bjorklund, isVertexHit, stepToVertex, vertex constants |
| `tui/src/euclidRing.test.ts` | **Create** | Unit tests for above |
| `tui/src/components/EuclidRingPanel.tsx` | **Create** | Ring grid + k/n/r box display |
| `tui/src/types.ts` | **Modify** | Add `seq_mode`, `euclid` to `DigitaktState` |
| `tui/src/hooks/useDigitakt.ts` | **Modify** | Extract `seq_mode`/`euclid` from WS payloads; add to `DEFAULT_STATE` |
| `tui/src/App.tsx` | **Modify** | `euclidEditBox` state; Tab intercept; ↑/↓ handler; `handleEuclidValueChange`; conditional render; mode-change effect |

---

## Task 1: euclidRing.ts — pure logic and vertex constants

**Files:**
- Create: `tui/src/euclidRing.ts`
- Create: `tui/src/euclidRing.test.ts`

- [ ] **Step 1: Write failing tests for bjorklund**

```ts
// tui/src/euclidRing.test.ts
import { test, expect } from "bun:test";
import { bjorklund, isVertexHit, stepToVertex, VERTICES_7x7, VERTICES_9x9 } from "./euclidRing.js";

test("bjorklund(0, 8) returns all false", () => {
  expect(bjorklund(0, 8)).toEqual([false, false, false, false, false, false, false, false]);
});

test("bjorklund(8, 8) returns all true", () => {
  expect(bjorklund(8, 8)).toEqual([true, true, true, true, true, true, true, true]);
});

test("bjorklund(3, 8) hits at steps 2, 5, 7", () => {
  const result = bjorklund(3, 8);
  expect(result[2]).toBe(true);
  expect(result[5]).toBe(true);
  expect(result[7]).toBe(true);
  expect(result.filter(Boolean).length).toBe(3);
});

test("bjorklund(5, 16) hits at steps 3, 6, 9, 12, 15", () => {
  const result = bjorklund(5, 16);
  expect(result[3]).toBe(true);
  expect(result[6]).toBe(true);
  expect(result[9]).toBe(true);
  expect(result[12]).toBe(true);
  expect(result[15]).toBe(true);
  expect(result.filter(Boolean).length).toBe(5);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd tui && bun test src/euclidRing.test.ts
```

Expected: `Cannot find module './euclidRing.js'`

- [ ] **Step 3: Write failing tests for isVertexHit and stepToVertex**

Add to `tui/src/euclidRing.test.ts`:

```ts
test("isVertexHit: k=0 is always false", () => {
  expect(isVertexHit(0, 0, 16, 0)).toBe(false);
  expect(isVertexHit(8, 0, 16, 0)).toBe(false);
});

test("isVertexHit: k>=n is always true", () => {
  expect(isVertexHit(0, 16, 16, 0)).toBe(true);
  expect(isVertexHit(15, 8, 8, 0)).toBe(true);
});

test("isVertexHit uses n=16 1:1 mapping for k=5 r=0", () => {
  // bjorklund(5,16) hits at steps 3,6,9,12,15 → vertices 3,6,9,12,15 for n=16
  expect(isVertexHit(3, 5, 16, 0)).toBe(true);
  expect(isVertexHit(6, 5, 16, 0)).toBe(true);
  expect(isVertexHit(0, 5, 16, 0)).toBe(false);
  expect(isVertexHit(1, 5, 16, 0)).toBe(false);
});

test("isVertexHit respects rotation r=1", () => {
  // with r=1 step for vertex v is (floor(v*n/16) + 1) % n
  // vertex 2, k=5, n=16, r=1: step=floor(2*16/16)=2, local=(2+1)%16=3, bjorklund(5,16)[3]=true
  expect(isVertexHit(2, 5, 16, 1)).toBe(true);
  // vertex 3, r=1: step=3, local=4, bjorklund(5,16)[4]=false
  expect(isVertexHit(3, 5, 16, 1)).toBe(false);
});

test("stepToVertex maps step to vertex index", () => {
  expect(stepToVertex(0, 16)).toBe(0);
  expect(stepToVertex(15, 16)).toBe(15);
  // n=8: each step spans 2 vertices
  expect(stepToVertex(0, 8)).toBe(0);   // floor(0*16/8)=0
  expect(stepToVertex(1, 8)).toBe(2);   // floor(1*16/8)=2
  expect(stepToVertex(7, 8)).toBe(14);  // floor(7*16/8)=14
});

test("stepToVertex wraps via modulo for step >= n", () => {
  expect(stepToVertex(16, 16)).toBe(0);  // (16%16)*16/16=0
  expect(stepToVertex(17, 16)).toBe(1);
});

test("VERTICES_7x7 has exactly 16 entries, all within 7x7", () => {
  expect(VERTICES_7x7.length).toBe(16);
  for (const [row, col] of VERTICES_7x7) {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(7);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(7);
  }
});

test("VERTICES_7x7 has no duplicate positions", () => {
  const keys = VERTICES_7x7.map(([r, c]) => `${r},${c}`);
  expect(new Set(keys).size).toBe(16);
});

test("VERTICES_9x9 has exactly 16 entries, all within 9x9", () => {
  expect(VERTICES_9x9.length).toBe(16);
  for (const [row, col] of VERTICES_9x9) {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(9);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(9);
  }
});
```

- [ ] **Step 4: Implement euclidRing.ts**

```ts
// tui/src/euclidRing.ts

/**
 * 16 vertex positions for the 7×7 ring (clockwise from top, radius=3, center=(3,3)).
 * Each entry is [row, col].
 */
export const VERTICES_7x7: [number, number][] = [
  [0, 3], [0, 4], [1, 5], [2, 6], [3, 6],
  [4, 6], [5, 5], [6, 4], [6, 3], [6, 2],
  [5, 1], [4, 0], [3, 0], [2, 0], [1, 1], [0, 2],
];

/**
 * 16 vertex positions for the 9×9 ring (clockwise from top, radius=4, center=(4,4)).
 * Each entry is [row, col].
 */
export const VERTICES_9x9: [number, number][] = [
  [0, 4], [0, 6], [1, 7], [2, 8], [4, 8],
  [6, 8], [7, 7], [8, 6], [8, 4], [8, 2],
  [7, 1], [6, 0], [4, 0], [2, 0], [1, 1], [0, 2],
];

/**
 * Bjorklund / Bresenham bucket accumulator.
 * Returns a length-n boolean array with k True values, evenly distributed.
 * Matches the Python core/euclidean.py implementation exactly.
 */
export function bjorklund(k: number, n: number): boolean[] {
  if (k <= 0) return new Array(n).fill(false) as boolean[];
  if (k >= n) return new Array(n).fill(true) as boolean[];
  const out = new Array(n).fill(false) as boolean[];
  let bucket = 0;
  for (let i = 0; i < n; i++) {
    bucket += k;
    if (bucket >= n) {
      bucket -= n;
      out[i] = true;
    }
  }
  return out;
}

/**
 * True if vertex vIdx (0-15) is a Euclidean hit for the given k/n/r.
 *
 * Vertex v maps to step floor(v * n / 16).
 * After rotation r: local = (step + r) % n.
 */
export function isVertexHit(vIdx: number, k: number, n: number, r: number): boolean {
  if (k <= 0) return false;
  if (k >= n) return true;
  const step = Math.floor(vIdx * n / 16);
  const local = (step + r) % n;
  return bjorklund(k, n)[local];
}

/**
 * Which vertex (0-15) the playhead is on for a given master step and euclidean cycle length n.
 * Wraps via step % n before mapping so the ring loops correctly.
 */
export function stepToVertex(step: number, n: number): number {
  return Math.floor((step % n) * 16 / n);
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd tui && bun test src/euclidRing.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add tui/src/euclidRing.ts tui/src/euclidRing.test.ts
git commit -m "feat(tui): add euclidean ring pure logic — bjorklund, vertex constants, isVertexHit"
```

---

## Task 2: types.ts — add seq_mode and euclid to DigitaktState

**Files:**
- Modify: `tui/src/types.ts`

- [ ] **Step 1: Add fields to DigitaktState interface**

In `tui/src/types.ts`, add two fields to the `DigitaktState` interface after `generation_summary`:

```ts
  seq_mode: "standard" | "euclidean";
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
```

The full tail of the interface becomes:

```ts
  generation_summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
    producer_notes?: string;
  } | null;
  seq_mode: "standard" | "euclidean";
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
}
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
cd tui && bun run build 2>&1 | head -20
```

Expected: build succeeds or only errors about missing `DEFAULT_STATE` fields (which are added in Task 3).

- [ ] **Step 3: Commit**

```bash
git add tui/src/types.ts
git commit -m "feat(tui): add seq_mode and euclid fields to DigitaktState"
```

---

## Task 3: useDigitakt.ts — wire seq_mode/euclid through state

**Files:**
- Modify: `tui/src/hooks/useDigitakt.ts`

- [ ] **Step 1: Add defaults to DEFAULT_STATE**

In `tui/src/hooks/useDigitakt.ts`, add to the `DEFAULT_STATE` object after `generation_summary: null`:

```ts
  seq_mode: "standard" as const,
  euclid: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, { k: 16, n: 16, r: 0 }])
  ) as Record<TrackName, { k: number; n: number; r: number }>,
```

- [ ] **Step 2: Extract seq_mode/euclid in pattern_changed handler**

The current `pattern_changed` case (around line 244) is:

```ts
case "pattern_changed": {
  const raw = msg.data["pattern"] as Record<string, unknown> | undefined;
  if (!raw) return { ...prev, log: newLog };
  const plen = prev.pattern_length;
  const { velocities, trig } = parsePatternFromApi(raw, plen);
  return { ...prev, current_pattern: velocities, pattern_trig: trig, log: newLog };
}
```

Replace it with:

```ts
case "pattern_changed": {
  const raw = msg.data["pattern"] as Record<string, unknown> | undefined;
  if (!raw) return { ...prev, log: newLog };
  const plen = prev.pattern_length;
  const { velocities, trig } = parsePatternFromApi(raw, plen);
  const seqMode = raw["seq_mode"] === "euclidean" ? "euclidean" as const : "standard" as const;
  const rawEuclid = raw["euclid"];
  const euclid = parseEuclidBlock(rawEuclid, prev.euclid);
  return {
    ...prev,
    current_pattern: velocities,
    pattern_trig: trig,
    seq_mode: seqMode,
    euclid,
    log: newLog,
  };
}
```

- [ ] **Step 3: Extract seq_mode/euclid in generation_complete handler**

The current `generation_complete` case builds `parsed` from `raw`. After the `parsed` assignment, add euclid extraction. Replace the return block:

```ts
case "generation_complete": {
  const genBpm = msg.data["bpm"] as number | undefined;
  const raw = msg.data["pattern"] as Record<string, unknown> | undefined;
  const plen = prev.pattern_length;
  const parsed = raw
    ? parsePatternFromApi(raw, plen)
    : { velocities: prev.current_pattern, trig: prev.pattern_trig };
  const seqMode = raw?.["seq_mode"] === "euclidean" ? "euclidean" as const : "standard" as const;
  const euclid = raw ? parseEuclidBlock(raw["euclid"], prev.euclid) : prev.euclid;
  return {
    ...prev,
    generation_status: "idle",
    current_pattern: parsed.velocities,
    pattern_trig: parsed.trig,
    seq_mode: seqMode,
    euclid,
    last_prompt: (msg.data["prompt"] as string | null) ?? prev.last_prompt,
    generation_summary: (msg.data["summary"] as DigitaktState["generation_summary"]) ?? null,
    ...(genBpm ? { bpm: genBpm } : {}),
    log: newLog,
  };
}
```

- [ ] **Step 4: Add the parseEuclidBlock helper**

Add this function near the top of `useDigitakt.ts`, after the `formatLogEntry` function:

```ts
function parseEuclidBlock(
  raw: unknown,
  fallback: DigitaktState["euclid"],
): DigitaktState["euclid"] {
  if (!raw || typeof raw !== "object") return fallback;
  const block = raw as Record<string, unknown>;
  const result = { ...fallback };
  for (const t of TRACK_NAMES) {
    const row = block[t];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const k = typeof r["k"] === "number" ? r["k"] : fallback[t].k;
    const n = typeof r["n"] === "number" ? r["n"] : fallback[t].n;
    const rot = typeof r["r"] === "number" ? r["r"] : fallback[t].r;
    result[t] = { k, n, r: rot };
  }
  return result;
}
```

- [ ] **Step 5: Add DigitaktState import for the helper**

`DigitaktState` is already imported at the top of the file. No import change needed.

- [ ] **Step 6: Verify build**

```bash
cd tui && bun run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tui/src/hooks/useDigitakt.ts
git commit -m "feat(tui): extract seq_mode and euclid from WebSocket pattern events"
```

---

## Task 4: EuclidRingPanel component

**Files:**
- Create: `tui/src/components/EuclidRingPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// tui/src/components/EuclidRingPanel.tsx
import React from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";
import { theme } from "../theme.js";
import { VERTICES_7x7, VERTICES_9x9, isVertexHit, stepToVertex } from "../euclidRing.js";

const TRACK_LABELS: Record<TrackName, string> = {
  kick: "BD", snare: "SD", tom: "LT", clap: "CL",
  bell: "BL", hihat: "CH", openhat: "OH", cymbal: "CY",
};

const FIELD_NAMES = ["k", "n", "r"] as const;
type FieldName = typeof FIELD_NAMES[number];

export interface EuclidRingPanelProps {
  width: number;
  track: TrackName;
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  currentStep: number | null;
  isFocused: boolean;
  editBox: number | null; // null=none focused, 0=k, 1=n, 2=r
  onEditBoxChange: (box: number | null) => void;
  onValueChange: (field: FieldName, delta: number) => void;
}

function buildLookup(vertices: [number, number][], size: number): number[][] {
  const lookup = Array.from({ length: size }, () => new Array(size).fill(-1) as number[]);
  vertices.forEach(([row, col], idx) => { lookup[row][col] = idx; });
  return lookup;
}

const LOOKUP_7x7 = buildLookup(VERTICES_7x7, 7);
const LOOKUP_9x9 = buildLookup(VERTICES_9x9, 9);

const CELL_W = 2;

export function EuclidRingPanel({
  width,
  track,
  euclid,
  currentStep,
  isFocused,
  editBox,
}: EuclidRingPanelProps) {
  const { k, n, r } = euclid[track] ?? { k: 16, n: 16, r: 0 };
  const useWide = width >= 60;
  const GRID_SIZE = useWide ? 9 : 7;
  const lookup = useWide ? LOOKUP_9x9 : LOOKUP_7x7;

  const playheadVertex = currentStep !== null ? stepToVertex(currentStep, n) : null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? theme.borderActive : theme.border}
      paddingX={1}
      width={width}
    >
      {/* Track label row */}
      <Box flexDirection="row" gap={1}>
        <Text bold color={isFocused ? theme.accent : theme.accentMuted}>
          {isFocused ? ">" : " "}{TRACK_LABELS[track]}
        </Text>
        <Text color={theme.textFaint}>euclidean</Text>
      </Box>

      {/* Ring grid */}
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        {Array.from({ length: GRID_SIZE }, (_, row) => (
          <Box key={row} flexDirection="row">
            {Array.from({ length: GRID_SIZE }, (_, col) => {
              const vIdx = lookup[row][col];
              if (vIdx === -1) {
                return <Box key={col} width={CELL_W}><Text> </Text></Box>;
              }
              const hit = isVertexHit(vIdx, k, n, r);
              const isHead = playheadVertex === vIdx;
              const glyph = hit ? "\u25CF" : "\u25CB";
              const color = isHead
                ? theme.accent
                : hit ? theme.accentMuted : theme.textGhost;
              return (
                <Box key={col} width={CELL_W} justifyContent="center">
                  <Text color={color}>{glyph}</Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* k/n/r boxes */}
      <Box flexDirection="row" gap={1} marginTop={1} paddingX={1}>
        {FIELD_NAMES.map((field, i) => {
          const val = i === 0 ? k : i === 1 ? n : r;
          const active = editBox === i;
          return (
            <Box
              key={field}
              borderStyle="single"
              borderColor={active ? theme.borderActive : theme.border}
              paddingX={1}
            >
              <Text color={active ? theme.accent : theme.textDim}>
                {field.toUpperCase()}:{val}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Hint line */}
      <Box paddingX={1}>
        <Text color={theme.textGhost}>
          {editBox !== null
            ? "↑↓ value  Shift+↑↓ \u00d710  Tab next  Esc done"
            : "↑↓ track  Tab edit k/n/r"}
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd tui && bun run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tui/src/components/EuclidRingPanel.tsx
git commit -m "feat(tui): add EuclidRingPanel component — ring grid + k/n/r boxes"
```

---

## Task 5: App.tsx — wire euclidean mode

**Files:**
- Modify: `tui/src/App.tsx`

This task has five distinct edits to `App.tsx`. Apply them in order.

### 5a — Import EuclidRingPanel

- [ ] **Step 1: Add import at the top of App.tsx**

After the existing component imports, add:

```ts
import { EuclidRingPanel } from "./components/EuclidRingPanel.js";
```

### 5b — New state + handleEuclidValueChange callback

- [ ] **Step 2: Add euclidEditBox state**

After the `trigTrackWide` state declaration (around line 77), add:

```ts
const [euclidEditBox, setEuclidEditBox] = useState<number | null>(null);
// 0=k, 1=n, 2=r; null = no box focused
```

- [ ] **Step 3: Add handleEuclidValueChange callback**

After the `runPatternDeleteByName` callback (before `handleCommand`), add:

```ts
const handleEuclidValueChange = useCallback((field: "k" | "n" | "r", delta: number) => {
  const track = TRACK_NAMES[patternTrack] as TrackName;
  const current = state.euclid[track] ?? { k: 16, n: 16, r: 0 };
  const updated = { ...current, [field]: current[field] + delta };
  fetch(`${baseUrl}/seq-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "euclidean", euclid: { [track]: updated } }),
  }).catch((err: Error) => actions.addLog(`✗ /seq-mode: ${err.message}`));
}, [baseUrl, patternTrack, state.euclid, actions]);
```

### 5c — useEffect to clear edit state on mode switch

- [ ] **Step 4: Add mode-change effect**

After the existing `useEffect` that clears state when focus changes to `"prompt"`, add:

```ts
// Clear TRIG edit state when switching to euclidean; clear euclid edit box when switching to standard.
useEffect(() => {
  if (state.seq_mode === "euclidean") {
    setPatternStepEdit(false);
    setTrigKeysActive(false);
    setTrigTrackWide(false);
  } else {
    setEuclidEditBox(null);
  }
}, [state.seq_mode]);

// Clear euclid edit box when SEQ panel loses focus.
useEffect(() => {
  if (focus !== "pattern") setEuclidEditBox(null);
}, [focus]);
```

### 5d — Tab key intercept for euclidean mode

- [ ] **Step 5: Intercept Tab inside the existing Tab handler**

Inside the `if (key.tab)` block in `useInput`, the `else` branch currently has:

```ts
} else {
  if (focus === "pattern" && patternStepEdit) {
    setTrigKeysActive((a) => !a);
    return;
  }
  const nextFocus: FocusPanel = ...
```

Add the euclidean check immediately before the `patternStepEdit` check:

```ts
} else {
  // Euclidean mode: Tab cycles the k/n/r edit box instead of switching panels.
  if (focus === "pattern" && state.seq_mode === "euclidean") {
    setEuclidEditBox((b) => b === null ? 0 : b === 2 ? null : b + 1);
    return;
  }
  if (focus === "pattern" && patternStepEdit) {
    setTrigKeysActive((a) => !a);
    return;
  }
  const nextFocus: FocusPanel = ...
```

### 5e — ↑/↓ and Esc handling in euclidean mode

- [ ] **Step 6: Add euclidean key block at the top of the `if (focus === "pattern")` block**

The `if (focus === "pattern")` block (around line 825) currently starts:

```ts
if (focus === "pattern") {
  const plen = state.pattern_length;
  const maxStep = Math.max(0, plen - 1);

  if (patternStepEdit) {
```

Add the euclidean intercept before the `patternStepEdit` check:

```ts
if (focus === "pattern") {
  const plen = state.pattern_length;
  const maxStep = Math.max(0, plen - 1);

  // Euclidean mode: ↑/↓ adjusts the focused k/n/r box, or changes track when no box is focused.
  if (state.seq_mode === "euclidean") {
    if (key.escape && euclidEditBox !== null) {
      setEuclidEditBox(null);
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (euclidEditBox !== null) {
        const fields = ["k", "n", "r"] as const;
        const field = fields[euclidEditBox as 0 | 1 | 2];
        const delta = (key.upArrow ? 1 : -1) * (key.shift ? 10 : 1);
        handleEuclidValueChange(field, delta);
      } else {
        setPatternTrack((t) => clamp(t + (key.downArrow ? 1 : -1), 0, 7));
      }
      return;
    }
    return; // swallow remaining keys in euclidean mode
  }

  if (patternStepEdit) {
```

### 5f — Conditional render

- [ ] **Step 7: Replace StepGrid + TrigEditPanel row with conditional render**

The current JSX for the SEQ top row is (around line 1046):

```tsx
<Box flexDirection="row" width={stackWidth}>
  <StepGrid
    contentWidth={seqGridWidth}
    ...
  />
  <TrigEditPanel
    width={trigRowW}
    ...
  />
</Box>
```

Replace it with:

```tsx
<Box flexDirection="row" width={stackWidth}>
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
      <StepGrid
        contentWidth={seqGridWidth}
        pattern={state.current_pattern}
        patternTrig={state.pattern_trig}
        patternLength={state.pattern_length}
        currentStep={state.current_step}
        trackMuted={state.track_muted}
        selectedTrack={patternTrack}
        pendingMuteTracks={pendingMuteTracks}
        stepEditMode={patternStepEdit}
        selectedStep={patternSelectedStep}
        isFocused={focus === "pattern"}
      />
      <TrigEditPanel
        width={trigRowW}
        keysActive={trigKeysActive}
        track={TRACK_NAMES[patternTrack] as TrackName}
        stepIndex={patternSelectedStep}
        prob={state.pattern_trig.prob[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 100}
        velocity={state.current_pattern[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 0}
        pitch={(() => {
          const tr = TRACK_NAMES[patternTrack] as TrackName;
          const ov = state.pattern_trig.note[tr]?.[patternSelectedStep];
          return ov != null ? ov : (state.track_pitch[tr] ?? 60);
        })()}
        gate={state.pattern_trig.gate[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? DEFAULT_GATE_PCT}
        cond={state.pattern_trig.cond[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? null}
        selectedField={trigField}
        inputBuffer={trigInputBuffer}
        trackWide={trigTrackWide}
      />
    </>
  )}
</Box>
```

- [ ] **Step 8: Verify full build passes**

```bash
cd tui && bun run build 2>&1 | head -30
```

Expected: no TypeScript errors.

- [ ] **Step 9: Run the Python test suite to confirm no regressions**

```bash
cd /path/to/project && uv run pytest -v 2>&1 | tail -5
```

Expected: `422 passed` (no failures).

- [ ] **Step 10: Smoke test manually**

```bash
uv run digitakt
```

1. Type `/mode euclidean` — SEQ panel should switch to the ring view for the focused track
2. Press `Tab` — the K box should highlight
3. Press `↑` — K value increments; ring updates (more hits appear)
4. Press `Tab` again — N box highlights
5. Press `↑` / `↓` — N changes; ring rescales
6. Press `Esc` — boxes deactivate; ↑/↓ changes track
7. Press `↓` — focused track changes to SD; ring shows SD's k/n/r
8. Type `/mode standard` — step grid returns
9. Press Space to play — confirm MIDI still works (ring playhead moves in euclidean mode)

- [ ] **Step 11: Commit**

```bash
git add tui/src/App.tsx
git commit -m "feat(tui): wire EuclidRingPanel into App — conditional render, Tab/↑↓ k/n/r editing"
```
