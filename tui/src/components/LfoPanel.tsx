import React from "react";
import { Box, Text } from "ink";
import type { LfoDef, TrackName } from "../types.js";
import { lfoPlayheadIndex, lfoStrip, cycleSteps } from "../lfoDisplay.js";
import { theme } from "../theme.js";

function entriesForTrack(track: TrackName, lfo: Record<string, LfoDef>): [string, LfoDef][] {
  return Object.entries(lfo).filter(([key]) => {
    const p = key.split(":");
    return p.length === 3 && p[1] === track;
  });
}

interface LfoPanelProps {
  width: number;
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
  selectedTrack,
  lfo,
  lfoOut,
  patternLength,
  currentStep,
  isFocused,
}: LfoPanelProps) {
  const rows = entriesForTrack(selectedTrack, lfo);
  const w = Math.max(8, Math.min(24, width - 2));
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
          (none)
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
      {rows.slice(0, 3).map(([key, def]) => {
        const seg = key.split(":");
        const short = seg.length === 3 ? `${seg[0]}:${seg[2]}` : key;
        const stripW = w;
        const base = lfoStrip(def.shape, def.phase, stripW);
        const step = currentStep === null || currentStep < 0 ? 0 : currentStep;
        const hi = lfoPlayheadIndex(
          step,
          patternLength,
          def.rate.num,
          def.rate.den,
          def.phase,
          stripW,
        );
        const visual = base.slice(0, hi) + "●" + base.slice(hi + 1);
        const cyc = cycleSteps(patternLength, def.rate.num, def.rate.den);
        const live = lfoOut[key];
        const liveLine =
          key.startsWith("cc:") && live
            ? `out ${live.value}  (base ${live.base})`
            : null;
        return (
          <Box key={key} flexDirection="column" marginBottom={0}>
            <Text color={theme.textFaint} wrap="truncate">
              {short} · {def.shape} {def.depth}%
            </Text>
            {liveLine && (
              <Text color={theme.accent} wrap="truncate" bold>
                {liveLine}
              </Text>
            )}
            <Text color={theme.text}>
              {visual}
            </Text>
            <Text color={theme.textGhost}>
              {def.rate.num}/{def.rate.den} pat · {cyc} st/cyc
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}