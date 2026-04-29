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

function formatFieldValue(vals: LfoEditDraft, field: number): string {
  switch (field) {
    case 0: return vals.shape;
    case 1: return `${vals.depth}%`;
    case 2: return String(vals.num);
    case 3: return String(vals.den);
    case 4: return vals.phase.toFixed(2);
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
  /** True when LFO panel itself has keyboard focus (edit mode). */
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
  // Fixed panel height = border(2) + header(1) + fields(5) + wave(brailleRows) + hint(1)
  const panelHeight = 9 + brailleRows;

  const seg = targetKey.split(":");
  const paramShort = seg.length === 3 ? `${seg[0]}:${seg[2]}` : targetKey;

  const def = lfo[targetKey];

  // Values to show in the 5 fields — always visible, source depends on mode.
  const vals: LfoEditDraft = isEditing
    ? editDraft
    : def
      ? { shape: def.shape, depth: def.depth, num: def.rate.num, den: def.rate.den, phase: def.phase }
      : { shape: "off", depth: 0, num: 1, den: 1, phase: 0 };

  const isOff = vals.shape === "off";

  // Waveform lines
  const step = currentStep === null || currentStep < 0 ? 0 : currentStep;
  let waveLines: string[] = [];
  if (!isOff) {
    const hi = lfoPlayheadIndex(step, patternLength, brailleCols);
    waveLines = lfoBrailleLines(
      vals.shape,
      patternLength,
      vals.num,
      vals.den,
      vals.phase,
      brailleCols,
      brailleRows,
      hi,
      globalStep,
    );
  }

  // Footer — always exactly 1 line
  let footerText: string;
  if (isEditing) {
    footerText = fixedLine(innerW, ["←→ adjust", "↑↓ field", "Esc: back"]);
  } else if (def) {
    const cyc = cycleSteps(patternLength, def.rate.num, def.rate.den);
    footerText = fixedLine(innerW, [
      `${String(def.rate.num).padStart(3)}/${String(def.rate.den).padStart(3)} pat`,
      "·",
      `${String(cyc).padStart(3)} st/cyc`,
    ]);
  } else {
    footerText = fixedLine(innerW, ["l: edit"]);
  }

  const border = isEditing ? theme.borderActive : isFocused ? theme.accent : theme.border;
  const headerColor = isFocused ? theme.accent : theme.textDim;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={panelHeight}
      borderStyle="round"
      borderColor={border}
      paddingX={1}
    >
      <Text color={headerColor} bold>
        LFO  <Text color={theme.textFaint}>{paramShort}</Text>
      </Text>
      {FIELD_LABELS.map((label, i) => {
        const isSel = isEditing && i === editField;
        const isGhosted = isOff && i !== 0;
        const labelCol = isGhosted
          ? theme.textGhost
          : isEditing
            ? isSel ? theme.accent : theme.textDim
            : theme.textGhost;
        const valCol = isGhosted
          ? theme.textGhost
          : isEditing
            ? isSel ? theme.accent : theme.text
            : theme.textFaint;
        return (
          <Box key={label} flexDirection="row">
            <Text color={isSel ? theme.accent : theme.textFaint}>
              {isSel ? ">" : " "}
            </Text>
            <Text>{" "}</Text>
            <Text color={labelCol}>{label.padEnd(6)}</Text>
            <Text bold={isSel} color={valCol}>{formatFieldValue(vals, i)}</Text>
          </Box>
        );
      })}
      {Array.from({ length: brailleRows }, (_, i) => (
        <Text key={`g${i}`} color={theme.accent}>
          {waveLines[i] ?? " ".repeat(brailleCols)}
        </Text>
      ))}
      <Text color={theme.textGhost} wrap="truncate">{footerText}</Text>
    </Box>
  );
}

export { SHAPES_WITH_OFF };
