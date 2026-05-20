import { useReducer, useCallback } from "react";
import type { UiState, ChatMessage } from "../lib/viewModel.js";
import { defaultUiState, nowTag } from "../lib/viewModel.js";
import type { UiMode } from "../design/constants.js";

export type UiAction =
  | { type: "MODE"; value: UiMode }
  | { type: "SET_CMD"; value: string }
  | { type: "SET_CMD_HIGHLIGHT"; value: number }
  | { type: "MOVE"; axis: keyof UiState["cursor"]; delta: number }
  | { type: "TRACK_DELTA"; delta: number }
  | { type: "LFO_SWITCH"; delta?: number; set?: number }
  | { type: "HELP_TOGGLE" }
  | { type: "HELP_SET"; value: boolean }
  | { type: "CHAT_APPEND"; msg: ChatMessage }
  | { type: "CHAT_RESOLVE_PENDING"; text: string; delta?: [string, number][] }
  | { type: "CHAT_SYS"; text: string; startMs: number }
  | { type: "SET_PATTERN_META"; index: number; name: string }
  | { type: "CMD_HISTORY"; cmd: string };

function reducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case "MODE": {
      const next = a.value;
      if (next === s.mode) return s;
      let lastWorkbench = s.lastWorkbench;
      if (s.mode === "TRIG" || s.mode === "MIX" || s.mode === "LFO") lastWorkbench = s.mode;
      return {
        ...s,
        prevMode: s.mode,
        mode: next,
        lastWorkbench,
        cmd: next === "CMD" ? "" : s.cmd,
        cmdHighlight: 0,
      };
    }
    case "SET_CMD":
      return { ...s, cmd: a.value, cmdHighlight: 0 };
    case "SET_CMD_HIGHLIGHT":
      return { ...s, cmdHighlight: a.value };
    case "MOVE": {
      const c = { ...s.cursor };
      const { axis, delta } = a;
      if (axis === "track") c.track = (c.track + delta + 8) % 8;
      if (axis === "step") c.step = (c.step + delta + 16) % 16;
      if (axis === "mixParam") c.mixParam = (c.mixParam + delta + 8) % 8;
      if (axis === "trigField") c.trigField = (c.trigField + delta + 6) % 6;
      if (axis === "lfoField") c.lfoField = (c.lfoField + delta + 6) % 6;
      return { ...s, cursor: c };
    }
    case "TRACK_DELTA": {
      const newTrack = (s.cursor.track + a.delta + 8) % 8;
      return { ...s, cursor: { ...s.cursor, track: newTrack } };
    }
    case "LFO_SWITCH": {
      const n = 10;
      let idx = s.cursor.lfoIdx;
      if (a.set != null) idx = Math.max(0, Math.min(n - 1, a.set));
      else if (a.delta != null) idx = (idx + a.delta + n) % n;
      return { ...s, cursor: { ...s.cursor, lfoIdx: idx } };
    }
    case "HELP_TOGGLE":
      return { ...s, helpOpen: !s.helpOpen };
    case "HELP_SET":
      return { ...s, helpOpen: a.value };
    case "CHAT_APPEND":
      return { ...s, chat: [...s.chat, a.msg] };
    case "CHAT_RESOLVE_PENDING": {
      const chat = s.chat.filter((m) => !m.pending);
      chat.push({ who: "llm", t: nowTag(0), text: a.text, delta: a.delta });
      return { ...s, chat, cmd: "" };
    }
    case "CHAT_SYS":
      return {
        ...s,
        chat: [...s.chat, { who: "sys", t: nowTag(a.startMs), text: a.text }],
      };
    case "SET_PATTERN_META":
      return { ...s, patternIndex: a.index, patternName: a.name };
    case "CMD_HISTORY":
      return { ...s, cmdHistory: [...s.cmdHistory, a.cmd].slice(-50), cmdHistoryIdx: -1 };
    default:
      return s;
  }
}

export function useUiState() {
  const [ui, dispatch] = useReducer(reducer, undefined, defaultUiState);
  const setMode = useCallback((value: UiMode) => dispatch({ type: "MODE", value }), []);
  return { ui, dispatch, setMode };
}

export type UiDispatch = (action: UiAction) => void;
