import React, { useCallback } from "react";
import type { DigitaktState, TrackName } from "../../backend/types.js";
import { TRACK_NAMES } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import { Region } from "../Region.js";
import "./SeqPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

function stepGlyph(
  vel: number,
  prob: number,
  cond: string | null,
  isPlayhead: boolean,
  isMuted: boolean,
): { ch: string; color: string; inverse: boolean } {
  if (vel === 0) {
    return { ch: "·", color: isPlayhead ? "var(--accent)" : "var(--dim3)", inverse: false };
  }
  const ch = vel < 45 ? "▁" : vel < 80 ? "○" : vel < 110 ? "●" : "●";
  let color = "var(--fg)";
  if (isMuted) color = "var(--dim3)";
  else if (cond) color = "var(--amber)";
  else if (prob < 100) color = "var(--dim1)";
  return { ch, color, inverse: isPlayhead };
}

const TRACK_LABELS: Record<TrackName, string> = {
  kick:    "KICK",
  snare:   "SNRE",
  tom:     "TOM ",
  clap:    "CLAP",
  bell:    "BELL",
  hihat:   "HHAT",
  openhat: "OHAT",
  cymbal:  "CYMB",
};

export function SeqPanel({ state, actions, focused, className, onFocus }: Props) {
  const { current_pattern, pattern_trig, pattern_length, current_step, is_playing, track_muted } = state;

  const toggleStep = useCallback((track: TrackName, step: number) => {
    const cur = current_pattern[track][step];
    actions.setVel(track, step, cur > 0 ? 0 : 100);
  }, [current_pattern, actions]);

  const labelW = 48;
  const cellMinW = 18;
  // Build grid-template-columns: label col + step cols with group gaps every 4
  const groups = Math.ceil(pattern_length / 4);
  const stepColsArr: string[] = [];
  for (let g = 0; g < groups; g++) {
    const stepsInGroup = Math.min(4, pattern_length - g * 4);
    for (let s = 0; s < stepsInGroup; s++) {
      stepColsArr.push(`minmax(${cellMinW}px, 1fr)`);
    }
    if (g < groups - 1) stepColsArr.push("14px"); // group gap column
  }
  const gridCols = `${labelW}px ${stepColsArr.join(" ")}`;

  return (
    <Region title="SEQ" focused={focused} className={`seq-panel${className ? ` ${className}` : ""}`}>
      <div className="seq-grid" style={{ gridTemplateColumns: gridCols }} onClick={onFocus}>
        {TRACK_NAMES.map((track) => {
          const muted = track_muted[track];
          const prob  = pattern_trig.prob[track];
          const cond  = pattern_trig.cond[track];

          const stepCells: React.ReactNode[] = [];
          for (let g = 0; g < groups; g++) {
            for (let s = 0; s < 4 && g * 4 + s < pattern_length; s++) {
              const step = g * 4 + s;
              const vel  = current_pattern[track][step] ?? 0;
              const isPlayhead = is_playing && current_step === step;
              const { ch, color, inverse } = stepGlyph(
                vel,
                prob?.[step] ?? 100,
                cond?.[step] ?? null,
                isPlayhead,
                muted,
              );
              stepCells.push(
                <div
                  key={step}
                  className={`seq-cell${inverse ? " playhead" : ""}`}
                  style={{ color: inverse ? "var(--accent-ink)" : color }}
                  onClick={(e) => { e.stopPropagation(); toggleStep(track, step); }}
                  title={`${track} s${step + 1} vel:${vel}`}
                >
                  {ch}
                </div>
              );
            }
            if (g < groups - 1) {
              stepCells.push(<div key={`gap-${g}`} className="seq-group-gap" />);
            }
          }

          return (
            <React.Fragment key={track}>
              <div className={`seq-label${muted ? " muted" : ""}`}>
                {TRACK_LABELS[track]}
              </div>
              {stepCells}
            </React.Fragment>
          );
        })}
      </div>
    </Region>
  );
}
