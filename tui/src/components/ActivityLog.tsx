import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";

interface ActivityLogProps {
  log: string[];
  isFocused: boolean;
  maxVisible: number;
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

export function ActivityLog({ log, isFocused, maxVisible }: ActivityLogProps) {
  // scrollOffset: 0 = newest at bottom, positive = scrolled back in time
  const [scrollOffset, setScrollOffset] = useState(0);
  const prevLogLen = useRef(log.length);

  // Auto-scroll to bottom when new entries arrive and user hasn't scrolled up
  useEffect(() => {
    if (log.length !== prevLogLen.current) {
      prevLogLen.current = log.length;
      setScrollOffset((off) => (off === 0 ? 0 : off));
    }
  }, [log.length]);

  useInput((_, key) => {
    if (!isFocused) return;
    const maxOffset = Math.max(0, log.length - maxVisible);
    if (key.upArrow)   setScrollOffset((off) => Math.min(off + 1, maxOffset));
    if (key.downArrow) setScrollOffset((off) => Math.max(off - 1, 0));
  }, { isActive: isFocused });

  // Clamp offset in case log shrinks
  const maxOffset = Math.max(0, log.length - maxVisible);
  const clampedOffset = Math.min(scrollOffset, maxOffset);

  // Slice from the end, adjusted by scroll offset
  const end = clampedOffset === 0 ? undefined : -clampedOffset;
  const start = -(maxVisible + (clampedOffset === 0 ? 0 : clampedOffset));
  const visible = log.slice(start, end);

  const canScrollUp   = clampedOffset < maxOffset;
  const canScrollDown = clampedOffset > 0;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1} flexGrow={1}>
      <Text bold color={isFocused ? "cyan" : "gray"}>ACTIVITY</Text>
      {canScrollUp && (
        <Text color="gray">{`↑ ${maxOffset - clampedOffset} more`}</Text>
      )}
      {visible.length === 0
        ? <Text color="gray">no events yet</Text>
        : visible.map((entry, i) => (
            <Text key={i} color={getLogColor(entry)}>{entry}</Text>
          ))
      }
      {canScrollDown && (
        <Text color="gray">↓ scroll down</Text>
      )}
      {isFocused && log.length > maxVisible && (
        <Text color="gray">↑↓ scroll</Text>
      )}
    </Box>
  );
}
