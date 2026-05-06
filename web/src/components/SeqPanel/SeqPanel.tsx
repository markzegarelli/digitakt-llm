import React from "react";
import type { DigitaktState } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

export function SeqPanel({ focused, className, onFocus }: Props) {
  return (
    <div className={`seq-panel panel ${focused ? "focused" : ""} ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>SEQ</div>
      <div className="panel-body">[ step grid placeholder ]</div>
    </div>
  );
}
