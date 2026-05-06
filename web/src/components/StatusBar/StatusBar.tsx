import React from "react";
import type { DigitaktState } from "../../backend/types.js";
import "./StatusBar.css";

interface Props { state: DigitaktState; className?: string; }

export function StatusBar({ state, className }: Props) {
  return (
    <div className={`status-bar ${className ?? ""}`}>
      <span>{Math.round(state.bpm)} BPM</span>
      <span className="sep">|</span>
      <span className={state.is_playing ? "playing" : "stopped"}>
        {state.is_playing ? "▶ PLAYING" : "■ STOPPED"}
      </span>
      <span className="sep">|</span>
      <span>SW {state.swing}</span>
      <span className="sep">|</span>
      <span>{state.pattern_length} steps</span>
      <span className="sep">|</span>
      <span className={state.midi_connected ? "midi-ok" : "midi-off"}>
        MIDI {state.midi_connected ? (state.midi_port_name ?? "OK") : "—"}
      </span>
      {state.fill_active && (
        <><span className="sep">|</span><span className="fill">FILL</span></>
      )}
      {!state.connected && (
        <><span className="sep">|</span><span className="disconnected">DISCONNECTED</span></>
      )}
    </div>
  );
}
