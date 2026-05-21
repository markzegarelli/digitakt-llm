import React from "react";
import type { WorkbenchView } from "../../lib/viewModel.js";
import { LFO_SHAPES, LFO_DESTS } from "../constants.js";
import { MAX_LFO_SLOTS } from "../../lib/lfoAdapter.js";
import { lfoRoutePill } from "../../lib/lfoDisplay.js";
import { Bar } from "../primitives/index.js";
import { LfoWaveGraph } from "./LfoWaveGraph.js";

const LFO_MODES = ["FREE", "TRIG", "HOLD", "ONE"] as const;

export function LFOPanel({
  view,
  focused,
  onSelectSlot,
  onLfoAdd,
  onLfoDel,
}: {
  view: WorkbenchView;
  focused: boolean;
  onSelectSlot: (idx: number) => void;
  onLfoAdd: () => void;
  onLfoDel: () => void;
}) {
  const t = view.tracks[view.ui.cursor.track]!;
  const lfoIdx = Math.min(view.ui.cursor.lfoIdx, t.lfos.length - 1);
  const lfo = t.lfos[lfoIdx]!;
  const activeCount = t.lfos.filter((l) => l.shape !== 0).length;
  const atCap = t.lfos.length >= MAX_LFO_SLOTS;

  const fields = [
    { k: "shape", label: "SHAPE", val: (LFO_SHAPES[lfo.shape] ?? "off").toUpperCase() },
    { k: "dest", label: "DEST", val: (LFO_DESTS[lfo.dest] ?? "filter").toUpperCase() },
    { k: "depth", label: "DEPTH", val: lfo.depth, max: 127, bar: true },
    { k: "speed", label: "SPEED", val: lfo.speed, max: 127, bar: true },
    { k: "mult", label: "MULT", val: `${lfo.num}/${lfo.den}` },
    { k: "mode", label: "MODE", val: LFO_MODES[lfo.mode] ?? "FREE" },
  ];
  const cur = view.ui.cursor.lfoField;

  return (
    <div className="side-panel lfo-editor">
      <div className="panel-subhead">
        <div>
          <span className={focused ? "y b" : "d b"}>LFO</span>{" "}
          <span className="d">track {t.id}</span>
        </div>
        <span className="d" style={{ fontSize: 10 }}>
          ↑↓ field · ↔ value · ( ) prev/next · +/- add/del
        </span>
      </div>
      <div className="lfo-slot-row">
        <button
          type="button"
          tabIndex={-1}
          className="lfo-slot-current sel"
          onClick={() => onSelectSlot(lfoIdx)}
        >
          ● {lfoIdx + 1}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="lfo-slot-action"
          disabled={atCap}
          onClick={onLfoAdd}
        >
          + ADD
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="lfo-slot-action"
          disabled={t.lfos.length <= 1}
          onClick={onLfoDel}
        >
          − DEL
        </button>
        {t.lfos.map((_, i) =>
          i !== lfoIdx ? (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className="lfo-slot"
              onClick={() => onSelectSlot(i)}
            >
              {i + 1}
            </button>
          ) : null,
        )}
      </div>
      <LfoWaveGraph lfo={lfo} lfoIdx={lfoIdx} view={view} activeCount={activeCount} />
      <div className="lfo-param-grid">
        {fields.map((f, i) => {
          const sel = focused && cur === i;
          return (
            <div key={f.k} className={sel ? "lfo-param-cell sel" : "lfo-param-cell"}>
              <span className="lfo-param-label">{f.label}</span>
              {f.bar ? (
                <div className="lfo-param-value">
                  <Bar value={f.val as number} max={f.max} active={sel} />
                  <span className={sel ? "y b" : "y"}>{f.val}</span>
                </div>
              ) : (
                <span className={sel ? "y b" : "y"}>{f.val}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LfoSummary({
  view,
  onSelectTrack,
}: {
  view: WorkbenchView;
  onSelectTrack: (delta: number) => void;
}) {
  return (
    <div className="lfo-summary scroll">
      <div className="lfo-summary-title">PER-TRACK LFO SUMMARY</div>
      {view.tracks.map((track, i) => {
        const activeLfos = track.lfos.filter((l) => l.shape !== 0);
        const firstActive = track.lfos.find((l) => l.shape !== 0);
        const pill = firstActive ? lfoRoutePill(firstActive.shape, firstActive.dest) : null;
        const selIdx = i === view.ui.cursor.track ? Math.min(view.ui.cursor.lfoIdx, track.lfos.length - 1) : 0;
        const depthLfo = track.lfos[selIdx] ?? track.lfos[0];
        const isSel = i === view.ui.cursor.track;
        return (
          <div
            key={track.id}
            className={isSel ? "lfo-summary-row sel" : "lfo-summary-row"}
            onClick={() => onSelectTrack(i - view.ui.cursor.track)}
            role="button"
            tabIndex={-1}
          >
            <span className={isSel ? "y b" : ""}>{track.id}</span>
            <span className={pill ? "lfo-route-pill" : "d"}>{pill ?? "—"}</span>
            <span className="d">
              {activeLfos.length}/{track.lfos.length}
            </span>
            <span className={isSel ? "y" : "d"}>{depthLfo?.depth ?? 0}</span>
          </div>
        );
      })}
      <div className="lfo-summary-footer d">
        click row · jump track · ( ) prev/next LFO · + − add/del · up to 10 LFOs per track
      </div>
    </div>
  );
}
