import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { theme } from "../theme.js";
import {
  EUCLID_N_MAX,
  buildVertexLookup,
  computeRingVertices,
  isVertexHit,
  ringGridSize,
  stepToPlayheadVertex,
} from "../euclidRing.js";

const TRACK_LABELS: Record<TrackName, string> = {
  kick: "BD", snare: "SD", tom: "LT", clap: "CL",
  bell: "BL", hihat: "CH", openhat: "OH", cymbal: "CY",
};

const FIELD_NAMES = ["k", "n", "r"] as const;

export interface EuclidRingPanelProps {
  width: number;
  track: TrackName;
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  currentStep: number | null;
  isFocused: boolean;
  editBox: number | null; // null=none focused, 0=k, 1=n, 2=r
  /** Step + TRIG edit row is open (ring shares row with TrigEditPanel). */
  stepTrigEdit?: boolean;
  /** Master pattern step (0-based) highlighted as the edit cursor; null when not in step+TRIG. */
  selectedPatternStep?: number | null;
}

const CELL_W = 2;

export function EuclidRingPanel({
  width,
  track,
  euclid,
  currentStep,
  isFocused,
  editBox,
  stepTrigEdit = false,
  selectedPatternStep = null,
}: EuclidRingPanelProps) {
  const { k, n, r } = euclid[track] ?? { k: 0, n: 16, r: 0 };
  const nClamped = Math.max(1, Math.min(EUCLID_N_MAX, n));
  const useWide = width >= 60;
  const gridSize = ringGridSize(useWide);
  const vertices = useMemo(
    () => computeRingVertices(nClamped, useWide),
    [nClamped, useWide],
  );
  const lookup = useMemo(
    () => buildVertexLookup(vertices, gridSize),
    [vertices, gridSize],
  );

  const playheadVertex =
    currentStep !== null ? stepToPlayheadVertex(currentStep, nClamped) : null;
  const editCursorVertex =
    stepTrigEdit && selectedPatternStep !== null && selectedPatternStep !== undefined
      ? stepToPlayheadVertex(selectedPatternStep, nClamped)
      : null;

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
        {Array.from({ length: gridSize }, (_, row) => (
          <Box key={row} flexDirection="row">
            {Array.from({ length: gridSize }, (_, col) => {
              const vIdx = lookup[row][col];
              if (vIdx === -1) {
                return <Box key={col} width={CELL_W}><Text> </Text></Box>;
              }
              const hit = isVertexHit(vIdx, k, nClamped, r);
              const isHead = playheadVertex === vIdx;
              const isEdit = editCursorVertex === vIdx;
              const glyph =
                isEdit && !isHead ? "\u25C6" : hit ? "\u25CF" : "\u25CB";
              const color = isHead
                ? theme.accent
                : isEdit
                  ? theme.accentSubtle
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
          {stepTrigEdit
            ? "←→ / [ ] pulse steps only  ↑↓ track  t TRIG keys  Shift+t ALL  Esc ring"
            : editBox !== null
              ? "↑↓ value  Shift+↑↓ ×10  ←/→ or ]/[ field  Enter TRIG  Esc tracks  m/q/Q mute"
              : "Enter from track strip to edit k/n/r"}
        </Text>
      </Box>
    </Box>
  );
}
