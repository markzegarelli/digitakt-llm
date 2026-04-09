import React from "react";
import { Box, Text } from "ink";
import type { DigitaktState, TrackName, CCParam } from "../types.js";
import { TRACK_NAMES, CC_PARAMS } from "../types.js";

interface CCPanelProps {
  trackCC: DigitaktState["track_cc"];
  selectedTrack: number;  // 0–7
  selectedParam: number;  // 0–7
  isFocused: boolean;
}

const BAR_WIDTH = 20;

function barGraph(value: number): string {
  const filled = Math.round((value / 127) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

export function CCPanel({ trackCC, selectedTrack, selectedParam, isFocused }: CCPanelProps) {
  const trackName = TRACK_NAMES[selectedTrack] as TrackName;
  const cc = trackCC[trackName];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Box>
        <Text bold color="cyan">CC  </Text>
        {TRACK_NAMES.map((t, i) => (
          <Text key={t} bold={i === selectedTrack} color={i === selectedTrack ? "cyan" : "gray"}>
            {i === selectedTrack ? `[${t.toUpperCase()}]` : ` ${t} `}
          </Text>
        ))}
        <Text color="gray">{"  Meta+←→: track  ↑↓: param  ←→: ±1  Ctrl+←→: ±10"}</Text>
      </Box>
      {CC_PARAMS.map((param, i) => {
        const value = cc?.[param as CCParam] ?? 64;
        const isSelected = i === selectedParam;
        const col = isSelected && isFocused ? "cyan" : "white";
        return (
          <Box key={param}>
            <Text bold={isSelected} color={col}>
              {isSelected && isFocused ? "▶ " : "  "}{param.padEnd(10)}
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
