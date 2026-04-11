import React from "react";
import { Box, Text } from "ink";
import type { DigitaktState, TrackName, CCParam } from "../types.js";
import { TRACK_NAMES, CC_PARAMS } from "../types.js";

interface CCPanelProps {
  trackCC: DigitaktState["track_cc"];
  trackVelocity: DigitaktState["track_velocity"];
  stepCC: DigitaktState["step_cc"];
  selectedTrack: number;  // 0–7
  selectedParam: number;  // 0=velocity, 1–8=CC params
  isFocused: boolean;
  stepMode: boolean;
  selectedStep: number;        // 0–15 (only relevant when stepMode=true)
  stepInputBuffer: string;     // digits being typed in step-edit mode
}

const BAR_WIDTH = 20;

function barGraph(value: number): string {
  const filled = Math.round((value / 127) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

// Fixed-width 3-char display for a step cell: override value or "  ·"
function stepCell(value: number | null | undefined): string {
  if (value === null || value === undefined) return "  ·";
  return String(value).padStart(3);
}

export function CCPanel({
  trackCC,
  trackVelocity,
  stepCC,
  selectedTrack,
  selectedParam,
  isFocused,
  stepMode,
  selectedStep,
  stepInputBuffer,
}: CCPanelProps) {
  const trackName = TRACK_NAMES[selectedTrack] as TrackName;
  const cc = trackCC[trackName];

  // Row 0 = velocity; rows 1–8 = CC_PARAMS
  const rows: Array<{ key: string; label: string; value: number }> = [
    { key: "velocity", label: "velocity", value: trackVelocity[trackName] ?? 127 },
    ...CC_PARAMS.map((param) => ({
      key: param,
      label: param,
      value: cc?.[param as CCParam] ?? 64,
    })),
  ];

  const hintText = stepMode
    ? "←→: step  ↑↓: ±1  0-9: type value  ⌫: del/global  Enter: confirm  Esc: exit"
    : "[/]: track  ↑↓: param  ←→: ±1  Enter: step mode";

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Box>
        <Text bold color="cyan">CC  </Text>
        {TRACK_NAMES.map((t, i) => (
          <Text key={t} bold={i === selectedTrack} color={i === selectedTrack ? "cyan" : "gray"}>
            {i === selectedTrack ? `[${t.toUpperCase()}]` : ` ${t} `}
          </Text>
        ))}
        <Text color="gray">{`  ${hintText}`}</Text>
      </Box>
      {rows.map(({ key, label, value }, i) => {
        const isSelected = i === selectedParam;
        const col = isSelected && isFocused ? "cyan" : "white";
        const isStepEditing = isSelected && isFocused && stepMode && i > 0; // velocity has no step CC

        if (isStepEditing) {
          const param = CC_PARAMS[i - 1] as CCParam;
          const stepOverrides = stepCC?.[trackName]?.[param] ?? null;
          // What value is the current step actually set to (stored, not preview)
          const storedValue = stepOverrides?.[selectedStep] ?? null;
          // Preview: show buffer if user is typing, otherwise stored value
          const previewValue = stepInputBuffer.length > 0
            ? parseInt(stepInputBuffer, 10)
            : storedValue;

          return (
            <Box key={key}>
              <Text color="gray">{`[${i}]`}</Text>
              {/* Single ASCII char selector — same pattern as PatternGrid */}
              <Text bold color={col}>{">"}</Text>
              <Text>{" "}</Text>
              <Text bold color={col}>{label.padEnd(10)}</Text>
              <Text color="gray">{"["}</Text>
              {Array.from({ length: 16 }, (_, s) => {
                const isCurrentStep = s === selectedStep;
                const cellValue = isCurrentStep ? previewValue : (stepOverrides?.[s] ?? null);
                const isBuffering = isCurrentStep && stepInputBuffer.length > 0;
                return (
                  <Text
                    key={s}
                    bold={isCurrentStep}
                    color={
                      isCurrentStep
                        ? (isBuffering ? "magenta" : "yellow")
                        : cellValue !== null ? "cyan" : "gray"
                    }
                  >
                    {stepCell(cellValue)}
                    {s < 15 ? " " : ""}
                  </Text>
                );
              })}
              <Text color="gray">{"]"}</Text>
              {/* Fixed-width step label — always same width */}
              <Text bold color="yellow">
                {" s"}{String(selectedStep + 1).padStart(2)}{": "}
                {stepInputBuffer.length > 0
                  ? `${stepInputBuffer}_`
                  : storedValue !== null ? String(storedValue) : "global"}
                {"  "}
              </Text>
            </Box>
          );
        }

        return (
          <Box key={key}>
            <Text color="gray">{`[${i}]`}</Text>
            {/* Single ASCII char selector — same pattern as PatternGrid */}
            <Text bold color={isSelected && isFocused ? "cyan" : undefined}>
              {isSelected && isFocused ? ">" : " "}
            </Text>
            <Text>{" "}</Text>
            <Text bold={isSelected} color={col}>{label.padEnd(10)}</Text>
            <Text color="gray">{"["}</Text>
            <Text color={isSelected && isFocused ? "cyan" : "blue"}>{barGraph(value)}</Text>
            <Text color="gray">{"]"}</Text>
            <Text>{"  "}</Text>
            <Text bold={isSelected} color={col}>{String(value).padStart(3)}</Text>
            {/* Fixed-width tail: space + ASCII char — matches the > prefix width */}
            <Text>{" "}</Text>
            <Text color={isSelected && isFocused ? "yellow" : undefined}>
              {isSelected && isFocused ? "<" : " "}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
