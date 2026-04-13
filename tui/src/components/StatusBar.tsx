import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiConnected: boolean;
  generationStatus: "idle" | "generating" | "failed";
  patternName: string | null;
  patternLength: number;
  barCount: number;
}

const SPINNER = ["o", "O", "0", "*"] as const;

export function StatusBar({
  bpm,
  swing,
  isPlaying,
  midiConnected,
  generationStatus,
  patternName,
  patternLength,
  barCount,
}: StatusBarProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (generationStatus !== "generating") return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 200);
    return () => clearInterval(id);
  }, [generationStatus]);

  const playIcon = isPlaying ? ">" : "||";
  const playColor = isPlaying ? "#FF6B00" : "#444444";
  const midiColor = midiConnected ? "#00FF88" : "#FF3366";
  const claudeColor = generationStatus === "generating" ? "#FFD700" : generationStatus === "failed" ? "#FF3366" : "#555555";
  const claudeIcon = generationStatus === "generating" ? SPINNER[frame] : generationStatus === "failed" ? "x" : "o";
  const nameDisplay = patternName ? `[${patternName.toUpperCase()}]` : "[NEW]";

  return (
    <Box borderStyle="double" borderColor="#333333" paddingX={1} flexShrink={0}>
      <Text color={playColor} bold>{playIcon} </Text>
      <Text color="#E8E8E8" bold>{Math.round(bpm)} BPM</Text>
      <Text color="#333333">  |  </Text>
      <Text color="#555555">SW:</Text>
      <Text color={swing > 0 ? "#E8E8E8" : "#444444"}>{swing}</Text>
      <Text color="#333333">  |  </Text>
      <Text color={midiColor}>*</Text>
      <Text color="#555555">MIDI  </Text>
      <Text color={claudeColor}>{claudeIcon}</Text>
      <Text color="#555555">Claude</Text>
      <Text color="#333333">  ===  </Text>
      <Text color="#FF6B00" bold>{nameDisplay}</Text>
      <Text color="#333333">  </Text>
      <Text color="#444444">{patternLength}steps</Text>
      <Text color="#333333">  .  </Text>
      <Text color="#444444">bar:{barCount}</Text>
    </Box>
  );
}
