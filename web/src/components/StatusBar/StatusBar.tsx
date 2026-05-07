import React from "react";
import type { DigitaktState } from "../../backend/types.js";
import "./StatusBar.css";

interface Props { state: DigitaktState; className?: string; }

const SEP = <span className="hdr-sep">  │  </span>;

export function StatusBar({ state, className }: Props) {
  const midiColor = state.midi_connected ? "var(--good)" : "var(--dim2)";
  const playColor = state.is_playing ? "var(--accent)" : "var(--dim1)";

  return (
    <pre className={`app-header${className ? ` ${className}` : ""}`}>
      <span className="hdr-brand">● DGTK</span>
      <span className="hdr-sub">  digital sequencer  </span>
      {SEP}
      <span className="hdr-label">BPM </span>
      <span className="hdr-value">{state.bpm.toFixed(1)}</span>
      {SEP}
      <span style={{ color: playColor }}>
        {state.is_playing ? "▶ PLAY" : "■ STOP"}
      </span>
      {SEP}
      <span className="hdr-label">SW </span>
      <span className="hdr-value">{state.swing}</span>
      {SEP}
      <span className="hdr-label">LEN </span>
      <span className="hdr-value">{state.pattern_length}</span>
      {SEP}
      <span style={{ color: midiColor }}>
        MIDI {state.midi_connected ? `● ${state.midi_port_name ?? "OK"}` : "—"}
      </span>
      {state.fill_active && <>{SEP}<span className="hdr-fill">FILL</span></>}
      {!state.connected && <>{SEP}<span className="hdr-disconnected">OFFLINE</span></>}
    </pre>
  );
}
