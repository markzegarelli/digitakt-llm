import React from "react";
import type { WorkbenchView } from "../../lib/viewModel.js";
import { fmt2, fmtBpm } from "../constants.js";

export function Header({ view }: { view: WorkbenchView }) {
  const s = view;
  const patLabel = s.chainLabel || `${fmt2(s.ui.patternIndex)} ${s.ui.patternName}`;
  const cells = [
    { l: "·", v: s.playing ? "PLAY" : "STOP", c: s.playing ? "y" : "d" },
    { l: "BPM", v: fmtBpm(s.bpm), c: "y" },
    { l: "PAT", v: patLabel, c: "y" },
    { l: "BAR", v: String(s.bar), c: "y" },
    { l: "STP", v: `${s.playing ? Math.floor(s.playhead) + 1 : "—"}/${s.stepLen}`, c: "y" },
    { l: "SWG", v: String(s.swing), c: "y" },
    { l: "MIDI", v: s.midiPort, c: "y", dot: s.midiConnected },
    { l: "MUTE", v: String(s.tracks.filter((t) => t.muted).length), c: "r" },
    { l: "", v: s.version, c: "d" },
  ];
  return (
    <div className="workbench-header">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={`play-dot${s.playing ? " on" : ""}`} />
        <span className="y b" style={{ letterSpacing: "0.12em" }}>DGTK</span>
        {s.seqMode === "euclidean" ? <span className="d"> · EUCLID</span> : null}
      </div>
      {cells.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {c.l ? <span className="d" style={{ fontSize: 11 }}>{c.l}</span> : null}
          {"dot" in c && c.dot ? <span className="midi-dot" /> : null}
          <span className={c.c} style={{ fontWeight: 600 }}>{c.v}</span>
        </div>
      ))}
    </div>
  );
}

export function HelpStrip({ view }: { view: WorkbenchView }) {
  const groups = [
    { l: "?", v: "help" },
    { l: "TAB", v: "pane" },
    { l: "S/M/T/L/C", v: "jump" },
    { l: "⌘K", v: "cmd" },
    { l: "SPACE", v: "play" },
    { l: "ENTER", v: "trig" },
    { l: "[ ]", v: "track" },
    { l: "ESC", v: "back" },
  ];
  return (
    <div className="help-strip">
      <span className="d" style={{ flexShrink: 0 }}>
        MODE <span className="y b">{view.ui.mode}</span>
      </span>
      {groups.map((g, i) => (
        <span key={i} style={{ flexShrink: 0 }}>
          <span className="kbd">{g.l}</span> <span className="d">{g.v}</span>
        </span>
      ))}
      <span style={{ marginLeft: "auto", flexShrink: 0 }} className="f">? for full help</span>
    </div>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-overlay-inner" onClick={(e) => e.stopPropagation()}>
        <div className="help-overlay-title">HELP · DGTK WEB</div>
        <p className="d">Keyboard-first workbench. Shift-row and solo are not wired in web v1.</p>
        <p className="d">Press ? or ESC to close.</p>
      </div>
    </div>
  );
}
