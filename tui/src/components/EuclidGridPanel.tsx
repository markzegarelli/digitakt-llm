import React from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";
import { theme } from "../theme.js";
import { clampEuclidTriplet, isVertexHit } from "../euclidRing.js";

const TRACK_LABELS: Record<TrackName, string> = {
  kick: "BD", snare: "SD", tom: "LT", clap: "CL",
  bell: "BL", hihat: "CH", openhat: "OH", cymbal: "CY",
};

const FIELD_NAMES = ["k", "n", "r"] as const;

/** Border (2) + paddingX (2). */
const BORDER_PAD = 4;
/** Cursor + 2-letter track + space — must match every row for column alignment. */
const LABEL_COL_W = 4;
/** Space for selected-row `k=…  n=…  r=…` so pulse columns align across all tracks. */
const KRN_RESERVE_W = 20;
/** Max chars per pulse column on very wide terminals. */
const MAX_COL_W = 6;

const COLOR_FIRST_TRIG = "#e8c55a";
const COLOR_HIT = "#e0e0e0";
const COLOR_REST = "#444";

export interface EuclidGridPanelProps {
  width: number;
  selectedTrack: number;
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  currentStep: number | null;
  isFocused: boolean;
  editBox: number | null;
  stepTrigEdit?: boolean;
  selectedPatternStep?: number | null;
  trackMuted: Record<TrackName, boolean>;
  pendingMuteTracks: Set<TrackName>;
}

/** Build reverse lookup: master column → euclidean step index (or -1). */
function buildColToStep(n: number): number[] {
  const out = new Array(16).fill(-1) as number[];
  for (let i = 0; i < n; i++) {
    out[Math.floor(i * 16 / n)] = i;
  }
  return out;
}

/** Split `total` chars across 16 columns; extra width goes left-to-right, capped per column. */
function pulseColumnWidths(total: number): number[] {
  const t = Math.max(16, total);
  const w = Array.from({ length: 16 }, () => 1);
  let used = 16;
  while (used < t) {
    let progressed = false;
    for (let i = 0; i < 16 && used < t; i++) {
      if (w[i] < MAX_COL_W) {
        w[i]++;
        used++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return w;
}

export function EuclidGridPanel({
  width,
  selectedTrack,
  euclid,
  currentStep,
  isFocused,
  editBox,
  stepTrigEdit = false,
  selectedPatternStep = null,
  trackMuted,
  pendingMuteTracks,
}: EuclidGridPanelProps) {
  const playheadCol = currentStep !== null ? currentStep % 16 : null;
  const cursorCol = stepTrigEdit && selectedPatternStep !== null ? selectedPatternStep % 16 : null;

  const innerW = Math.max(0, width - BORDER_PAD);
  const dotLaneW = Math.max(16, innerW - LABEL_COL_W - KRN_RESERVE_W);
  const colW = pulseColumnWidths(dotLaneW);

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
        const colToStep = buildColToStep(nc);
        // First trig: the euclidean vertex where ring[0] lands after rotation.
        // ring[(vIdx + rc) % nc] = ring[0] → vIdx = (nc - rc) % nc
        const firstTrigVertex = kc > 0 ? ((nc - rc) % nc + nc) % nc : -1;

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
          <Box key={track} flexDirection="row">
            <Box width={LABEL_COL_W}>
              <Text bold color={labelColor}>
                {isSelected && isFocused ? ">" : " "}{TRACK_LABELS[track]}{" "}
              </Text>
            </Box>

            {Array.from({ length: 16 }, (_, c) => {
              const stepIdx = colToStep[c];
              const isPlayhead = c === playheadCol;
              const isCursor = c === cursorCol;
              const cw = colW[c] ?? 1;

              if (stepIdx === -1) {
                return (
                  <Box key={c} width={cw} justifyContent="center">
                    <Text underline={isPlayhead || isCursor}>{" ".repeat(cw)}</Text>
                  </Box>
                );
              }

              const isHit = isVertexHit(stepIdx, kc, nc, rc);
              const isFirstTrig = stepIdx === firstTrigVertex;
              const glyph = isFirstTrig ? "◆" : isHit ? "●" : "·";
              const dotColor = isMuted
                ? theme.textGhost
                : isFirstTrig
                  ? COLOR_FIRST_TRIG
                  : isHit
                    ? COLOR_HIT
                    : COLOR_REST;

              return (
                <Box key={c} width={cw} justifyContent="center">
                  <Text
                    color={isCursor && !isPlayhead ? theme.accent : dotColor}
                    underline={isPlayhead || isCursor}
                  >
                    {glyph}
                  </Text>
                </Box>
              );
            })}

            <Box flexDirection="row" marginLeft={1} minWidth={KRN_RESERVE_W}>
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
          </Box>
        );
      })}

      <Box>
        <Text color={theme.textGhost}>
          {stepTrigEdit
            ? "←→ / [ ] pulse steps only  ↑↓ track  t TRIG keys  Shift+t ALL  Esc grid"
            : editBox !== null
              ? "↑↓ value  Shift+↑↓ ×10  ←/→ or ]/[ field  Enter TRIG  Esc tracks  m/q/Q mute"
              : "↑↓ track  Enter k/n/r  Shift+M standard  m/q/Q mute"}
        </Text>
      </Box>
    </Box>
  );
}
