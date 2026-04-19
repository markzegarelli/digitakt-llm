import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

const SPINNER = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807"];

function useSpinner(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    const id = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return active ? (SPINNER[i] ?? "") : "";
}

interface StatusBarProps {
  bpm: number;
  swing: number;
  isPlaying: boolean;
  midiConnected: boolean;
  midiPortName: string | null;
  patternName: string | null;
  patternLength: number;
  currentStep: number | null;
  barCount: number;
  generationStatus: "idle" | "generating" | "failed";
  fillActive: boolean;
  fillQueued: string | false;
  muteCount: number;
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
  midiPortName,
  patternName,
  patternLength,
  currentStep,
  barCount,
  generationStatus,
  fillActive,
  fillQueued,
  muteCount,
}: StatusBarProps) {
  const spin = useSpinner(generationStatus === "generating");
  const transportColor = isPlaying ? theme.accent : theme.textDim;
  const transportLabel = isPlaying ? "\u25B6 PLAY" : "\u25A0 STOP";
  const pat = patternName ? truncateName(patternName, 20) : "UNTITLED";
  const stepDisp =
    currentStep !== null && currentStep >= 0 ? `${currentStep + 1}/${patternLength}` : `\u2014/${patternLength}`;
  const midiShort =
    midiConnected && midiPortName
      ? truncateName(midiPortName.replace(/\s+/g, " "), 14)
      : midiConnected
        ? "OK"
        : "NONE";

  return (
    <Box flexDirection="row" flexWrap="wrap" paddingX={1} flexShrink={0}>
      <Text bold color={theme.accent}>
        {"\u25CF DGTK"}
      </Text>
      <Text color={theme.textFaint}>{"  "}</Text>
      <Text bold color={transportColor}>
        {transportLabel}
      </Text>
      <Text color={theme.textGhost}>{"  \u2502  "}</Text>
      <Text color={theme.textDim}>BPM</Text>
      <Text color={theme.text}> {bpm.toFixed(1)}</Text>
      <Text color={theme.textGhost}>{"  \u2502  "}</Text>
      <Text color={theme.textDim}>PAT</Text>
      <Text bold color={theme.accent}>
        {" "}
        {pat}
      </Text>
      <Text color={theme.textGhost}>{"  \u2502  "}</Text>
      <Text color={theme.textDim}>BAR</Text>
      <Text color={theme.text}> {barCount}</Text>
      <Text color={theme.textGhost}>{"  \u2502  "}</Text>
      <Text color={theme.textDim}>STP</Text>
      <Text color={theme.text}> {stepDisp}</Text>
      <Text color={theme.textGhost}>{"  \u2502  "}</Text>
      <Text color={theme.textDim}>SWG</Text>
      <Text color={swing > 0 ? theme.text : theme.textFaint}> {String(swing).padStart(3)}</Text>
      <Text color={theme.textGhost}>{"  \u2502  "}</Text>
      <Text color={theme.textDim}>MIDI</Text>
      <Text color={midiConnected ? theme.good : theme.error} bold={!midiConnected}>
        {midiConnected ? ` \u25CF ${midiShort}` : " \u25CB OFF"}
      </Text>
      {muteCount > 0 && (
        <>
          <Text color={theme.textGhost}>{"  \u2502  "}</Text>
          <Text color={theme.error}>{`MUTE ${muteCount}`}</Text>
        </>
      )}
      {fillQueued && typeof fillQueued === "string" && (
        <>
          <Text color={theme.textGhost}>{"  \u2502  "}</Text>
          <Text color={theme.warn}>{`FILL\u2192${truncateName(fillQueued, 12)}`}</Text>
        </>
      )}
      {fillActive && (
        <>
          <Text color={theme.textGhost}>{"  \u2502  "}</Text>
          <Text color={theme.accent}>FILL</Text>
        </>
      )}
      {generationStatus === "generating" && (
        <>
          <Text color={theme.textGhost}>{"  \u2502  "}</Text>
          <Text color={theme.warn}>
            {spin} GEN\u2026
          </Text>
        </>
      )}
      {generationStatus === "failed" && (
        <>
          <Text color={theme.textGhost}>{"  \u2502  "}</Text>
          <Text color={theme.error}>GEN FAIL</Text>
        </>
      )}
      <Text color={theme.textFaint}>{"  v0.3"}</Text>
    </Box>
  );
}
