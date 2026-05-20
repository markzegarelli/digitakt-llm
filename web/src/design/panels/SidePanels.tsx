import React from "react";
import type { WorkbenchView } from "../../lib/viewModel.js";
import { PARAM_NAMES, noteName } from "../constants.js";
import { condLabel } from "../../lib/condAdapter.js";
import { Bar, Knob } from "../primitives/index.js";
import { LFO_SHAPES, LFO_DESTS } from "../constants.js";
import { cycleSteps, lfoPlayheadIndex, lfoShapeNameFromIndex, lfoStrip } from "../../lib/lfoDisplay.js";

export function TrigPanel({ view, focused }: { view: WorkbenchView; focused: boolean }) {
  const t = view.tracks[view.ui.cursor.track]!;
  const trig = t.trigs[view.ui.cursor.step]!;
  const cur = view.ui.cursor.trigField;
  const fields = [
    { k: "prob", label: "probability %", val: trig.prob, max: 100 },
    { k: "vel", label: "velocity", val: trig.velocity, max: 127 },
    { k: "note", label: "note (midi)", val: trig.note, max: 127, fmt: noteName },
    { k: "gate", label: "length (gate%)", val: trig.gate, max: 100 },
    { k: "cond", label: "condition", val: condLabel(trig.condition), raw: trig.condition },
    { k: "micro", label: "micro shift", val: trig.microShift, max: 23 },
  ];
  return (
    <div className="side-panel">
      <div className="panel-subhead">
        <div>
          <span className={focused ? "y b" : "d b"}>TRIG</span>{" "}
          <span className={trig.on ? "y" : "d"}>{t.id}</span>{" "}
          <span className="d">s{view.ui.cursor.step + 1}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {fields.map((f, i) => {
          const sel = focused && i === cur;
          return (
            <div key={f.k} className={sel ? "field-row sel" : "field-row"}>
              <span className={sel ? "y b" : "f"}>{sel ? ">" : " "}</span>
              <span className={sel ? "y" : ""} style={{ fontSize: 12 }}>{f.label}</span>
              <span>{typeof f.max === "number" ? <Bar value={typeof f.val === "number" ? f.val : 0} max={f.max} active={sel} /> : "—"}</span>
              <span style={{ textAlign: "right", fontWeight: 600, color: sel ? "var(--yellow-bright)" : "var(--text)" }}>
                {f.fmt && typeof f.val === "number" ? f.fmt(f.val) : String(f.val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MixGrid({ view, focused }: { view: WorkbenchView; focused: boolean }) {
  const params = PARAM_NAMES;
  return (
    <div className="side-panel">
      <div className="panel-subhead">
        <span className={focused ? "y b" : "d b"}>MIX</span>
        <span className="d" style={{ fontSize: 11 }}>
          track {view.tracks[view.ui.cursor.track]?.id} · {params[view.ui.cursor.mixParam]}
        </span>
      </div>
      <div className="mix-grid">
        <div />
        {view.tracks.map((t, ti) => (
          <div key={t.id} className={focused && view.ui.cursor.track === ti ? "mix-col-head sel" : "mix-col-head"}>
            {t.id}
          </div>
        ))}
        {params.map((pname, pi) => (
          <React.Fragment key={pname}>
            <div className={focused && view.ui.cursor.mixParam === pi ? "mix-row-head sel" : "mix-row-head"}>{pname}</div>
            {view.tracks.map((t, ti) => {
              const active = focused && view.ui.cursor.track === ti && view.ui.cursor.mixParam === pi;
              return (
                <div key={t.id + pname} style={{ display: "flex", justifyContent: "center" }}>
                  <Knob value={t.mix[pname] ?? 0} size={34} active={active} dim={t.muted} />
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function LFOPanel({
  view,
  focused,
  onSelectSlot,
}: {
  view: WorkbenchView;
  focused: boolean;
  onSelectSlot: (idx: number) => void;
}) {
  const t = view.tracks[view.ui.cursor.track]!;
  const lfoIdx = Math.min(view.ui.cursor.lfoIdx, t.lfos.length - 1);
  const lfo = t.lfos[lfoIdx]!;
  const shape = LFO_SHAPES[lfo.shape] ?? "off";
  const dest = LFO_DESTS[lfo.dest] ?? "filter";
  const graphShape = lfoShapeNameFromIndex(lfo.shape);
  const graphW = 48;
  const playCol =
    view.playing && graphShape
      ? lfoPlayheadIndex(view.playhead, view.stepLen, graphW)
      : null;
  const waveLine =
    graphShape != null
      ? lfoStrip(graphShape, lfo.phase, graphW)
      : "—".repeat(graphW);
  const waveDisplay =
    playCol != null
      ? `${waveLine.slice(0, playCol)}│${waveLine.slice(playCol + 1)}`
      : waveLine;
  const fields = [
    { k: "shape", val: shape.toUpperCase() },
    { k: "dest", val: dest },
    { k: "depth", val: lfo.depth, max: 127, bar: true },
    { k: "speed", val: lfo.speed, max: 127, bar: true },
    { k: "mult", val: `${lfo.num}/${lfo.den}` },
    { k: "mode", val: ["FREE", "TRIG", "HOLD", "ONE"][lfo.mode] },
  ];
  const cur = view.ui.cursor.lfoField;
  return (
    <div className="side-panel">
      <div className="panel-subhead">
        <span className={focused ? "y b" : "d b"}>LFO</span>
        <span className="d">track {t.id}</span>
      </div>
      <div className="lfo-slots">
        {t.lfos.map((l, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className={i === lfoIdx ? "lfo-slot sel" : "lfo-slot"}
            onClick={() => onSelectSlot(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="lfo-wave" title={`${lfo.num}/${lfo.den} · ${cycleSteps(view.stepLen, lfo.num, lfo.den)} st/cyc`}>
        <span className="d" style={{ fontSize: 10, letterSpacing: "0.06em" }}>
          {graphShape ? `${shape} · ${lfo.num}/${lfo.den}` : "off"}
        </span>
        <pre className="lfo-wave-line">{waveDisplay}</pre>
      </div>
      <div className="lfo-fields">
        {fields.map((f, i) => {
          const sel = focused && cur === i;
          return (
            <div key={f.k} className={sel ? "lfo-field sel" : "lfo-field"}>
              <span className="d">{f.k}</span>
              {f.bar ? (
                <>
                  <Bar value={f.val as number} max={f.max} active={sel} />
                  <span className="y">{f.val}</span>
                </>
              ) : (
                <span className="y">{f.val}</span>
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
      {view.tracks.map((track, i) => {
        const activeLfos = track.lfos.filter((l) => l.shape !== 0);
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
            <span className="d">{activeLfos.length}/{track.lfos.length} active</span>
          </div>
        );
      })}
    </div>
  );
}
