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
            <Text bold color={labelColor}>
              {isSelected && isFocused ? ">" : " "}{TRACK_LABELS[track]}{" "}
            </Text>

            {Array.from({ length: 16 }, (_, c) => {
              const stepIdx = colToStep[c];
              const isPlayhead = c === playheadCol;
              const isCursor = c === cursorCol;

              if (stepIdx === -1) {
                return (
                  <Text key={c} underline={isPlayhead || isCursor}>{" "}</Text>
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
                <Text
                  key={c}
                  color={isCursor && !isPlayhead ? theme.accent : dotColor}
                  underline={isPlayhead || isCursor}
                >
                  {glyph}
                </Text>
              );
            })}

            {isSelected && (
              <Box flexDirection="row" marginLeft={1}>
                {FIELD_NAMES.map((field, i) => {
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
                })}
              </Box>
            )}
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
