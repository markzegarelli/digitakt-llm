import React from "react";
import type { DigitaktState } from "../../backend/types.js";

interface Props { state: DigitaktState; className?: string; }

export function StatusBar({ state, className }: Props) {
  return (
    <div className={`status-bar panel ${className ?? ""}`}>
      <span>{Math.round(state.bpm)} BPM</span>
      <span>{state.is_playing ? "▶ PLAYING" : "■ STOPPED"}</span>
      <span>{state.connected ? "CONNECTED" : "..."}</span>
    </div>
  );
}
