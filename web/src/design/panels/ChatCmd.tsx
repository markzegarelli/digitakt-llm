import React, { useEffect, useRef } from "react";
import type { WorkbenchView } from "../../lib/viewModel.js";
import type { UiDispatch } from "../../hooks/useUiState.js";
import { COMMANDS } from "../constants.js";
import { canRunCmd, parseCmd, dispatchCommand, type ParsedCmd } from "../../lib/commandDispatch.js";
import type { CommandContext } from "../../lib/commandDispatch.js";
import { handleTabCycle, releaseTextFocus } from "../../hooks/useKeyboard.js";

export function ChatColumn({
  view,
  focused,
  dispatch,
  onSend,
  focusAppRoot,
}: {
  view: WorkbenchView;
  focused: boolean;
  dispatch: UiDispatch;
  onSend: (text: string) => void;
  focusAppRoot?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [view.ui.chat.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="panel-subhead">
        <span className={focused ? "cb b" : "d b"}>CHAT</span>
        <span className="d">claude · {view.ui.chat.length} msgs</span>
      </div>
      <div ref={scrollRef} className="scroll chat-log">
        {view.ui.chat.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ color: m.who === "user" ? "var(--yellow)" : m.who === "llm" ? "var(--cool)" : "var(--text-faint)", fontWeight: 600 }}>
                {m.who}
              </span>
              <span className="f" style={{ fontSize: 10 }}>{m.t}</span>
            </div>
            <div style={{ paddingLeft: 36, lineHeight: 1.5 }}>{m.text}</div>
          </div>
        ))}
      </div>
      <ChatComposer
        view={view}
        focused={focused}
        dispatch={dispatch}
        onSend={onSend}
        focusAppRoot={focusAppRoot}
      />
    </div>
  );
}

function ChatComposer({
  view,
  focused,
  dispatch,
  onSend,
  focusAppRoot,
}: {
  view: WorkbenchView;
  focused: boolean;
  dispatch: UiDispatch;
  onSend: (text: string) => void;
  focusAppRoot?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focused) inputRef.current?.focus();
    else inputRef.current?.blur();
  }, [focused]);

  return (
    <div className={focused ? "chat-composer focused" : "chat-composer"}>
      <span className={focused ? "cb b" : "d"}>›</span>
      <input
        ref={inputRef}
        tabIndex={-1}
        value={view.ui.cmd}
        placeholder={focused ? "tell claude what to do…" : "press C or /"}
        onChange={(e) => dispatch({ type: "SET_CMD", value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            handleTabCycle(e.nativeEvent, view, dispatch, focusAppRoot);
            return;
          }
          if (e.key === "Enter" && view.ui.cmd.trim()) {
            onSend(view.ui.cmd.trim());
            dispatch({ type: "SET_CMD", value: "" });
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (e.key === "Escape") {
            releaseTextFocus(focusAppRoot);
            dispatch({ type: "MODE", value: view.ui.prevMode || "SEQ" });
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}

export function CommandBar({
  view,
  dispatch,
  cmdCtx,
  focusAppRoot,
}: {
  view: WorkbenchView;
  dispatch: UiDispatch;
  cmdCtx: CommandContext;
  focusAppRoot?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (view.ui.mode === "CMD") inputRef.current?.focus();
    else inputRef.current?.blur();
  }, [view.ui.mode]);
  if (view.ui.mode !== "CMD") return null;

  const parsed = parseCmd(view.ui.cmd, COMMANDS);
  const allSuggestions = parsed.mode === "name" ? (parsed.matches ?? []) : (parsed.suggestions ?? []);
  const highlight = Math.min(view.ui.cmdHighlight, Math.max(0, allSuggestions.length - 1));
  const runnable = canRunCmd(parsed);

  return (
    <>
      <div className="cmd-palette">
        <div className="cmd-palette-head">
          {parsed.mode === "name" ? (
            <span className="d">Command palette · {allSuggestions.length} matches</span>
          ) : (
            <span className="y b">{parsed.cmd?.name}</span>
          )}
        </div>
        <div className="cmd-suggestions scroll">
          {parsed.mode === "name"
            ? allSuggestions.map((c, i) => (
                <div key={c.name} className={i === highlight ? "cmd-item sel" : "cmd-item"}>
                  <span className="y">:{c.name}</span>
                  <span className="d">{c.desc}</span>
                </div>
              ))
            : runnable ? (
                <div className="d" style={{ padding: 8 }}>✓ ready · ENTER to run</div>
              ) : (
                <div className="d" style={{ padding: 8 }}>enter params…</div>
              )}
        </div>
      </div>
      <div className="cmd-input-bar">
        <span className="y b">CMD ›</span>
        <input
          ref={inputRef}
          tabIndex={-1}
          value={view.ui.cmd}
          onChange={(e) => dispatch({ type: "SET_CMD", value: e.target.value })}
          onKeyDown={(e) => onCmdKey(e, view, dispatch, parsed, runnable, allSuggestions, highlight, cmdCtx, focusAppRoot)}
          placeholder="type a command…"
        />
      </div>
    </>
  );
}

function onCmdKey(
  e: React.KeyboardEvent,
  view: WorkbenchView,
  dispatch: UiDispatch,
  parsed: ParsedCmd,
  canRun: boolean,
  suggestions: unknown[],
  highlight: number,
  cmdCtx: CommandContext,
  focusAppRoot?: () => void,
) {
  const k = e.key;
  if (k === "Tab") {
    handleTabCycle(e.nativeEvent, view, dispatch, focusAppRoot);
    return;
  }
  if (k === "Escape") {
    e.preventDefault();
    releaseTextFocus(focusAppRoot);
    dispatch({ type: "MODE", value: view.ui.prevMode || "SEQ" });
    return;
  }
  if (k === "ArrowDown") {
    e.preventDefault();
    dispatch({ type: "SET_CMD_HIGHLIGHT", value: Math.min(suggestions.length - 1, highlight + 1) });
    return;
  }
  if (k === "ArrowUp") {
    e.preventDefault();
    dispatch({ type: "SET_CMD_HIGHLIGHT", value: Math.max(0, highlight - 1) });
    return;
  }
  if (k === "Enter") {
    e.preventDefault();
    if (parsed.mode === "name" && parsed.matches?.length) {
      const choice = parsed.matches[highlight]!;
      dispatch({ type: "SET_CMD", value: choice.params?.length ? `${choice.name} ` : choice.name });
      return;
    }
    if (canRun) {
      void dispatchCommand(`:${view.ui.cmd}`, cmdCtx).then(() => {
        dispatch({ type: "CMD_HISTORY", cmd: view.ui.cmd });
        dispatch({ type: "MODE", value: view.ui.prevMode || "SEQ" });
        dispatch({ type: "SET_CMD", value: "" });
      });
    }
  }
}
