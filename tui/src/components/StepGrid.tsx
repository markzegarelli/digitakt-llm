import React from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";
import { theme } from "../theme.js";

const TRACK_LABELS: Record<TrackName, string> = {
  kick: "BD",
  snare: "SD",
  tom: "LT",
  clap: "CL",
  bell: "BL",
  hihat: "CH",
  openhat: "OH",
  cymbal: "CY",
};

/** Velocity → OLED-style luminance steps (single accent family). */
function velColor(velocity: number): string {
  if (velocity <= 0) return theme.textFaint;
  if (velocity < 32) return theme.accentSubtle;
  if (velocity < 88) return theme.accentMuted;
  return theme.accent;
}

/** Border (2) + horizontal padding (2). */
const BORDER_PAD = 4;
/** Ruler + track label column (fixed so steps align). */
const LABEL_COL_W = 6;

interface StepGridProps {
  /** Inner width of the bordered panel — drives per-step column width on wide terminals. */
  contentWidth: number;
  pattern: Record<TrackName, number[]>;
  patternLength: number;
  currentStep: number | null;
  trackMuted: Record<TrackName, boolean>;
  selectedTrack: number;
  pendingMuteTracks?: Set<TrackName>;
}

/** OLED-style dots: empty ·, low ○ (1–63), high ● (64–127). Playhead ►/▷. */
function stepGlyph(velocity: number, isPlayhead: boolean, _muted: boolean): string {
  if (isPlayhead) return velocity > 0 ? "\u25BA" : "\u25B9";
  if (velocity === 0) return "\u00B7";
  if (velocity < 64) return "\u25CB";
  return "\u25CF";
}

export function StepGrid({
  contentWidth,
  pattern,
  patternLength,
  currentStep,
  trackMuted,
  selectedTrack,
  pendingMuteTracks = new Set(),
}: StepGridProps) {
  const stepArea = Math.max(patternLength * 2, contentWidth - BORDER_PAD - LABEL_COL_W);
  const colWidth = Math.max(2, Math.min(6, Math.floor(stepArea / patternLength)));

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      width={contentWidth}
    >
      <Box marginBottom={0} flexDirection="row">
        <Box width={LABEL_COL_W}>
          <Text bold color={theme.textDim}>STEP</Text>
        </Box>
        {Array.from({ length: patternLength }, (_, i) => {
          const n = i + 1;
          const label = n % 4 === 1 ? String(n).padStart(2) : "\u00B7\u00B7";
          return (
            <Box key={i} width={colWidth} justifyContent="center">
              <Text color={n % 4 === 1 ? theme.textDim : theme.textFaint}>{label}</Text>
            </Box>
          );
        })}
      </Box>
      {TRACK_NAMES.map((track, trackIdx) => {
        const steps = pattern[track] ?? [];
        const label = TRACK_LABELS[track];
        const muted = trackMuted[track] ?? false;
        const isSelected = trackIdx === selectedTrack;
        const isPendingMute = pendingMuteTracks.has(track);
        const labelColor = isPendingMute ? theme.warn : isSelected ? theme.accent : theme.textDim;
        return (
          <Box key={track} flexDirection="row">
            <Box width={LABEL_COL_W}>
              <Text bold color={labelColor}>{label}</Text>
            </Box>
            {Array.from({ length: patternLength }, (_, i) => {
              const velocity = steps[i] ?? 0;
              const isPlayhead = currentStep === i;
              const g = stepGlyph(velocity, isPlayhead, muted);
              let c = velColor(velocity);
              if (muted) c = theme.textFaint;
              if (isPlayhead) c = velocity > 0 ? theme.accent : theme.textDim;
              return (
                <Box key={`${track}-${i}`} width={colWidth} justifyContent="center">
                  <Text color={c}>{g}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
