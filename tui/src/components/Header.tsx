import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  bpm: number;
  isPlaying: boolean;
  midiPort: string | null;
  connected: boolean;
  generationStatus: "idle" | "generating" | "failed";
}

export function Header({ bpm, isPlaying, midiPort, connected, generationStatus }: HeaderProps) {
  const statusColor = isPlaying ? "green" : "red";
  const statusLabel = isPlaying ? "▶ PLAYING" : "■ STOPPED";
  const connColor = connected ? "green" : "yellow";
  const genLabel =
    generationStatus === "generating" ? "  ⟳ GENERATING…"
    : generationStatus === "failed"   ? "  ✗ GEN FAILED"
    : "";

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">DIGITAKT</Text>
      <Text>{"  "}</Text>
      <Text color={connColor}>{connected ? "● CONNECTED" : "○ CONNECTING…"}</Text>
      {midiPort && <><Text>{"  MIDI: "}</Text><Text color="magenta">{midiPort}</Text></>}
      <Text>{"  BPM: "}</Text>
      <Text bold color="yellow">{bpm.toFixed(1)}</Text>
      <Text>{"  "}</Text>
      <Text bold color={statusColor}>{statusLabel}</Text>
      <Text color="yellow">{genLabel}</Text>
    </Box>
  );
}
