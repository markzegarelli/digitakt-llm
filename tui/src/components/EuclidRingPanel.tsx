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

export interface EuclidRingPanelProps {
  width: number;
  track: TrackName;
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  currentStep: number | null;
  isFocused: boolean;
  editBox: number | null; // null=none focused, 0=k, 1=n, 2=r
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
            ? "↑↓ value  Shift+↑↓ ×10  Tab next  Esc done"
            : "↑↓ track  Tab edit k/n/r"}
        </Text>
      </Box>
    </Box>
  );
}
