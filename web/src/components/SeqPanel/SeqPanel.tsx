import React, { useCallback } from "react";
import type { DigitaktState, TrackName } from "../../backend/types.js";
import { TRACK_NAMES } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import "./SeqPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

function stepDot(velocity: number): string {
  if (velocity === 0) return "·";
  if (velocity <= 63) return "○";
  if (velocity <= 100) return "●";
  return "■";
}

export function SeqPanel({ state, actions, focused, className, onFocus }: Props) {
  const { current_pattern, pattern_length, current_step, track_muted, is_playing } = state;

  const toggleStep = useCallback((track: TrackName, step: number) => {
    const cur = current_pattern[track][step];
    actions.setVel(track, step, cur > 0 ? 0 : 100);
  }, [current_pattern, actions]);

  const cols = `80px repeat(${pattern_length}, 1fr)`;

  return (
    <div className={`seq-panel panel ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>SEQ</div>
      <div className="seq-grid" style={{ gridTemplateColumns: cols }}>
        {TRACK_NAMES.map((track) => (
          <React.Fragment key={track}>
            <div className={`seq-track-name ${track_muted[track] ? "muted" : ""}`}>
              {track}
            </div>
            {Array.from({ length: pattern_length }, (_, step) => {
              const vel = current_pattern[track][step] ?? 0;
              const isPlayhead = is_playing && current_step === step;
              return (
                <div
                  key={step}
                  className={`seq-step ${vel > 0 ? "on" : ""} ${isPlayhead ? "playhead" : ""} ${track_muted[track] ? "muted" : ""}`}
                  onClick={(e) => { e.stopPropagation(); toggleStep(track, step); }}
                  title={`${track} step ${step + 1}: vel ${vel}`}
                >
                  {stepDot(vel)}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
