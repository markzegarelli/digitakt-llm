import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { createClient } from "./backend/client.js";
import { useDigitakt } from "./hooks/useDigitakt.js";
import { useUiState } from "./hooks/useUiState.js";
import { useKeyboard } from "./hooks/useKeyboard.js";
import { buildWorkbenchView, nowTag } from "./lib/viewModel.js";
import { Header, HelpStrip, HelpOverlay } from "./design/panels/Chrome.js";
import { LayoutWorkbench } from "./design/layout/LayoutWorkbench.js";
import { CommandBar } from "./design/panels/ChatCmd.js";
import { PARAM_NAMES } from "./design/constants.js";
import { clamp } from "./design/constants.js";
import { indexToCond } from "./lib/condAdapter.js";
import {
  applySlotField,
  lfosForTrack,
  newDefaultSlot,
  slotTargetChanged,
  slotToLfoDef,
} from "./lib/lfoAdapter.js";
import { dispatchCommand, type CommandContext } from "./lib/commandDispatch.js";
import { formatGenerationReply } from "./lib/chatDisplay.js";
import { normalizeCcParamAlias } from "./lib/slashParsing.js";
import type { TrackName } from "./backend/types.js";

const BASE_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.["VITE_API_URL"] ?? "";

const client = createClient(BASE_URL || undefined);

export function App() {
  const { ui, dispatch } = useUiState();
  const onMuteChanged = useCallback(
    (track: TrackName) => dispatch({ type: "MUTE_ARMED_REMOVE", track }),
    [dispatch],
  );
  const { state, actions } = useDigitakt(client, { onMuteChanged });
  const startMs = useRef(Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const view = useMemo(() => buildWorkbenchView(state, ui), [state, ui]);

  const focusAppRoot = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (ui.mode !== "CHAT" && ui.mode !== "CMD") {
      focusAppRoot();
    }
  }, [ui.mode, focusAppRoot]);

  useEffect(() => {
    if (state.generation_status === "generating") {
      dispatch({
        type: "CHAT_APPEND",
        msg: { who: "llm", t: nowTag(startMs.current), text: "generating…", pending: true },
      });
    }
  }, [state.generation_status, dispatch]);

  useEffect(() => {
    if (state.generation_summary) {
      dispatch({
        type: "CHAT_RESOLVE_PENDING",
        text: formatGenerationReply(state.generation_summary),
      });
    } else if (state.generation_status === "failed" && state.generation_error) {
      dispatch({ type: "CHAT_RESOLVE_PENDING", text: `Error: ${state.generation_error}` });
    }
  }, [state.generation_summary, state.generation_status, state.generation_error, dispatch]);

  const track = view.tracks[ui.cursor.track]!;
  const step = ui.cursor.step + 1;

  const cmdCtx: CommandContext = useMemo(
    () => ({
      actions,
      client,
      addLog: (msg) => dispatch({ type: "CHAT_SYS", text: msg, startMs: startMs.current }),
      addAgentReply: (text) =>
        dispatch({
          type: "CHAT_APPEND",
          msg: { who: "llm", t: nowTag(startMs.current), text },
        }),
      onHelp: () => dispatch({ type: "HELP_SET", value: true }),
      onLoadPattern: (name) => dispatch({ type: "SET_PATTERN_META", index: ui.patternIndex, name: name.toUpperCase() }),
    }),
    [actions, dispatch, ui.patternIndex],
  );

  const handlers = useMemo(
    () => ({
      toggleStep: () => {
        const row = state.current_pattern[track.name];
        const vel = Array.isArray(row) ? (row[ui.cursor.step] ?? 0) : 0;
        actions.setVel(track.name, step, vel > 0 ? 0 : 100);
      },
      clearStep: () => actions.setVel(track.name, step, 0),
      playStop: () => (state.is_playing ? actions.stop() : actions.play()),
      muteImmediate: () => {
        const tn = view.tracks[ui.cursor.track]!.name;
        actions.setMute(tn, !state.track_muted[tn]);
      },
      muteStagePending: () => {
        dispatch({ type: "MUTE_PENDING_TOGGLE", trackIdx: ui.cursor.track });
      },
      muteFirePending: () => {
        for (const tn of ui.pendingMuteTracks) {
          actions.muteQueued(tn, !state.track_muted[tn]);
        }
        dispatch({ type: "MUTE_ARM_PENDING" });
      },
      nudgeMix: (delta: number, shift: boolean) => {
        const param = PARAM_NAMES[ui.cursor.mixParam]!;
        const apiParam = param === "reso" ? "resonance" : param;
        const t = view.tracks[ui.cursor.track]!;
        const cur = t.mix[param] ?? 64;
        const step = shift ? delta * 10 : delta;
        const next = clamp(cur + step, 0, 127);
        actions.setCC(t.name, normalizeCcParamAlias(apiParam), next);
      },
      nudgeTrig: (delta: number, shift: boolean) => {
        const d = shift ? delta : delta;
        const tr = track.trigs[ui.cursor.step]!;
        const field = ui.cursor.trigField;
        if (field === 0) actions.setProb(track.name, step, clamp(tr.prob + d, 0, 100));
        else if (field === 1) actions.setVel(track.name, step, clamp(tr.velocity + d, 0, 127));
        else if (field === 2) actions.setNote(track.name, step, clamp(tr.note + d, 0, 127));
        else if (field === 3) actions.setGate(track.name, step, clamp(tr.gate + d, 0, 100));
        else if (field === 4) {
          const next = (tr.condition + (d > 0 ? 1 : -1) + 11) % 11;
          actions.setCond(track.name, step, indexToCond(next));
        }
      },
      nudgeLfo: (delta: number, shift: boolean) => {
        const d = shift ? delta * 10 : delta;
        const fields = ["shape", "dest", "depth", "speed", "mult", "mode"] as const;
        const field = fields[ui.cursor.lfoField] ?? "depth";
        const slots = lfosForTrack(state, track.name);
        const idx = Math.min(ui.cursor.lfoIdx, slots.length - 1);
        const slot = slots[idx]!;
        const { slot: next, target } = applySlotField(slot, track.name, field, d);
        const def = slotToLfoDef(next);
        if (def && slotTargetChanged(slot, next, field)) {
          actions.retargetLfoRoute(slot.target, target, def);
        } else {
          actions.setLfoRoute(def ? target : slot.target, def);
        }
      },
      lfoAdd: () => {
        const slot = newDefaultSlot(track.name);
        const def = slotToLfoDef(slot);
        if (def) actions.setLfoRoute(slot.target, def);
      },
      lfoDel: () => {
        const slots = lfosForTrack(state, track.name);
        const idx = Math.min(ui.cursor.lfoIdx, slots.length - 1);
        if (slots.length <= 1) return;
        actions.setLfoRoute(slots[idx]!.target, null);
      },
    }),
    [actions, dispatch, state, track, step, ui, view.tracks],
  );

  useKeyboard(view, dispatch, handlers, focusAppRoot);

  const onChatSend = useCallback(
    (text: string) => {
      dispatch({
        type: "CHAT_APPEND",
        msg: { who: "user", t: nowTag(startMs.current), text },
      });
      if (text.startsWith("/")) {
        void dispatchCommand(text, cmdCtx);
        return;
      }
      // Plain chat prompts generate patterns (matches TUI beat mode); use /ask for Q&A.
      actions.generate(text);
    },
    [actions, cmdCtx, dispatch],
  );

  return (
    <div className="app-root" tabIndex={-1} ref={rootRef}>
      <Header view={view} />
      <LayoutWorkbench
        view={view}
        dispatch={dispatch}
        stepStyle={ui.stepStyle}
        onChatSend={onChatSend}
        onSelectLfoSlot={(idx) => dispatch({ type: "LFO_SWITCH", set: idx })}
        onSelectTrack={(delta) => dispatch({ type: "TRACK_DELTA", delta })}
        onLfoAdd={handlers.lfoAdd}
        onLfoDel={handlers.lfoDel}
        focusAppRoot={focusAppRoot}
      />
      <HelpStrip view={view} />
      <CommandBar view={view} dispatch={dispatch} cmdCtx={cmdCtx} focusAppRoot={focusAppRoot} />
      {ui.helpOpen ? <HelpOverlay onClose={() => dispatch({ type: "HELP_SET", value: false })} /> : null}
      <div className="too-small">
        <div>
          <div className="y b" style={{ fontSize: 18 }}>DGTK requires more screen real estate</div>
          <div className="d" style={{ marginTop: 10 }}>Open on a laptop (≥ 1280 × 720).</div>
        </div>
      </div>
    </div>
  );
}
