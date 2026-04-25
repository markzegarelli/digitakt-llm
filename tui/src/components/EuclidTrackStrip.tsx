import React from "react";
import { Box, Text } from "ink";
import type { TrackName } from "../types.js";
import { getEuclidTrackStripRows } from "../euclidMuteUi.js";
import { theme } from "../theme.js";

export interface EuclidTrackStripProps {
  selectedTrack: number;
  trackMuted: Record<TrackName, boolean>;
  pendingMuteTracks: Set<TrackName>;
  isFocused: boolean;
  width?: number;
}

export function EuclidTrackStrip({
  selectedTrack,
  trackMuted,
  pendingMuteTracks,
  isFocused,
  width = 10,
}: EuclidTrackStripProps) {
  const rows = getEuclidTrackStripRows({ selectedTrack, trackMuted, pendingMuteTracks });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isFocused ? theme.borderActive : theme.border}
      paddingX={1}
      width={width}
    >
      <Text bold color={isFocused ? theme.accent : theme.accentMuted}>
        TRACK
      </Text>
      {rows.map((row) => {
        const selected = row.cursor === ">";
        const pending = pendingMuteTracks.has(row.track);
        const muted = trackMuted[row.track] ?? false;
        const color = pending
          ? theme.warn
          : selected && isFocused
            ? theme.accent
            : selected
              ? theme.accentMuted
              : theme.textDim;
        const badgeColor = pending ? theme.warn : muted ? theme.error : theme.textGhost;

        return (
          <Box key={row.track} flexDirection="row">
            <Text bold color={color}>
              {row.cursor}
              {row.label}
            </Text>
            <Text color={theme.textGhost}> </Text>
            <Text bold color={badgeColor}>
              {row.badge.padEnd(2, " ")}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={theme.textGhost} wrap="truncate">
          {isFocused ? "↑↓ Enter" : "tracks"}
        </Text>
      </Box>
    </Box>
  );
}
