import React from "react";
import { Box, Text } from "ink";
import type { LfoDef, TrackName } from "../types.js";
import { lfoPlayheadIndex, lfoBrailleLines, cycleSteps } from "../lfoDisplay.js";
import { theme } from "../theme.js";

function entriesForTrack(track: TrackName, lfo: Record<string, LfoDef>): [string, LfoDef][] {
  return Object.entries(lfo).filter(([key]) => {
    const p = key.split(":");
    return p.length === 3 && p[1] === track;
  });
}

/** Single-line label padded to `w` chars so live value updates do not shift layout. */
function fixedLine(w: number, parts: string[]): string {
  const s = parts.join(" ");
  if (s.length >= w) return s.slice(0, w);
  return s.padEnd(w, " ");
}

interface LfoPanelProps {
  width: number;
  /** Vertical size of the braille graph (each row = 4 dot-rows). */
  graphBrailleRows: number;
  selectedTrack: TrackName;
  lfo: Record<string, LfoDef>;
  /** Live CC output (modulated value + static base) from `lfo_value` while playing. */
  lfoOut: Record<string, { value: number; base: number }>;
  patternLength: number;
  currentStep: number | null;
  isFocused: boolean;
}

export function LfoPanel({
  width,
  graphBrailleRows,
  selectedTrack,
  lfo,
  lfoOut,
  patternLength,
  currentStep,
  isFocused,
}: LfoPanelProps) {
  const rows = entriesForTrack(selectedTrack, lfo);
  /** Inner text width: round border (2) + paddingX 1+1 */
  const innerW = Math.max(8, width - 4);
  const brailleCols = innerW;
  const brailleRows = Math.max(2, Math.min(6, graphBrailleRows));
  const maxLfoBlocks = brailleRows >= 4 ? 2 : 3;
  const labelColor = isFocused ? theme.accent : theme.textDim;
  const border = isFocused ? theme.borderActive : theme.border;
  if (rows.length === 0) {
    return (
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={border}
        paddingX={1}
      >
        <Text color={labelColor} bold>
          LFO
        </Text>
        <Text color={theme.textFaint} wrap="truncate">
          {fixedLine(innerW, ["(none)"])}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={border}
      paddingX={1}
    >
      <Text color={labelColor} bold>
        LFO
      </Text>
      {rows.slice(0, maxLfoBlocks).map(([key, def], idx, arr) => {
        const seg = key.split(":");
        const short = seg.length === 3 ? `${seg[0]}:${seg[2]}` : key;
        const step = currentStep === null || currentStep < 0 ? 0 : currentStep;
        const hi = lfoPlayheadIndex(step, patternLength, brailleCols);
        const waveLines = lfoBrailleLines(
          def.shape,
          patternLength,
          def.rate.num,
          def.rate.den,
          def.phase,
          brailleCols,
          brailleRows,
          hi,
        );
        const cyc = cycleSteps(patternLength, def.rate.num, def.rate.den);
        const live = lfoOut[key];
        const header = fixedLine(innerW, [
          short.length > 13 ? `${short.slice(0, 12)}…` : short,
          def.shape,
          `${String(def.depth).padStart(3)}%`,
        ]);
        const liveRowText = fixedLine(
          innerW,
          live
            ? ["out", String(live.value).padStart(3, "0"), "base", String(live.base).padStart(3, "0")]
            : ["out", "   ", "base", "   "],
        );
        const rateLine = fixedLine(innerW, [
          `${String(def.rate.num).padStart(3)}/${String(def.rate.den).padStart(3)} pat`,
          "·",
          `${String(cyc).padStart(3)} st/cyc`,
        ]);
        return (
          <Box key={key} flexDirection="column" marginBottom={idx < arr.length - 1 ? 1 : 0}>
            <Text color={theme.textFaint} wrap="truncate">
              {header}
            </Text>
            {key.startsWith("cc:") && (
              <Text color={live ? theme.accent : theme.textGhost} wrap="truncate" bold={!!live}>
                {liveRowText}
              </Text>
            )}
            {waveLines.map((ln, i) => (
              <Text key={`${key}:g${i}`} color={theme.accent}>
                {ln}
              </Text>
            ))}
            <Text color={theme.textGhost} wrap="truncate">
              {rateLine}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
