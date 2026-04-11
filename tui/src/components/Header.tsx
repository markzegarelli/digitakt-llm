import React from "react";
import { Box, Text, Spinner } from "ink";

interface HeaderProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiPort: string | null;
  connected: boolean;
  generationStatus: "idle" | "generating" | "failed";
  fillActive: boolean;
  fillQueued: boolean;
}

export function Header({ bpm, swing, isPlaying, midiPort, connected, generationStatus, fillActive, fillQueued }: HeaderProps) {
  const statusColor = isPlaying ? "green" : "red";
  const statusLabel = isPlaying ? "▶ PLAYING" : "■ STOPPED";
  const connColor = connected ? "green" : "yellow";

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">DIGITAKT</Text>
      <Text>{"  "}</Text>
      <Text color={connColor}>{connected ? "● CONNECTED" : "○ CONNECTING…"}</Text>
      {midiPort && <><Text>{"  MIDI: "}</Text><Text color="magenta">{midiPort}</Text></>}
      <Text>{"  BPM: "}</Text>
      <Text bold color="yellow">{bpm.toFixed(1)}</Text>
      {swing > 0 && <><Text>{"  "}</Text><Text color="gray">{`swing:${swing}`}</Text></>}
      <Text>{"  "}</Text>
      <Text bold color={statusColor}>{statusLabel}</Text>
      {generationStatus === "generating" && (
        <><Text>{"  "}</Text><Spinner /><Text color="yellow">{" generating…"}</Text></>
      )}
      {generationStatus === "failed" && (
        <Text color="red">{"  ✗ GEN FAILED"}</Text>
      )}
      {fillQueued && <Text color="yellow"> FILL QUEUED</Text>}
      {fillActive && <Text color="cyan"> FILLING</Text>}
    </Box>
  );
}
