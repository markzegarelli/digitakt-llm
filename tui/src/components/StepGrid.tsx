import React from "react";
import { Box, Text } from "ink";
import type { TrackName, PatternTrigState } from "../types.js";
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

/** Border (2) + horizontal padding (2). */
const BORDER_PAD = 4;
/** Ruler + track label column (fixed so steps align): cursor + 2-letter + 2-char status. */
const LABEL_COL_W = 8;

interface StepGridProps {
  /** Inner width of the bordered panel — drives per-step column width on wide terminals. */
  contentWidth: number;
  pattern: Record<TrackName, number[]>;
  patternTrig: PatternTrigState;
  patternLength: number;
  currentStep: number | null;
  trackMuted: Record<TrackName, boolean>;
  selectedTrack: number;
  pendingMuteTracks?: Set<TrackName>;
  /** When true, user is editing steps on `selectedTrack`; `selectedStep` is the cursor column. */
  stepEditMode: boolean;
  selectedStep: number;
  isFocused: boolean;
}

/** Velocity as dots (· off, ○ low, ● high). Playhead is only in the ruler row above. */
function velDot(velocity: number): string {
  if (velocity === 0) return "\u00B7";
  if (velocity < 64) return "\u25CB";
  return "\u25CF";
}

function velColor(velocity: number): string {
  if (velocity <= 0) return theme.textFaint;
  if (velocity < 32) return theme.accentSubtle;
  if (velocity < 88) return theme.accentMuted;
  return theme.accent;
}

function stepColor(
  velocity: number,
  muted: boolean,
  prob: number,
  cond: string | null,
  isColCursor: boolean,
  isRowSelected: boolean,
): string {
  if (isColCursor && isRowSelected) return theme.warn;
  if (muted) return theme.textDim;
  if (velocity === 0) {
    if (cond !== null || prob < 100) return theme.textDim;
    return theme.textFaint;
  }
  if (prob < 50) return theme.error;
  if (prob < 75) return theme.accentMuted;
  if (prob < 100) return theme.warn;
  return velColor(velocity);
}

export function StepGrid({
  contentWidth,
  pattern,
  patternTrig,
  patternLength,
  currentStep,
  trackMuted,
  selectedTrack,
  pendingMuteTracks = new Set(),
  stepEditMode,
  selectedStep,
  isFocused,
}: StepGridProps) {
  const stepArea = Math.max(patternLength * 2, contentWidth - BORDER_PAD - LABEL_COL_W);
  const colWidth = Math.max(2, Math.min(6, Math.floor(stepArea / patternLength)));

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? theme.borderActive : theme.border}
      paddingX={1}
      width={contentWidth}
    >
      <Box marginBottom={0} flexDirection="row">
        <Box width={LABEL_COL_W}>
          <Text bold color={theme.textDim}>STEP</Text>
        </Box>
        {Array.from({ length: patternLength }, (_, i) => {
          const n = i + 1;
          const isHead = currentStep === i;
          const isCol = stepEditMode && isFocused && selectedTrack >= 0 && i === selectedStep;
          const label = n % 4 === 1 ? String(n).padStart(2) : "\u00B7\u00B7";
          return (
            <Box key={i} width={colWidth} justifyContent="center">
              <Text
                bold={isCol}
                color={isCol ? theme.warn : isHead ? theme.accent : n % 4 === 1 ? theme.textDim : theme.textFaint}
              >
                {label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginBottom={0} flexDirection="row">
        <Box width={LABEL_COL_W}>
          <Text color={theme.textGhost}> </Text>
        </Box>
        {Array.from({ length: patternLength }, (_, i) => {
          const isHead = currentStep === i;
          return (
            <Box key={i} width={colWidth} justifyContent="center">
              <Text bold color={isHead ? theme.accent : theme.textGhost}>
                {isHead ? "\u25BC" : " "}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginBottom={0} minHeight={1}>
        <Text color={theme.textFaint}>
          {stepEditMode && isFocused
            ? "Step edit: ←→ [ ] step  Space  Enter/Esc  Tab step↔TRIG keys  t TRIG keys  Shift+T ALL  ↑↓ tracks"
            : " "}
        </Text>
      </Box>
      {TRACK_NAMES.map((track, trackIdx) => {
        const steps = pattern[track] ?? [];
        const label = TRACK_LABELS[track];
        const muted = trackMuted[track] ?? false;
        const isSelected = trackIdx === selectedTrack;
        const isPendingMute = pendingMuteTracks.has(track);
        const labelColor = isPendingMute
          ? theme.warn
          : isSelected && isFocused
            ? theme.accent
            : isSelected
              ? theme.accentMuted
              : theme.textDim;
        const showBadge = muted || isPendingMute;
        const badgeMuted = muted ? "M" : "·";
        const badgeQueue = isPendingMute ? "Q" : "·";
        const badgeColor = isPendingMute ? theme.warn : theme.error;
        return (
          <Box key={track} flexDirection="row">
            <Box width={LABEL_COL_W} flexDirection="row">
              <Text bold color={labelColor}>
                {isSelected && isFocused ? ">" : " "}
                {label}
              </Text>
              {showBadge ? (
                <Text bold color={badgeColor}>
                  {badgeMuted}
                  {badgeQueue}
                </Text>
              ) : null}
            </Box>
            {Array.from({ length: patternLength }, (_, i) => {
              const velocity = steps[i] ?? 0;
              const prob = patternTrig.prob[track]?.[i] ?? 100;
              const cond = patternTrig.cond[track]?.[i] ?? null;
              const glyph = cond !== null ? "\u25C6" : velDot(velocity);
              const isColCursor = stepEditMode && isFocused && isSelected && i === selectedStep;
              const c = stepColor(velocity, muted, prob, cond, isColCursor, isSelected);
              return (
                <Box key={`${track}-${i}`} width={colWidth} justifyContent="center">
                  <Text color={c}>{glyph}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
