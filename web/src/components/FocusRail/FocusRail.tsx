import React from "react";
import type { FocusZone } from "../../App.js";
import "./FocusRail.css";

const ITEMS: { id: FocusZone; label: string }[] = [
  { id: "seq", label: "SEQ" },
  { id: "mix", label: "MIX" },
  { id: "trig", label: "TRIG" },
  { id: "cmd", label: "CMD" },
];

interface Props {
  focus: FocusZone;
  setFocus: (f: FocusZone) => void;
  isPlaying: boolean;
  showLog: boolean;
}

export function FocusRail({ focus, setFocus, isPlaying, showLog }: Props) {
  return (
    <div className="focus-rail-inner">
      <pre className="rail-logo" aria-hidden="true">{`┌────────┐
│  DGTK  │
└────────┘`}</pre>

      {ITEMS.map((item) => {
        const active = focus === item.id;
        return (
          <pre
            key={item.id}
            className={`rail-item${active ? " active" : ""}`}
            onClick={() => setFocus(item.id)}
          >
            {active ? "▶ " : "  "}{item.label}
          </pre>
        );
      })}

      <pre className="rail-hints">{`── hints ──
tab   cycle
space play
alt+l log${showLog ? " ▣" : ""}`}</pre>

      <pre className="rail-status">{isPlaying ? "▶ playing" : "■ stopped"}</pre>
    </div>
  );
}
