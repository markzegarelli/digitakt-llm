import React from "react";
import { Box, Text } from "ink";
import type { DigitaktState, TrackName } from "../types.js";
import { TRACK_NAMES } from "../types.js";

interface PatternGridProps {
  pattern: DigitaktState["current_pattern"];
  trackMuted: DigitaktState["track_muted"];
  selectedTrack: number;  // 0–7
  isFocused: boolean;
}

const LABELS: Record<TrackName, string> = {
  kick:  "KICK ", snare: "SNARE", hihat: "HIHAT", clap:  "CLAP ",
  perc1: "PRC 1", perc2: "PRC 2", perc3: "PRC 3", perc4: "PRC 4",
};

function StepDot({ velocity, isMuted }: { velocity: number; isMuted: boolean }) {
  if (velocity === 0) return <Text color="gray">·</Text>;
  if (isMuted)        return <Text color="gray">○</Text>;
  const color = velocity >= 101 ? "white" : velocity >= 64 ? "cyan" : "blue";
  return <Text color={color}>●</Text>;
}

export function PatternGrid({ pattern, trackMuted, selectedTrack, isFocused }: PatternGridProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Text bold color="cyan">
        {" PATTERN  1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 ·10 ·11 ·12 ·13 ·14 ·15 ·16"}
      </Text>
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
            <Text>{"  "}</Text>
            {steps.map((vel, step) => (
              <React.Fragment key={step}>
                <StepDot velocity={vel} isMuted={muted} />
                {step < 15 && <Text color="gray"> </Text>}
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
