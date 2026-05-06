import React from "react";
import type { DigitaktState } from "../../backend/types.js";
import { TRACK_NAMES } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import "./TrigPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

export function TrigPanel({ state, focused, className, onFocus }: Props) {
  const step = state.current_step ?? 0;
  const track = TRACK_NAMES[0];
  const prob = state.pattern_trig.prob[track]?.[step] ?? 100;
  const gate = state.pattern_trig.gate[track]?.[step] ?? 50;
  const cond = state.pattern_trig.cond[track]?.[step] ?? null;
  const note = state.pattern_trig.note[track]?.[step] ?? null;

  return (
    <div className={`trig-panel panel ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>TRIG</div>
      <div className="trig-body">
        <div className="trig-step-info">step {step + 1} · {track}</div>
        <div className="trig-row">
          <span className="trig-label">PROB</span>
          <span className="trig-value">{prob}%</span>
        </div>
        <div className="trig-row">
          <span className="trig-label">GATE</span>
          <span className="trig-value">{gate}%</span>
        </div>
        <div className="trig-row">
          <span className="trig-label">NOTE</span>
          <span className="trig-value">{note ?? "—"}</span>
        </div>
        <div className="trig-row">
          <span className="trig-label">COND</span>
          <span className="trig-value">{cond ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
