import React from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";

const TRACK_COLORS: Record<TrackName, string> = {
  kick: "#FF6B00",
  snare: "#FF3366",
  tom: "#FF9F1C",
  clap: "#7B61FF",
  bell: "#00D4FF",
  hihat: "#00FF88",
  openhat: "#FFD700",
  cymbal: "#FF6BFF",
};

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

interface StepGridProps {
  pattern: Record<TrackName, number[]>;
  patternLength: number;
  currentStep: number | null;
  trackMuted: Record<TrackName, boolean>;
  selectedTrack: number;
  pendingMuteTracks?: Set<TrackName>;
}

function stepChar(
  velocity: number,
  isPlayhead: boolean,
  trackColor: string,
  muted: boolean
): { char: string; color: string } {
  if (isPlayhead) return velocity > 0 ? { char: ">", color: "#FF6B00" } : { char: "-", color: "#2a2a2a" };
  if (muted) return { char: velocity > 0 ? ":" : ".", color: "#333333" };
  if (velocity === 0) return { char: ".", color: "#2a2a2a" };
  if (velocity < 50) return { char: "-", color: trackColor };
  if (velocity < 90) return { char: ":", color: trackColor };
  return { char: "#", color: trackColor };
}

export function StepGrid({
  pattern,
  patternLength,
  currentStep,
  trackMuted,
  selectedTrack,
  pendingMuteTracks = new Set(),
}: StepGridProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#333333" paddingX={1}>
      <Text color="#444444" bold>PATTERN</Text>
      {TRACK_NAMES.map((track, trackIdx) => {
        const steps = pattern[track] ?? [];
        const color = TRACK_COLORS[track];
        const label = TRACK_LABELS[track];
        const muted = trackMuted[track] ?? false;
        const isSelected = trackIdx === selectedTrack;
        const isPendingMute = pendingMuteTracks.has(track);
        return (
          <Box key={track}>
            <Text color={isPendingMute ? "#FFD700" : isSelected ? color : "#555555"} bold={isSelected}>
              {label}  
            </Text>
            {Array.from({ length: patternLength }, (_, i) => {
              const velocity = steps[i] ?? 0;
              const isPlayhead = currentStep === i;
              const { char, color: charColor } = stepChar(velocity, isPlayhead, color, muted);
              return <Text key={`${track}-${i}`} color={charColor}>{char} </Text>;
            })}
          </Box>
        );
      })}
    </Box>
  );
}
