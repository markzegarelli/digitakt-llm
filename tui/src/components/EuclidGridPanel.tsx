import React from "react";
import { Box, Text } from "ink";
import type { EuclidStripMode, TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";
import { theme } from "../theme.js";
import {
  clampEuclidTriplet,
  euclideanMasterStepHit,
  isVertexHit,
  patternColumnToVertexSlice,
  euclideanVertexPatternSlice,
  stepToVertex,
} from "../euclidRing.js";

const TRACK_LABELS: Record<TrackName, string> = {
  kick: "BD", snare: "SD", tom: "LT", clap: "CL",
  bell: "BL", hihat: "CH", openhat: "OH", cymbal: "CY",
};

const FIELD_NAMES = ["k", "n", "r"] as const;

/** Border (2) + paddingX (2). */
const BORDER_PAD = 4;
/** Cursor + 2-letter track + space — must match every row for column alignment. */
const LABEL_COL_W = 4;
/** Space for selected-row `k=…  n=…  r=…` after the dot lane. */
const KRN_RESERVE_W = 20;
/** Max chars per pulse column on very wide terminals. */
const MAX_COL_W = 6;

const COLOR_FIRST_TRIG = "#e8c55a";
const COLOR_HIT = "#e0e0e0";
const COLOR_REST = "#444";

export interface EuclidGridPanelProps {
  width: number;
  /** Master pattern length (8 / 16 / 32); dot lane width and first-hit use full pattern; each row shows `n` vertices. */
  patternLength: number;
  selectedTrack: number;
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  /** Strip layout: `grid` uses n equal terminal columns; `fractional` merges pattern-length columns per vertex (when n ≤ pl). */
  stripMode: EuclidStripMode;
  currentStep: number | null;
  isFocused: boolean;
  editBox: number | null;
  stepTrigEdit?: boolean;
  selectedPatternStep?: number | null;
  trackMuted: Record<TrackName, boolean>;
  pendingMuteTracks: Set<TrackName>;
}

/** Split `total` chars across `cols` columns; extra width goes left-to-right, capped per column. */
function pulseColumnWidths(total: number, cols: number): number[] {
  const c = Math.max(1, cols);
  const t = Math.max(c, total);
  const w = Array.from({ length: c }, () => 1);
  let used = c;
  while (used < t) {
    let progressed = false;
    for (let i = 0; i < c && used < t; i++) {
      if (w[i]! < MAX_COL_W) {
        w[i]! += 1;
        used++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return w;
}

/** Smallest pattern step in `[0, pl)` with a Euclidean hit, or `-1` if none. */
function firstHitPatternStep(k: number, n: number, r: number, pl: number): number {
  const len = Math.max(0, Math.floor(pl));
  for (let c = 0; c < len; c++) {
    if (euclideanMasterStepHit(k, n, r, c)) return c;
  }
  return -1;
}

/** Minimum terminal width for the panel at 1 char per step (labels + k/n/r + border). */
export function euclidPanelMinWidth(patternLength: number): number {
  const pl = Math.max(1, Math.floor(patternLength));
  return BORDER_PAD + LABEL_COL_W + KRN_RESERVE_W + pl;
}

export function EuclidGridPanel({
  width,
  patternLength,
  selectedTrack,
  euclid,
  stripMode,
  currentStep,
  isFocused,
  editBox,
  stepTrigEdit = false,
  selectedPatternStep = null,
  trackMuted,
  pendingMuteTracks,
}: EuclidGridPanelProps) {
  const pl = Math.max(1, Math.floor(patternLength));

  const innerW = Math.max(0, width - BORDER_PAD);
  /** Full inner budget for column math; strip is drawn in a pinned ruler width below. */
  const dotLaneW = Math.max(pl, innerW - LABEL_COL_W - KRN_RESERVE_W);
  /**
   * Width for steps 1…`pl`: `pl` × chars-per-step (~`floor(dotLaneW/pl)`, capped like pulse columns).
   * Shared by grid and fractional so `k/n/r` lines up with the pattern end in both strip modes.
   */
  const charsPerPatternStep = Math.max(1, Math.min(MAX_COL_W, Math.floor(dotLaneW / pl)));
  const dotsStripW = pl * charsPerPatternStep;
  const gapKn = 1;
  const stripRowUsed = LABEL_COL_W + dotsStripW + gapKn + KRN_RESERVE_W;
  const stripRowTailFlex = innerW > stripRowUsed;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? theme.borderActive : theme.border}
      paddingX={1}
      width={width}
    >
      {TRACK_NAMES.map((track, idx) => {
        const { k, n, r } = euclid[track] ?? { k: 0, n: 16, r: 0 };
        const [kc, nc, rc] = clampEuclidTriplet(k, n, r);
        const isSelected = idx === selectedTrack;
        const isMuted = trackMuted[track] ?? false;
        const isPending = pendingMuteTracks.has(track);

        const sliceLayout = stripMode === "fractional" && nc <= pl;
        const baseColW = sliceLayout ? pulseColumnWidths(dotsStripW, pl) : null;
        const rowColW = sliceLayout
          ? Array.from({ length: nc }, (_, v) => {
              const [a, b] = euclideanVertexPatternSlice(v, pl, nc);
              let sum = 0;
              for (let c = a; c <= b; c++) sum += baseColW![c] ?? 1;
              return sum;
            })
          : pulseColumnWidths(dotsStripW, Math.max(1, nc));

        const firstHitStep = firstHitPatternStep(kc, nc, rc, pl);
        const firstHitVertex =
          firstHitStep >= 0
            ? sliceLayout
              ? patternColumnToVertexSlice(firstHitStep, pl, nc)
              : stepToVertex(firstHitStep, nc)
            : -1;

        const playVertex =
          currentStep !== null
            ? sliceLayout
              ? patternColumnToVertexSlice(Math.floor(currentStep), pl, nc)
              : stepToVertex(Math.floor(currentStep), nc)
            : -2;
        const cursorVertex =
          stepTrigEdit && selectedPatternStep !== null
            ? sliceLayout
              ? patternColumnToVertexSlice(Math.floor(selectedPatternStep), pl, nc)
              : stepToVertex(Math.floor(selectedPatternStep), nc)
            : -2;

        const labelColor = isPending
          ? theme.warn
          : isSelected && isFocused
            ? theme.accent
            : isSelected
              ? theme.accentMuted
              : isMuted
                ? theme.textFaint
                : theme.textDim;

        return (
          <Box key={track} flexDirection="row" width={innerW}>
            <Box width={LABEL_COL_W}>
              <Text bold color={labelColor}>
                {isSelected && isFocused ? ">" : " "}{TRACK_LABELS[track]}{" "}
              </Text>
            </Box>

            <Box flexDirection="row" width={dotsStripW}>
              {Array.from({ length: nc }, (_, v) => {
                const isPlayhead = playVertex === v;
                const isCursor = cursorVertex === v;
                const cw = rowColW[v] ?? 1;

                const isHit = isVertexHit(v, kc, nc, rc);
                const isFirstTrig = isHit && v === firstHitVertex;
                const glyph = isFirstTrig ? "◆" : isHit ? "●" : "·";
                const dotColor = isMuted
                  ? theme.textGhost
                  : isFirstTrig
                    ? COLOR_FIRST_TRIG
                    : isHit
                      ? COLOR_HIT
                      : COLOR_REST;

                return (
                  <Box key={v} width={cw} justifyContent="center">
                    <Text
                      color={isCursor && !isPlayhead ? theme.accent : dotColor}
                      underline={isPlayhead || isCursor}
                    >
                      {glyph}
                    </Text>
                  </Box>
                );
              })}
            </Box>

            <Box flexDirection="row" marginLeft={gapKn} minWidth={KRN_RESERVE_W}>
              {isSelected
                ? FIELD_NAMES.map((field, i) => {
                    const val = i === 0 ? kc : i === 1 ? nc : rc;
                    const active = editBox === i;
                    const dimmed = editBox !== null && !active;
                    return (
                      <Text
                        key={field}
                        color={active ? theme.accent : dimmed ? theme.textGhost : theme.textDim}
                      >
                        {field}={val}{i < 2 ? "  " : ""}
                      </Text>
                    );
                  })
                : (
                  <Text> </Text>
                )}
            </Box>
            {stripRowTailFlex ? <Box flexGrow={1} /> : null}
          </Box>
        );
      })}

      <Box flexDirection="column">
        <Text color={theme.textGhost}>
          {stepTrigEdit
            ? "←→ / [ ] pulse steps only  ↑↓ track  t TRIG keys  Shift+t ALL  Esc grid"
            : editBox !== null
              ? "↑↓ value  Shift+↑↓ ×10  ←/→ or ]/[ field  Enter TRIG  Esc tracks  m/q/Q mute"
              : "↑↓ track  Enter k/n/r  Shift+M standard  m/q/Q mute"}
        </Text>
        <Text color={theme.textGhost}>
          strip:{stripMode}  /euclid-strip [grid|fractional]
        </Text>
      </Box>
    </Box>
  );
}
