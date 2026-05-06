import React from "react";
import type { DigitaktState, TrackName } from "../../backend/types.js";
import { TRACK_NAMES } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import "./MixPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

export function MixPanel({ state, focused, className, onFocus }: Props) {
  const { ccParams, track_cc } = state;

  return (
    <div className={`mix-panel panel ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>MIX</div>
      {ccParams.length === 0 ? (
        <div className="mix-empty">no CC params</div>
      ) : (
        <div className="mix-list">
          {ccParams.slice(0, 8).map((param) =>
            TRACK_NAMES.map((track) => {
              const val = track_cc[track]?.[param.name] ?? param.default;
              return (
                <div key={`${track}-${param.name}`} className="mix-row">
                  <span className="mix-track">{track}</span>
                  <span className="mix-param">{param.name}</span>
                  <div className="mix-bar">
                    <div className="mix-bar-fill" style={{ width: `${(val / 127) * 100}%` }} />
                  </div>
                  <span className="mix-value">{val}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
