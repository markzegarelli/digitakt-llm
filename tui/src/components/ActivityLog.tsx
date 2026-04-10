import React from "react";
import { Box, Text } from "ink";

interface ActivityLogProps {
  log: string[];
  isFocused: boolean;
}

function getLogColor(entry: string): string {
  if (entry.startsWith("pattern ready") || entry.startsWith("pattern changed")) return "green";
  if (
    entry.startsWith("generating") ||
    entry.startsWith("BPM") ||
    entry.startsWith("swing") ||
    entry.startsWith("playback")
  ) return "yellow";
  if (entry.startsWith("generation failed") || entry.startsWith("MIDI disconnected")) return "red";
  return "gray";
}

export function ActivityLog({ log, isFocused }: ActivityLogProps) {
  const visible = log.slice(-20);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Text bold color={isFocused ? "cyan" : "gray"}>ACTIVITY</Text>
      {visible.length === 0
        ? <Text color="gray">no events yet</Text>
        : visible.map((entry, i) => (
            <Text key={i} color={getLogColor(entry)}>{entry}</Text>
          ))
      }
    </Box>
  );
}
