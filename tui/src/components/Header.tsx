import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return active ? (SPINNER_FRAMES[frame] ?? '') : '';
}

interface HeaderProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiPort: string | null;
  midiConnected: boolean;
  generationStatus: "idle" | "generating" | "failed";
  fillActive: boolean;
  fillQueued: string | false;
  muteCount: number;
}

export function Header({ bpm, swing, isPlaying, midiPort, midiConnected, generationStatus, fillActive, fillQueued, muteCount }: HeaderProps) {
  const spinnerChar = useSpinner(generationStatus === "generating");
  const statusColor = isPlaying ? "green" : "red";
  const statusLabel = isPlaying ? "▶ PLAYING" : "■ STOPPED";

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">DIGITAKT</Text>
      <Text>{"  "}</Text>
      {midiConnected
        ? <><Text color="green">{"● MIDI: "}</Text><Text color="magenta">{midiPort ?? ""}</Text></>
        : <Text color="red">{"○ NO MIDI"}</Text>
      }
      <Text>{"  BPM: "}</Text>
      <Text bold color="yellow">{bpm.toFixed(1)}</Text>
      <Text>{"  SWG: "}</Text>
      <Text bold color="yellow">{swing}</Text>
      <Text>{"  "}</Text>
      <Text bold color={statusColor}>{statusLabel}</Text>
      {muteCount > 0 && <Text color="red">{`  [${muteCount}M]`}</Text>}
      {generationStatus === "generating" && (
        <><Text>{"  "}</Text><Text>{spinnerChar}</Text><Text color="yellow">{" generating…"}</Text></>
      )}
      {generationStatus === "failed" && (
        <Text color="red">{"  ✗ GEN FAILED"}</Text>
      )}
      {fillQueued && <Text color="yellow">{` FILL: ${fillQueued}`}</Text>}
      {fillActive && <Text color="cyan"> FILLING</Text>}
    </Box>
  );
}
