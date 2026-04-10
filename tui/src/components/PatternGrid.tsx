import React from "react";
import { Box, Text } from "ink";
import type { DigitaktState, TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";

interface PatternGridProps {
  pattern: DigitaktState["current_pattern"];
  trackMuted: DigitaktState["track_muted"];
  selectedTrack: number;  // 0–7
  isFocused: boolean;
  currentStep: number | null;
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

export function PatternGrid({ pattern, trackMuted, selectedTrack, isFocused, currentStep }: PatternGridProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      {/* Header row — programmatic to mirror exact dot column widths */}
      <Box>
        <Text bold color="cyan">{" PATTERN  "}</Text>
        {Array.from({ length: 16 }, (_, i) => {
          const stepNum = i + 1;
          const isDouble = stepNum >= 10;
          const isActive = currentStep === i;
          // Double-digit active: pad ▼ to 2 chars so column stays 2-wide (no external separator)
          // Single-digit active: ▼ is 1 char + external separator = 2-wide
          const label = isActive
            ? (isDouble ? "▼ " : "▼")
            : String(stepNum);
          return (
            <React.Fragment key={i}>
              <Text bold color={isActive ? "yellow" : "cyan"}>{label}</Text>
              {!isDouble && i < 15 && <Text color="cyan">{" "}</Text>}
            </React.Fragment>
          );
        })}
      </Box>
      {TRACK_NAMES.map((track, i) => {
        const steps = pattern[track] ?? new Array(16).fill(0);
        const muted = trackMuted[track];
        const isSelected = i === selectedTrack;
        const labelColor = isSelected && isFocused ? "cyan" : muted ? "gray" : "white";
        return (
          <Box key={track}>
            <Text bold={isSelected} color={labelColor}>
              {isSelected && isFocused ? "▶ " : "  "}{LABELS[track]}
            </Text>
            <Text>{"   "}</Text>
            {steps.map((vel, step) => (
              <React.Fragment key={step}>
                <StepDot velocity={vel} isMuted={muted} isActive={currentStep === step} />
                {step < 15 && <Text color="gray">{" "}</Text>}
              </React.Fragment>
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
