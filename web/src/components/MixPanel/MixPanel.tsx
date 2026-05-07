import React from "react";
import type { DigitaktState, TrackName } from "../../backend/types.js";
import { TRACK_NAMES } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import { Region } from "../Region.js";
import "./MixPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

const BAR_W = 14;

function barChars(val: number, max = 127): string {
  const filled = Math.round((val / max) * BAR_W);
  return "█".repeat(filled) + "░".repeat(BAR_W - filled);
}

export function MixPanel({ state, focused, className, onFocus }: Props) {
  const { ccParams, track_cc, track_muted } = state;

  // Show the first CC param across all tracks, or volume as fallback
  const primaryParam = ccParams[0];

  return (
    <Region
      title="MIX · cc lanes"
      focused={focused}
      className={`mix-panel${className ? ` ${className}` : ""}`}
      style={{ cursor: "default" }}
    >
      <div className="mix-body" onClick={onFocus}>
        {ccParams.length === 0 ? (
          <pre className="mix-empty">no CC params</pre>
        ) : (
          <pre className="mix-rows">
            {TRACK_NAMES.map((track) => {
              const val = primaryParam
                ? (track_cc[track]?.[primaryParam.name] ?? primaryParam.default)
                : 0;
              const muted = track_muted[track];
              const label = (track.slice(0, 4).toUpperCase()).padEnd(5, " ");
              const bar   = barChars(val);
              const num   = String(val).padStart(3, " ");
              return (
                <span
                  key={track}
                  className={`mix-row${muted ? " muted" : ""}`}
                >
                  {`${label} `}
                  <span className="mix-bar">{bar}</span>
                  {` ${num}`}
                  {"\n"}
                </span>
              );
            })}
          </pre>
        )}
        {primaryParam && (
          <pre className="mix-param-label">{primaryParam.name}</pre>
        )}
      </div>
    </Region>
  );
}
