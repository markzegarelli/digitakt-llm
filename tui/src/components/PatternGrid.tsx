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
  condMap?: Record<string, (string | null)[]>;
}

const LABELS: Record<TrackName, string> = {
  kick:    "KICK ", snare:   "SNARE", tom:     "TOM  ", clap:   "CLAP ",
  bell:    "BELL ", hihat:   "HIHAT", openhat: "OPHAT", cymbal: "CYMBL",
};

function StepDot({ velocity, isMuted, isActive, cond }: { velocity: number; isMuted: boolean; isActive: boolean; cond: string | null }) {
  const hasCond = cond !== null;
  const marker = velocity > 0 ? (hasCond ? "◆" : "●") : (hasCond ? "◇" : "·");
  const suffix = cond === "1:2" ? "₁" : cond === "not:2" ? "ⁿ" : cond === "fill" ? "f" : "";
  if (isActive) {
    if (velocity === 0) return <><Text color="white">{marker}</Text><Text color="gray">{suffix}</Text></>;
    return <><Text color="yellow">{marker}</Text><Text color="yellow" bold>{suffix}</Text></>;
  }
  if (velocity === 0) return <><Text color="gray">{marker}</Text><Text color="gray">{suffix}</Text></>;
  if (isMuted)        return <><Text color="gray">{marker}</Text><Text color="gray">{suffix}</Text></>;
  const color = velocity >= 101 ? "white" : velocity >= 64 ? "cyan" : "blue";
  return <><Text color={color}>{marker}</Text><Text color="magenta">{suffix}</Text></>;
}

// Non-step chars in each row: border(2) + paddingX(2) + prefix(10) + suffix(10)
const OVERHEAD = 24;

export function PatternGrid({ pattern, trackMuted, selectedTrack, isFocused, currentStep, patternLength, condMap }: PatternGridProps) {
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
            {steps.map((vel, step) => {
              const cond = condMap?.[track]?.[step];
              return (
                <Box key={step} width={colWidth}>
                  <StepDot velocity={vel} isMuted={muted} isActive={currentStep === step} cond={cond ?? null} />
                </Box>
              );
            })}
            <Text>{"  "}</Text>
            <Text bold color={muted ? "red" : "green"}>
              {muted ? "[M]" : "[ ]"}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
