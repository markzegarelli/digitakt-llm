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

export function TrigPanel({ focused, className, onFocus }: Props) {
  return (
    <div className={`trig-panel panel ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>TRIG</div>
      <div className="panel-body">[ trig edit ]</div>
    </div>
  );
}
