import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";

interface ActivityLogProps {
  log: string[];
  isFocused: boolean;
  maxVisible: number;
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

export function ActivityLog({ log, isFocused, maxVisible }: ActivityLogProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const prevLogLen = useRef(log.length);

  useEffect(() => {
    if (log.length !== prevLogLen.current) {
      prevLogLen.current = log.length;
      setScrollOffset((off) => (off === 0 ? 0 : off));
    }
  }, [log.length]);

  useInput((_, key) => {
    if (!isFocused) return;
    const maxOff = Math.max(0, log.length - maxVisible);
    if (key.upArrow)   setScrollOffset((off) => Math.min(off + 1, maxOff));
    if (key.downArrow) setScrollOffset((off) => Math.max(off - 1, 0));
  }, { isActive: isFocused });

  const maxOffset = Math.max(0, log.length - maxVisible);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const end = clampedOffset === 0 ? undefined : -clampedOffset;
  const start = -(maxVisible + (clampedOffset === 0 ? 0 : clampedOffset));
  const visible = log.slice(start, end);
  const canScrollUp   = clampedOffset < maxOffset;
  const canScrollDown = clampedOffset > 0;

  const padded: string[] = [
    ...visible,
    ...Array(Math.max(0, maxVisible - visible.length)).fill(""),
  ];

  const borderCol = isFocused ? theme.borderActive : theme.border;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={borderCol} paddingX={1}>
      <Text bold color={isFocused ? theme.accent : theme.textDim}>LOG</Text>
      {canScrollUp && (
        <Text color={theme.textFaint}>{`\u2191 ${maxOffset - clampedOffset} more`}</Text>
      )}
      {padded.map((entry, i) => (
        <Text key={i} color={entry ? getLogColor(entry) : undefined}>{entry || " "}</Text>
      ))}
      {canScrollDown && (
        <Text color={theme.textFaint}>{"\u2193 scroll"}</Text>
      )}
      {isFocused && log.length > maxVisible && (
        <Text color={theme.textFaint}>{"\u2191\u2193"}</Text>
      )}
    </Box>
  );
}
