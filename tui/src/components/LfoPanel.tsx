import React from "react";
import { Box, Text } from "ink";
import type { LfoDef, LfoShape } from "../types.js";
import { lfoPlayheadIndex, lfoBrailleLines, cycleSteps } from "../lfoDisplay.js";
import { theme } from "../theme.js";

export type LfoEditDraft = {
  shape: "off" | LfoShape;
  depth: number;
  num: number;
  den: number;
  phase: number;
};

const SHAPES_WITH_OFF: Array<"off" | LfoShape> = ["off", "sine", "square", "triangle", "ramp", "saw"];

const FIELD_LABELS = ["SHAPE", "DEPTH", "NUM", "DEN", "PHASE"] as const;

function fixedLine(w: number, parts: string[]): string {
  const s = parts.join(" ");
  if (s.length >= w) return s.slice(0, w);
  return s.padEnd(w, " ");
}

function formatFieldValue(draft: LfoEditDraft, field: number): string {
  switch (field) {
    case 0: return draft.shape;
    case 1: return `${draft.depth}%`;
    case 2: return String(draft.num);
    case 3: return String(draft.den);
    case 4: return draft.phase.toFixed(2);
    default: return "";
  }
}

interface LfoPanelProps {
  width: number;
  graphBrailleRows: number;
  /** Full LFO route key, e.g. "cc:kick:filter". */
  targetKey: string;
  lfo: Record<string, LfoDef>;
  lfoOut: Record<string, { value: number; base: number }>;
  patternLength: number;
  currentStep: number | null;
  globalStep: number | null;
  /** True when MIX or LFO panel is active (border highlight). */
  isFocused: boolean;
  /** True when LFO panel itself has keyboard focus (edit mode). */
  isEditing: boolean;
  editField: number;
  editDraft: LfoEditDraft;
}

export function LfoPanel({
  width,
  graphBrailleRows,
  targetKey,
  lfo,
  lfoOut,
  patternLength,
  currentStep,
  globalStep,
  isFocused,
  isEditing,
  editField,
  editDraft,
}: LfoPanelProps) {
  const innerW = Math.max(8, width - 4);
  const brailleCols = innerW;
  const brailleRows = Math.max(2, Math.min(6, graphBrailleRows));
  const labelColor = isFocused ? theme.accent : theme.textDim;
  const border = isEditing ? theme.borderActive : isFocused ? theme.accent : theme.border;

  // Derive a short display label from the target key: "cc:kick:filter" → "filter"
  const seg = targetKey.split(":");
  const paramShort = seg.length === 3 ? `${seg[0]}:${seg[2]}` : targetKey;

  if (isEditing) {
    const isOff = editDraft.shape === "off";

    // Build braille graph from draft values when active
    let waveLines: string[] = [];
    if (!isOff) {
      const step = currentStep === null || currentStep < 0 ? 0 : currentStep;
      const hi = lfoPlayheadIndex(step, patternLength, brailleCols);
      waveLines = lfoBrailleLines(
        editDraft.shape,
        patternLength,
        editDraft.num,
        editDraft.den,
        editDraft.phase,
        brailleCols,
        brailleRows,
        hi,
        globalStep,
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
          LFO  <Text color={theme.textFaint}>{paramShort}</Text>
        </Text>
        {FIELD_LABELS.map((label, i) => {
          const isSel = i === editField;
          const isOffAndNotShape = isOff && i !== 0;
          const valColor = isOffAndNotShape
            ? theme.textGhost
            : isSel
              ? theme.accent
              : theme.text;
          const val = formatFieldValue(editDraft, i);
          return (
            <Box key={label} flexDirection="row">
              <Text color={isSel ? theme.accent : theme.textFaint}>
                {isSel ? ">" : " "}
              </Text>
              <Text>{" "}</Text>
              <Text color={isOffAndNotShape ? theme.textGhost : isSel ? theme.accent : theme.textDim}>
                {label.padEnd(6)}
              </Text>
              <Text bold={isSel} color={valColor}>
                {val}
              </Text>
            </Box>
          );
        })}
        {!isOff && waveLines.map((ln, i) => (
          <Text key={`g${i}`} color={theme.accent}>{ln}</Text>
        ))}
        <Text color={theme.textGhost} wrap="truncate">
          {fixedLine(innerW, ["←→ adjust", "↑↓ field", "Esc: back"])}
        </Text>
      </Box>
    );
  }

  // Display mode
  const def = lfo[targetKey];
  const live = lfoOut[targetKey];

  if (!def) {
    return (
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={border}
        paddingX={1}
      >
        <Text color={labelColor} bold>
          LFO  <Text color={theme.textFaint}>{paramShort}</Text>
        </Text>
        <Text color={theme.textFaint} wrap="truncate">
          {fixedLine(innerW, ["(none)"])}
        </Text>
        {isFocused && (
          <Text color={theme.textGhost} wrap="truncate">
            {fixedLine(innerW, ["l: edit"])}
          </Text>
        )}
      </Box>
    );
  }

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
    globalStep,
  );
  const cyc = cycleSteps(patternLength, def.rate.num, def.rate.den);
  const header = fixedLine(innerW, [
    paramShort.length > 13 ? `${paramShort.slice(0, 12)}…` : paramShort,
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
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={border}
      paddingX={1}
    >
      <Text color={labelColor} bold>
        LFO  <Text color={theme.textFaint}>{paramShort}</Text>
      </Text>
      <Text color={theme.textFaint} wrap="truncate">{header}</Text>
      {targetKey.startsWith("cc:") && (
        <Text color={live ? theme.accent : theme.textGhost} wrap="truncate" bold={!!live}>
          {liveRowText}
        </Text>
      )}
      {waveLines.map((ln, i) => (
        <Text key={`g${i}`} color={theme.accent}>{ln}</Text>
      ))}
      <Text color={theme.textGhost} wrap="truncate">{rateLine}</Text>
      {isFocused && (
        <Text color={theme.textGhost} wrap="truncate">
          {fixedLine(innerW, ["l: edit"])}
        </Text>
      )}
    </Box>
  );
}

export { SHAPES_WITH_OFF };
