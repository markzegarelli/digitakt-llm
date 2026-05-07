import React from "react";
import type { DigitaktState, TrackName } from "../../backend/types.js";
import { TRACK_NAMES } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import { Region } from "../Region.js";
import "./TrigPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

const MIDI_NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function midiToName(n: number | null): string {
  if (n === null) return "—";
  const oct = Math.floor(n / 12) - 1;
  return `${MIDI_NOTE_NAMES[n % 12]}${oct}`;
}

type TrigParam = "prob" | "gate" | "note" | "cond";

const PARAMS: { id: TrigParam; label: string }[] = [
  { id: "prob", label: "PROB" },
  { id: "gate", label: "GATE" },
  { id: "note", label: "NOTE" },
  { id: "cond", label: "COND" },
];

export function TrigPanel({ state, focused, className, onFocus }: Props) {
  const step  = state.current_step ?? 0;
  const track = TRACK_NAMES[0] as TrackName;
  const trig  = state.pattern_trig;

  const prob = trig.prob[track]?.[step] ?? 100;
  const gate = trig.gate[track]?.[step] ?? 50;
  const note = trig.note[track]?.[step] ?? null;
  const cond = trig.cond[track]?.[step] ?? null;

  const values: Record<TrigParam, string> = {
    prob: `${prob}%`,
    gate: `${gate}%`,
    note: midiToName(note),
    cond: cond ?? "—",
  };

  const trackLabel = track.slice(0, 4).toUpperCase();
  const stepLabel  = `s${String(step + 1).padStart(2, "0")}`;

  return (
    <Region
      title="TRIG · step params"
      focused={focused}
      right={`${trackLabel} · ${stepLabel}`}
      className={`trig-panel${className ? ` ${className}` : ""}`}
    >
      <div className="trig-body" onClick={onFocus}>
        <pre className="trig-rows">
          {PARAMS.map(({ id, label }, i) => {
            const active = focused && i === 0;
            const indicator = active ? "▶" : " ";
            const lbl = label.padEnd(5, " ");
            const val = values[id].padStart(6, " ");
            const color = active ? "var(--accent)" : id === "cond" && cond ? "var(--amber)" : "var(--fg)";
            return (
              <span key={id} style={{ color }}>
                {`${indicator} ${lbl}${val}\n`}
              </span>
            );
          })}
        </pre>
      </div>
    </Region>
  );
}
