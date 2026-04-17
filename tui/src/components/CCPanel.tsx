import React from "react";
import { Box, Text } from "ink";
import type { DigitaktState, TrackName, CCParamDef, PatternTrigState } from "../types.js";
import { DEFAULT_GATE_PCT, TRACK_NAMES } from "../types.js";
import { theme } from "../theme.js";

interface CCPanelProps {
  /** Inner width of the bordered panel — widens the value bar on large terminals. */
  contentWidth: number;
  ccParams: CCParamDef[];
  trackCC: DigitaktState["track_cc"];
  stepCC: DigitaktState["step_cc"];
  /** Per-step prob/gate/cond from the live pattern (incl. LLM output). */
  patternTrig: PatternTrigState;
  patternLength: number;
  currentStep: number | null;
  selectedTrack: number;  // 0–7
  trackMuted?: DigitaktState["track_muted"];
  pendingMuteTracks?: Set<TrackName>;
  selectedParam: number;  // index into ccParams
  isFocused: boolean;
  stepMode: boolean;
  selectedStep: number;        // 0–15 (only relevant when stepMode=true)
  stepInputBuffer: string;     // digits being typed in step-edit mode
}

/** Border+pad (4) + fixed row chrome before/after the `[` … `]` bar (~24). */
const MIX_BAR_OVERHEAD = 28;

function barGraph(value: number, barWidth: number): string {
  const w = Math.max(12, barWidth);
  const filled = Math.round((value / 127) * w);
  return "█".repeat(filled) + "░".repeat(w - filled);
}

// Fixed-width 3-char display for a step cell: override value or "  ·"
function stepCell(value: number | null | undefined): string {
  if (value === null || value === undefined) return "  ·";
  return String(value).padStart(3);
}

export function CCPanel({
  contentWidth,
  ccParams,
  trackCC,
  stepCC,
  patternTrig,
  patternLength,
  currentStep,
  selectedTrack,
  trackMuted,
  pendingMuteTracks = new Set(),
  selectedParam,
  isFocused,
  stepMode,
  selectedStep,
  stepInputBuffer,
}: CCPanelProps) {
  const barSlots = Math.max(16, Math.min(96, contentWidth - MIX_BAR_OVERHEAD));
  const trackName = TRACK_NAMES[selectedTrack] as TrackName;
  const cc = trackCC[trackName];
  const playIdx = currentStep !== null && currentStep >= 0 ? currentStep : 0;
  const probHere = patternTrig.prob[trackName]?.[playIdx] ?? 100;
  const gateHere = patternTrig.gate[trackName]?.[playIdx] ?? DEFAULT_GATE_PCT;
  const condHere = patternTrig.cond[trackName]?.[playIdx] ?? null;
  const trigSummary =
    `s${playIdx + 1} prob ${probHere}% gate ${gateHere}%` +
    (condHere ? ` cond ${condHere}` : "");

  const rows: Array<{ key: string; label: string; value: number }> = ccParams.map((def) => ({
    key: def.name,
    label: def.name,
    value: cc?.[def.name] ?? def.default,
  }));

  const hintText = stepMode
    ? "←→: step  ↑↓: ±1  Shift+↑↓: ±10  0-9: type value  ⌫: del/global  Enter: confirm  Esc: exit"
    : "[ ]: track  ↑↓: param  ←→: ±1  Shift+←→: ±10  Enter: step mode";

  const borderCol = isFocused ? theme.borderActive : theme.border;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={borderCol} paddingX={1} width={contentWidth}>
      <Box flexWrap="nowrap">
        <Text bold color={theme.textDim}>MIX </Text>
        {TRACK_NAMES.map((t, i) => {
          const muted = trackMuted?.[t] ?? false;
          const queued = pendingMuteTracks.has(t);
          const sel = i === selectedTrack;
          const showBadge = muted || queued;
          const badgeMuted = muted ? "M" : "·";
          const badgeQueue = queued ? "Q" : "·";
          const badgeColor = queued ? theme.warn : theme.error;
          return (
            <Box key={t} flexDirection="row">
              <Text bold={sel} color={sel ? theme.accent : theme.textDim}>
                {sel ? `[${t.toUpperCase()}]` : ` ${t} `}
              </Text>
              {showBadge ? (
                <Text bold color={badgeColor}>
                  {badgeMuted}
                  {badgeQueue}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginBottom={0}>
        <Text color={theme.textFaint}>{hintText}</Text>
      </Box>
      <Box marginBottom={0}>
        <Text color={theme.textDim}>TRIG </Text>
        <Text color={theme.accentMuted}>{trigSummary}</Text>
      </Box>
      {rows.map(({ key, label, value }, i) => {
        const isSelected = i === selectedParam;
        const col = isSelected && isFocused ? theme.accent : theme.text;
        const isStepEditing = isSelected && isFocused && stepMode;

        if (isStepEditing) {
          const param = ccParams[i]?.name ?? "";
          const stepOverrides = stepCC?.[trackName]?.[param] ?? null;
          // What value is the current step actually set to (stored, not preview)
          const storedValue = stepOverrides?.[selectedStep] ?? null;
          // Preview: show buffer if user is typing, otherwise stored value
          const previewValue = stepInputBuffer.length > 0
            ? parseInt(stepInputBuffer, 10)
            : storedValue;

          return (
            <Box key={key}>
              <Text color={theme.textFaint}>{`[${i}]`}</Text>
              {/* Single ASCII char selector — same pattern as PatternGrid */}
              <Text bold color={col}>{">"}</Text>
              <Text>{" "}</Text>
              <Text bold color={col}>{label.padEnd(10)}</Text>
              <Text color={theme.textFaint}>{"["}</Text>
              {Array.from({ length: patternLength }, (_, s) => {
                const isCurrentStep = s === selectedStep;
                const cellValue = isCurrentStep ? previewValue : (stepOverrides?.[s] ?? null);
                const isBuffering = isCurrentStep && stepInputBuffer.length > 0;
                return (
                  <Text
                    key={s}
                    bold={isCurrentStep}
                    color={
                      isCurrentStep
                        ? (isBuffering ? theme.warn : theme.accent)
                        : cellValue !== null ? theme.accentMuted : theme.textFaint
                    }
                  >
                    {stepCell(cellValue)}
                    {s < patternLength - 1 ? " " : ""}
                  </Text>
                );
              })}
              <Text color={theme.textFaint}>{"]"}</Text>
              {/* Fixed-width step label — always same width */}
              <Text bold color={theme.accent}>
                {" s"}{String(selectedStep + 1).padStart(2)}{": "}
                {stepInputBuffer.length > 0
                  ? `${stepInputBuffer}_`
                  : storedValue !== null ? String(storedValue) : "global"}
                {"  "}
              </Text>
            </Box>
          );
        }

        return (
          <Box key={key}>
            <Text color={theme.textFaint}>{`[${i}]`}</Text>
            {/* Single ASCII char selector — same pattern as PatternGrid */}
            <Text bold color={isSelected && isFocused ? theme.accent : undefined}>
              {isSelected && isFocused ? ">" : " "}
            </Text>
            <Text>{" "}</Text>
            <Text bold={isSelected} color={col}>{label.padEnd(10)}</Text>
            <Text color={theme.textFaint}>{"["}</Text>
            <Text color={isSelected && isFocused ? theme.accent : theme.accentSubtle}>{barGraph(value, barSlots)}</Text>
            <Text color={theme.textFaint}>{"]"}</Text>
            <Text>{"  "}</Text>
            <Text bold={isSelected} color={col}>{String(value).padStart(3)}</Text>
            {/* Fixed-width tail: space + ASCII char — matches the > prefix width */}
            <Text>{" "}</Text>
            <Text color={isSelected && isFocused ? theme.warn : undefined}>
              {isSelected && isFocused ? "<" : " "}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
