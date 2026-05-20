import type { UiMode } from "../design/constants.js";

const PANE_ORDER = ["SEQ", "WB", "CHAT"] as const;
const WB_MODES: UiMode[] = ["TRIG", "MIX", "LFO"];

/** 3-stop pane cycle: SEQ → workbench (TRIG/MIX/LFO) → CHAT → SEQ */
export function nextTabMode(
  mode: UiMode,
  lastWorkbench: UiMode,
  shift: boolean,
): UiMode {
  const curStop = WB_MODES.includes(mode) ? "WB" : mode === "CHAT" || mode === "SEQ" ? mode : "SEQ";
  const i = PANE_ORDER.indexOf(curStop as (typeof PANE_ORDER)[number]);
  const idx = i >= 0 ? i : 0;
  const nextStop = PANE_ORDER[(idx + (shift ? -1 : 1) + PANE_ORDER.length) % PANE_ORDER.length]!;
  return nextStop === "WB" ? lastWorkbench : (nextStop as UiMode);
}
