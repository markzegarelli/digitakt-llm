import React from "react";
import { Box, Text, useStdout } from "ink";
import type { DigitaktState, TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";

interface PatternGridProps {
  pattern: DigitaktState["current_pattern"];
  trackMuted: DigitaktState["track_muted"];
  selectedTrack: number;  // 0–7
  isFocused: boolean;
  currentStep: number | null;
  patternLength: number;
}

const LABELS: Record<TrackName, string> = {
  kick:    "KICK ", snare:   "SNARE", tom:     "TOM  ", clap:   "CLAP ",
  bell:    "BELL ", hihat:   "HIHAT", openhat: "OPHAT", cymbal: "CYMBL",
};

function StepDot({ velocity, isMuted, isActive }: { velocity: number; isMuted: boolean; isActive: boolean }) {
  if (isActive) {
    if (velocity === 0) return <Text color="white">·</Text>;
    if (isMuted)        return <Text color="yellow">○</Text>;
    return <Text color="yellow">●</Text>;
  }
  if (velocity === 0) return <Text color="gray">·</Text>;
  if (isMuted)        return <Text color="gray">○</Text>;
  const color = velocity >= 101 ? "white" : velocity >= 64 ? "cyan" : "blue";
  return <Text color={color}>●</Text>;
}

// Non-step chars in each row: border(2) + paddingX(2) + prefix(10) + suffix(10)
const OVERHEAD = 24;

export function PatternGrid({ pattern, trackMuted, selectedTrack, isFocused, currentStep, patternLength }: PatternGridProps) {
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 80;
  // Each step column: fit available space evenly, minimum 2, maximum 3
  const colWidth = Math.min(3, Math.max(2, Math.floor((termCols - OVERHEAD) / patternLength)));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      {/* Header: each step in a fixed-width Box — same colWidth as the dot rows */}
      <Box>
        <Text bold color="cyan">{" PATTERN  "}</Text>
        {Array.from({ length: patternLength }, (_, i) => {
          const isActive = currentStep === i;
          const label = isActive ? "▼" : String(i + 1);
          return (
            <Box key={i} width={colWidth}>
              <Text bold color={isActive ? "yellow" : "cyan"}>{label}</Text>
            </Box>
          );
        })}
      </Box>
      {TRACK_NAMES.map((track, i) => {
        const steps = pattern[track] ?? new Array(patternLength).fill(0);
        const muted = trackMuted[track];
        const isSelected = i === selectedTrack;
        const labelColor = isSelected && isFocused ? "cyan" : muted ? "gray" : "white";
        return (
          <Box key={track}>
            <Text bold color={isSelected && isFocused ? "cyan" : undefined}>
              {isSelected && isFocused ? ">" : " "}
            </Text>
            <Text>{" "}</Text>
            <Text bold={isSelected} color={labelColor}>{LABELS[track]}</Text>
            <Text>{"   "}</Text>
            {steps.map((vel, step) => (
              <Box key={step} width={colWidth}>
                <StepDot velocity={vel} isMuted={muted} isActive={currentStep === step} />
              </Box>
            ))}
            <Text>{"  "}</Text>
            <Text bold color={muted ? "red" : "green"}>
              {muted ? "[MUTED]" : "[  ON  ]"}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
