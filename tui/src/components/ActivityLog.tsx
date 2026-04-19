import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface ActivityLogProps {
  log: string[];
  maxVisible: number;
  /** When set, constrains the panel width (e.g. side column beside TRIG). */
  width?: number;
}

function getLogColor(entry: string): string {
  if (entry.startsWith("pattern ready") || entry.startsWith("pattern changed")) return theme.accentMuted;
  if (
    entry.startsWith("generating") ||
    entry.startsWith("BPM") ||
    entry.startsWith("swing") ||
    entry.startsWith("playback")
  ) return theme.warn;
  if (entry.startsWith("generation failed") || entry.startsWith("MIDI disconnected") || entry.startsWith("\u2717"))
    return theme.error;
  return theme.textDim;
}

/** Read-only tail of the activity log (no focus or keyboard scrolling). */
export function ActivityLog({ log, maxVisible, width }: ActivityLogProps) {
  const visible = log.slice(-maxVisible);
  const padded: string[] = [
    ...visible,
    ...Array(Math.max(0, maxVisible - visible.length)).fill(""),
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      <Text bold color={theme.textDim}>LOG</Text>
      {padded.map((entry, i) => (
        <Text key={i} color={entry ? getLogColor(entry) : undefined}>{entry || " "}</Text>
      ))}
    </Box>
  );
}
