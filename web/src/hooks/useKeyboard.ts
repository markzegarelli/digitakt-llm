import { useEffect, useRef } from "react";
import type { WorkbenchView } from "../lib/viewModel.js";
import type { UiDispatch } from "./useUiState.js";
import type { UiMode } from "../design/constants.js";
import { nextTabMode } from "../lib/tabCycle.js";

export interface KeyboardHandlers {
  toggleStep(): void;
  clearStep(): void;
  playStop(): void;
  muteImmediate(): void;
  muteStagePending(): void;
  muteFirePending(): void;
  nudgeMix(delta: number, shift: boolean): void;
  nudgeTrig(delta: number, shift: boolean): void;
  nudgeLfo(delta: number, shift: boolean): void;
  lfoAdd(): void;
  lfoDel(): void;
}

function cyclePane(
  st: WorkbenchView,
  dispatch: UiDispatch,
  shift: boolean,
  focusAppRoot?: () => void,
) {
  const nextMode = nextTabMode(st.ui.mode, st.ui.lastWorkbench, shift);
  dispatch({ type: "MODE", value: nextMode });
  releaseTextFocus(focusAppRoot);
}

/** Blur chat/cmd inputs and return focus to the workbench root. */
export function releaseTextFocus(focusAppRoot?: () => void) {
  if (typeof document === "undefined") return;
  const el = document.activeElement as HTMLElement | null;
  if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") el.blur();
  document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")?.blur();
  document.querySelector<HTMLInputElement>(".cmd-input-bar input")?.blur();
  focusAppRoot?.();
}

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "preventDefault" | "stopPropagation" | "stopImmediatePropagation"
>;

/** Tab pane-cycle (bubble fallback when capture already ran sets defaultPrevented). */
export function handleTabCycle(
  e: KeyLike,
  st: WorkbenchView,
  dispatch: UiDispatch,
  focusAppRoot?: () => void,
): boolean {
  if (st.ui.helpOpen || e.defaultPrevented) return false;
  if (e.key !== "Tab") return false;
  cyclePane(st, dispatch, e.shiftKey, focusAppRoot);
  e.preventDefault();
  return true;
}

function isHelpKey(key: string, shift: boolean): boolean {
  return key === "?" || (key === "/" && shift);
}

function isWorkbenchMuteKey(key: string, shift: boolean, ctrl: boolean, meta: boolean): boolean {
  if (ctrl || meta || shift) {
    return shift && key.toLowerCase() === "q";
  }
  const k = key.toLowerCase();
  return k === "m" || k === "q";
}

function handleMuteKeys(
  e: KeyboardEvent,
  st: WorkbenchView,
  handlers: KeyboardHandlers,
): boolean {
  if (st.ui.helpOpen || isTextEntryActive(st)) return false;
  const key = e.key;
  if (!isWorkbenchMuteKey(key, e.shiftKey, e.ctrlKey, e.metaKey)) return false;
  if (e.shiftKey && key.toLowerCase() === "q") {
    handlers.muteFirePending();
  } else if (key.toLowerCase() === "q") {
    handlers.muteStagePending();
  } else {
    handlers.muteImmediate();
  }
  e.preventDefault();
  return true;
}

function isTextEntryActive(st: WorkbenchView): boolean {
  if (typeof document === "undefined") {
    return st.ui.mode === "CMD";
  }
  const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
  const inInput = tag === "INPUT" || tag === "TEXTAREA";
  if (st.ui.mode === "CMD") return true;
  if (st.ui.mode === "CHAT") return inInput;
  return inInput;
}

/** Tab pane-cycle + Space transport; must run in capture before native tab focus. */
export function handlePaneKeys(
  e: KeyLike,
  st: WorkbenchView,
  dispatch: UiDispatch,
  handlers: KeyboardHandlers,
  focusAppRoot?: () => void,
): boolean {
  if (st.ui.helpOpen || e.defaultPrevented) return false;
  if (e.key === "Tab") {
    return handleTabCycle(e, st, dispatch, focusAppRoot);
  }
  if (e.key === " ") {
    if (isTextEntryActive(st)) return false;
    releaseTextFocus(focusAppRoot);
    handlers.playStop();
    e.preventDefault();
    return true;
  }
  return false;
}

export function useKeyboard(
  view: WorkbenchView,
  dispatch: UiDispatch,
  handlers: KeyboardHandlers,
  focusAppRoot?: () => void,
) {
  const viewRef = useRef(view);
  viewRef.current = view;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const focusRootRef = useRef(focusAppRoot);
  focusRootRef.current = focusAppRoot;

  useEffect(() => {
    function onGlobalCapture(e: KeyboardEvent) {
      handlePaneKeys(
        e,
        viewRef.current,
        dispatchRef.current,
        handlersRef.current,
        focusRootRef.current,
      );
    }

    function onKey(e: KeyboardEvent) {
      const st = viewRef.current;
      const key = e.key;
      const mod = e.shiftKey;
      const tag = (e.target as HTMLElement)?.tagName ?? "";

      if (isHelpKey(key, mod)) {
        if (st.ui.mode === "CMD" && st.ui.cmd.trim().length > 0) {
          // typed ? in CMD — fall through to input
        } else if (st.ui.mode === "CHAT" && (tag === "INPUT" || tag === "TEXTAREA")) {
          // typed ? in chat composer
        } else {
          dispatchRef.current({ type: "HELP_TOGGLE" });
          e.preventDefault();
          return;
        }
      }

      if (st.ui.helpOpen) {
        if (key === "Escape" || isHelpKey(key, mod)) {
          dispatchRef.current({ type: "HELP_SET", value: false });
          e.preventDefault();
        }
        return;
      }

      if (handleMuteKeys(e, st, handlersRef.current)) return;

      // Tab/Space handled in capture phase (including from chat/cmd inputs)
      if (key === "Tab" || key === " ") return;

      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (st.ui.mode !== "CHAT" && st.ui.mode !== "CMD") return;
      }

      if (st.ui.mode === "CHAT" || st.ui.mode === "CMD") {
        if (key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
          dispatchRef.current({
            type: "MODE",
            value: st.ui.mode === "CMD" ? st.ui.prevMode : "CMD",
          });
          e.preventDefault();
        }
        return;
      }

      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (key === "Escape") {
        if (st.ui.mode !== "SEQ") dispatchRef.current({ type: "MODE", value: "SEQ" });
        e.preventDefault();
        return;
      }
      if (key === ":" || (key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        dispatchRef.current({ type: "MODE", value: "CMD" });
        e.preventDefault();
        return;
      }
      if (key === "/") {
        dispatchRef.current({ type: "MODE", value: "CHAT" });
        e.preventDefault();
        return;
      }
      if (key === "Enter" && (st.ui.mode === "SEQ" || st.ui.mode === "TRIG")) {
        handlersRef.current.toggleStep();
        e.preventDefault();
        return;
      }
      const paneKey: Record<string, UiMode> = {
        s: "SEQ", i: "MIX", t: "TRIG", l: "LFO", c: "CHAT",
      };
      if (paneKey[key.toLowerCase()] && !mod && !e.ctrlKey && !e.metaKey) {
        dispatchRef.current({ type: "MODE", value: paneKey[key.toLowerCase()]! });
        e.preventDefault();
        return;
      }
      if (key === "[") {
        dispatchRef.current({ type: "TRACK_DELTA", delta: -1 });
        e.preventDefault();
        return;
      }
      if (key === "]") {
        dispatchRef.current({ type: "TRACK_DELTA", delta: 1 });
        e.preventDefault();
        return;
      }

      if (st.ui.mode === "SEQ") {
        if (key === "ArrowLeft") {
          e.preventDefault();
          dispatchRef.current({ type: "MOVE", axis: "step", delta: -1 });
          return;
        }
        if (key === "ArrowRight") {
          e.preventDefault();
          dispatchRef.current({ type: "MOVE", axis: "step", delta: 1 });
          return;
        }
        if (key === "ArrowUp") {
          e.preventDefault();
          dispatchRef.current({ type: "MOVE", axis: "track", delta: -1 });
          return;
        }
        if (key === "ArrowDown") {
          e.preventDefault();
          dispatchRef.current({ type: "MOVE", axis: "track", delta: 1 });
          return;
        }
        if (key === "Delete" || key === "Backspace") {
          handlersRef.current.clearStep();
          e.preventDefault();
          return;
        }
      } else if (st.ui.mode === "MIX") {
        if (key === "ArrowLeft") {
          e.preventDefault();
          handlersRef.current.nudgeMix(-1, mod);
          return;
        }
        if (key === "ArrowRight") {
          e.preventDefault();
          handlersRef.current.nudgeMix(1, mod);
          return;
        }
        if (key === "ArrowUp") {
          dispatchRef.current({ type: "MOVE", axis: "mixParam", delta: -1 });
          e.preventDefault();
          return;
        }
        if (key === "ArrowDown") {
          dispatchRef.current({ type: "MOVE", axis: "mixParam", delta: 1 });
          e.preventDefault();
          return;
        }
        if (key === "," || key === ".") {
          handlersRef.current.nudgeMix(key === "." ? 1 : -1, false);
          e.preventDefault();
          return;
        }
      } else if (st.ui.mode === "TRIG") {
        if (key === "ArrowLeft" || key === "ArrowRight") {
          handlersRef.current.nudgeTrig(key === "ArrowRight" ? 1 : -1, mod);
          e.preventDefault();
          return;
        }
        if (key === "ArrowUp") {
          dispatchRef.current({ type: "MOVE", axis: "trigField", delta: -1 });
          e.preventDefault();
          return;
        }
        if (key === "ArrowDown") {
          dispatchRef.current({ type: "MOVE", axis: "trigField", delta: 1 });
          e.preventDefault();
          return;
        }
        if (key === "Delete" || key === "Backspace") {
          handlersRef.current.clearStep();
          e.preventDefault();
          return;
        }
      } else if (st.ui.mode === "LFO") {
        if (key === "ArrowLeft" || key === "ArrowRight") {
          dispatchRef.current({ type: "MOVE", axis: "lfoField", delta: key === "ArrowRight" ? 1 : -1 });
          e.preventDefault();
          return;
        }
        if (key === "ArrowUp") {
          handlersRef.current.nudgeLfo(1, mod);
          e.preventDefault();
          return;
        }
        if (key === "ArrowDown") {
          handlersRef.current.nudgeLfo(-1, mod);
          e.preventDefault();
          return;
        }
        if (key === "(") {
          dispatchRef.current({ type: "LFO_SWITCH", delta: -1 });
          e.preventDefault();
          return;
        }
        if (key === ")") {
          dispatchRef.current({ type: "LFO_SWITCH", delta: 1 });
          e.preventDefault();
          return;
        }
        if (key === "+" || key === "=") {
          handlersRef.current.lfoAdd();
          e.preventDefault();
          return;
        }
        if (key === "-" || key === "_") {
          handlersRef.current.lfoDel();
          e.preventDefault();
          return;
        }
      }
    }
    document.addEventListener("keydown", onGlobalCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onGlobalCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
