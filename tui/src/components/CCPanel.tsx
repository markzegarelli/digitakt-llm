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
  selectedStep: number;   // 0–15 (only relevant when stepMode=true)
}

const BAR_WIDTH = 20;

function barGraph(value: number): string {
  const filled = Math.round((value / 127) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function stepLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return " · ";
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
    ? "↑↓: value  ←→: step  d: clear  Esc: exit step mode"
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
        const isStepEditing = isSelected && isFocused && stepMode && i > 0; // velocity row has no step CC

        if (isStepEditing) {
          // Get per-step CC overrides for this param on the current track
          const param = CC_PARAMS[i - 1] as CCParam;
          const stepOverrides = stepCC?.[trackName]?.[param] ?? null;

          return (
            <Box key={key}>
              <Text bold color={col}>{"▶ "}{label.padEnd(10)}</Text>
              <Text color="gray">{"["}</Text>
              {Array.from({ length: 16 }, (_, s) => {
                const override = stepOverrides?.[s] ?? null;
                const isCurrentStep = s === selectedStep;
                return (
                  <Text
                    key={s}
                    bold={isCurrentStep}
                    color={isCurrentStep ? "yellow" : override !== null ? "cyan" : "gray"}
                  >
                    {stepLabel(override)}
                    {s < 15 ? " " : ""}
                  </Text>
                );
              })}
              <Text color="gray">{"]"}</Text>
              <Text bold color="yellow">
                {"  step "}{selectedStep + 1}{": "}
                {stepOverrides?.[selectedStep] !== null && stepOverrides?.[selectedStep] !== undefined
                  ? String(stepOverrides[selectedStep])
                  : "global"}
                {" ◄"}
              </Text>
            </Box>
          );
        }

        return (
          <Box key={key}>
            <Text bold={isSelected} color={col}>
              {isSelected && isFocused ? "▶ " : "  "}{label.padEnd(10)}
            </Text>
            <Text color={isSelected && isFocused ? "cyan" : "blue"}>{barGraph(value)}</Text>
            <Text>{"  "}</Text>
            <Text bold={isSelected} color={col}>{String(value).padStart(3)}</Text>
            {isSelected && isFocused && <Text color="yellow"> ◄</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
