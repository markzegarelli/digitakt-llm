import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface StatusBarProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiConnected: boolean;
  patternName: string | null;
  patternLength: number;
  barCount: number;
}

function truncateName(name: string, max: number): string {
  const u = name.toUpperCase();
  return u.length <= max ? u : `${u.slice(0, max - 1)}\u2026`;
}

export function StatusBar({
  bpm,
  swing,
  isPlaying,
  midiConnected,
  patternName,
  patternLength,
  barCount,
}: StatusBarProps) {
  const transport = isPlaying ? "RUN" : "STP";
  const transportColor = isPlaying ? theme.accent : theme.textDim;
  const midiGlyph = midiConnected ? "ON" : "NO";
  const midiColor = midiConnected ? theme.accentMuted : theme.error;
  const pat = patternName ? truncateName(patternName, 22) : "UNTITLED";

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={theme.border}
      paddingX={1}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text color={theme.textDim}>8-TRK DIGITAL SEQ</Text>
        <Text color={theme.textFaint}>DIGITAKT-LLM</Text>
      </Box>
      <Box flexWrap="nowrap">
        <Text bold color={transportColor}>{transport}</Text>
        <Text color={theme.textFaint}>{"  "}</Text>
        <Text color={theme.textDim}>BPM</Text>
        <Text color={theme.text}> {bpm.toFixed(1).padStart(5)}</Text>
        <Text color={theme.textFaint}>{"  │  "}</Text>
        <Text color={theme.textDim}>PAT</Text>
        <Text bold color={theme.accent}> {pat}</Text>
        <Text color={theme.textFaint}>{"  │  "}</Text>
        <Text color={theme.textDim}>STP</Text>
        <Text color={theme.text}> {patternLength}</Text>
        <Text color={theme.textFaint}>{"  │  "}</Text>
        <Text color={theme.textDim}>BAR</Text>
        <Text color={theme.text}> {barCount}</Text>
        <Text color={theme.textFaint}>{"  │  "}</Text>
        <Text color={theme.textDim}>SWG</Text>
        <Text color={swing > 0 ? theme.text : theme.textFaint}> {String(swing).padStart(3)}</Text>
        <Text color={theme.textFaint}>{"  │  "}</Text>
        <Text color={theme.textDim}>MIDI</Text>
        <Text color={midiColor}> {midiGlyph}</Text>
      </Box>
    </Box>
  );
}
