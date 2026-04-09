import React from "react";
import { Box, Text } from "ink";
import type { DigitaktState, TrackName, CCParam } from "../types.js";
import { TRACK_NAMES, CC_PARAMS } from "../types.js";

interface CCPanelProps {
  trackCC: DigitaktState["track_cc"];
  trackVelocity: DigitaktState["track_velocity"];
  selectedTrack: number;  // 0–7
  selectedParam: number;  // 0=velocity, 1–8=CC params
  isFocused: boolean;
}

const BAR_WIDTH = 20;

function barGraph(value: number): string {
  const filled = Math.round((value / 127) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

export function CCPanel({ trackCC, trackVelocity, selectedTrack, selectedParam, isFocused }: CCPanelProps) {
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

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Box>
        <Text bold color="cyan">CC  </Text>
        {TRACK_NAMES.map((t, i) => (
          <Text key={t} bold={i === selectedTrack} color={i === selectedTrack ? "cyan" : "gray"}>
            {i === selectedTrack ? `[${t.toUpperCase()}]` : ` ${t} `}
          </Text>
        ))}
        <Text color="gray">{"  [/]: track  ↑↓: param  ←→: ±1"}</Text>
      </Box>
      {rows.map(({ key, label, value }, i) => {
        const isSelected = i === selectedParam;
        const col = isSelected && isFocused ? "cyan" : "white";
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
