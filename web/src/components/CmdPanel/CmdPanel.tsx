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

export function CmdPanel({ focused, className, onFocus }: Props) {
  return (
    <div className={`cmd-panel panel ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>CMD</div>
      <div className="panel-body">[ command input ]</div>
    </div>
  );
}
