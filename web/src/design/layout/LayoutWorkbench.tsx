import React from "react";
import type { WorkbenchView } from "../../lib/viewModel.js";
import type { UiDispatch } from "../../hooks/useUiState.js";
import type { StepStyle } from "../constants.js";
import { Sequencer } from "../panels/Sequencer.js";
import { ChatColumn } from "../panels/ChatCmd.js";
import { TrigPanel, MixGrid, LFOPanel, LfoSummary } from "../panels/SidePanels.js";

export function LayoutWorkbench({
  view,
  dispatch,
  stepStyle,
  onChatSend,
  onSelectLfoSlot,
  onSelectTrack,
  onLfoAdd,
  onLfoDel,
  focusAppRoot,
}: {
  view: WorkbenchView;
  dispatch: UiDispatch;
  stepStyle: StepStyle;
  onChatSend: (text: string) => void;
  onSelectLfoSlot: (idx: number) => void;
  onSelectTrack: (delta: number) => void;
  onLfoAdd: () => void;
  onLfoDel: () => void;
  focusAppRoot?: () => void;
}) {
  const focusKey =
    view.ui.mode === "MIX" || view.ui.mode === "TRIG" || view.ui.mode === "LFO"
      ? view.ui.mode
      : "TRIG";
  const tabs = [
    { id: "TRIG" as const, label: "trig", shortcut: "T" },
    { id: "MIX" as const, label: "mix", shortcut: "M" },
    { id: "LFO" as const, label: "lfo", shortcut: "L" },
  ];

  return (
    <div className="workbench-grid">
      <div className={`panel ${view.ui.mode === "SEQ" ? "focused" : ""}`} style={{ gridRow: "1 / 2" }}>
        <Sequencer view={view} focused={view.ui.mode === "SEQ"} stepStyle={stepStyle} />
      </div>
      <div className={`panel ${view.ui.mode === "CHAT" ? "focused" : ""}`} style={{ gridRow: "1 / 3" }}>
        <ChatColumn
          view={view}
          focused={view.ui.mode === "CHAT"}
          dispatch={dispatch}
          onSend={onChatSend}
          focusAppRoot={focusAppRoot}
        />
      </div>
      <div
        className={`panel ${["TRIG", "MIX", "LFO"].includes(view.ui.mode) ? "focused" : ""}`}
        style={{ gridRow: "2 / 3" }}
      >
        <div className="tab-bar">
          {tabs.map((t) => {
            const isCur = focusKey === t.id;
            const isFocused = view.ui.mode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                tabIndex={-1}
                className={isCur ? "tab sel" : "tab"}
                style={{ color: isFocused ? "var(--yellow-bright)" : undefined }}
                onClick={() => dispatch({ type: "MODE", value: t.id })}
              >
                <span className="kbd">{t.shortcut}</span> {t.label}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span className="d" style={{ padding: "8px 14px", fontSize: 11 }}>
            track <span className="y b">{view.tracks[view.ui.cursor.track]?.id}</span>
          </span>
        </div>
        <div className="tab-body">
          {focusKey === "TRIG" ? <TrigPanel view={view} focused={view.ui.mode === "TRIG"} /> : null}
          {focusKey === "MIX" ? <MixGrid view={view} focused={view.ui.mode === "MIX"} /> : null}
          {focusKey === "LFO" ? (
            <div className="lfo-split">
              <LFOPanel
                view={view}
                focused={view.ui.mode === "LFO"}
                onSelectSlot={onSelectLfoSlot}
                onLfoAdd={onLfoAdd}
                onLfoDel={onLfoDel}
              />
              <LfoSummary view={view} onSelectTrack={onSelectTrack} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
