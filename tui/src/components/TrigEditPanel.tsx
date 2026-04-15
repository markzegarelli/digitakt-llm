import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { TrackName } from "../types.js";

const FIELD_KEYS = ["prob", "vel", "note", "gate", "cond"] as const;
export type TrigFieldKey = (typeof FIELD_KEYS)[number];

const LABELS: Record<TrigFieldKey, string> = {
  prob: "probability %",
  vel: "velocity",
  note: "note (MIDI)",
  gate: "length (gate %)",
  cond: "condition",
};

interface TrigEditPanelProps {
  width: number;
  track: TrackName;
  stepIndex: number;
  prob: number;
  velocity: number;
  pitch: number;
  gate: number;
  cond: string | null;
  selectedField: number;
  /** Digits being typed for the selected numeric field (prob/vel/note/gate). */
  inputBuffer: string;
}

function condLabel(c: string | null): string {
  if (c === null || c === undefined) return "—";
  if (c === "1:2") return "1:2";
  if (c === "not:2") return "not:2";
  if (c === "fill") return "fill";
  return String(c);
}

export function TrigEditPanel({
  width,
  track,
  stepIndex,
  prob,
  velocity,
  pitch,
  gate,
  cond,
  selectedField,
  inputBuffer,
}: TrigEditPanelProps) {
  const stored: Record<TrigFieldKey, string> = {
    prob: String(prob),
    vel: String(velocity),
    note: String(pitch),
    gate: String(gate),
    cond: condLabel(cond),
  };

  const displayValue = (i: number, key: TrigFieldKey): string => {
    const active = i === selectedField;
    const isNumeric = key !== "cond";
    if (active && isNumeric && inputBuffer.length > 0) {
      return `${inputBuffer}_`;
    }
    return stored[key];
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.borderActive}
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      <Text bold color={theme.accent}>
        TRIG {track.toUpperCase()} s{stepIndex + 1}
      </Text>
      <Text color={theme.textFaint}>
        ↑↓ row  ←→ value  Shift+←→ ±10  0-9 type  Enter apply  Esc close
      </Text>
      {FIELD_KEYS.map((key, i) => {
        const active = i === selectedField;
        return (
          <Box key={key}>
            <Text color={active ? theme.accent : theme.textDim}>
              {active ? ">" : " "}
            </Text>
            <Text> </Text>
            <Text bold={active} color={active ? theme.text : theme.textDim}>
              {LABELS[key].padEnd(18)}
            </Text>
            <Text bold={active} color={active ? theme.accent : theme.text}>
              {displayValue(i, key)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
