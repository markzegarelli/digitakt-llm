import React, { useState, useRef, useCallback, useEffect } from "react";
import type { DigitaktState } from "../../backend/types.js";
import type { DigitaktActions } from "../../hooks/useDigitakt.js";
import "./CmdPanel.css";

interface Props {
  state: DigitaktState;
  actions: DigitaktActions;
  focused: boolean;
  className?: string;
  onFocus(): void;
}

const HISTORY_LIMIT = 100;

export function CmdPanel({ state, actions, focused, className, onFocus }: Props) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);

  const submit = useCallback((raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    setHistory((h) => [cmd, ...h].slice(0, HISTORY_LIMIT));
    setHistIdx(-1);
    setValue("");

    if (cmd.startsWith("/fresh ")) {
      actions.generate(cmd.slice(7).trim(), false);
    } else if (cmd.startsWith("/generate ")) {
      actions.generate(cmd.slice(10).trim());
    } else if (cmd.startsWith("/bpm ")) {
      actions.setBpm(Number(cmd.slice(5)));
    } else if (cmd.startsWith("/swing ")) {
      actions.setSwing(Number(cmd.slice(7)));
    } else if (cmd === "/play" || cmd === "/start") {
      actions.play();
    } else if (cmd === "/stop") {
      actions.stop();
    } else if (cmd === "/new") {
      actions.callNew();
    } else if (cmd === "/undo") {
      actions.callUndo();
    } else if (cmd === "/midi") {
      actions.connectMidi();
    } else if (cmd === "/randbeat") {
      actions.randbeat();
    } else if (!cmd.startsWith("/")) {
      actions.generate(cmd);
    }
  }, [actions]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setValue(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setValue(next === -1 ? "" : (history[next] ?? ""));
    } else if (e.key === "Escape") {
      setValue("");
      setHistIdx(-1);
    }
  }, [value, submit, history, histIdx]);

  const statusText = state.generation_status === "generating"
    ? "⟳ generating..."
    : state.generation_status === "failed"
    ? (state.generation_error ?? "generation failed")
    : state.generation_summary
    ? `✓ ${state.generation_summary.track_summary}`
    : "";

  return (
    <div className={`cmd-panel panel ${className ?? ""}`} onClick={onFocus}>
      <div className={`panel-header ${focused ? "focused" : ""}`}>CMD</div>
      <div className="cmd-body">
        <div className={`cmd-status ${state.generation_status}`}>{statusText}</div>
        <div className="cmd-input-row">
          <span className="cmd-prompt-char">›</span>
          <input
            ref={inputRef}
            className="cmd-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            placeholder="type a prompt or /command"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
