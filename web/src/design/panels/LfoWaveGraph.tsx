import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkbenchView } from "../../lib/viewModel.js";
import type { LfoSlotView } from "../../lib/lfoAdapter.js";
import { LFO_DESTS, LFO_SHAPES } from "../constants.js";
import {
  lfoDestArrow,
  lfoPlayheadIndex,
  lfoShapeNameFromIndex,
  lfoTimingLabel,
  sampleLfoWavePoints,
} from "../../lib/lfoDisplay.js";

const MODES = ["FREE", "TRIG", "HOLD", "ONE"] as const;
const MIN_W = 280;
const MIN_H = 140;

function pointsToPath(pts: { x: number; y: number }[], h: number): string {
  if (pts.length === 0) return "";
  const first = pts[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    d += ` L ${p.x} ${p.y}`;
  }
  d += ` L ${pts[pts.length - 1]!.x} ${h} L 0 ${h} Z`;
  return d;
}

export function LfoWaveGraph({
  lfo,
  lfoIdx,
  view,
  activeCount,
}: {
  lfo: LfoSlotView;
  lfoIdx: number;
  view: WorkbenchView;
  activeCount: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: MIN_W, h: MIN_H });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({
        w: Math.max(MIN_W, Math.floor(cr.width)),
        h: Math.max(MIN_H, Math.floor(cr.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shapeLabel = (LFO_SHAPES[lfo.shape] ?? "off").toUpperCase();
  const destLabel = (LFO_DESTS[lfo.dest] ?? "filter").toUpperCase();
  const modeLabel = MODES[lfo.mode] ?? "FREE";
  const graphShape = lfoShapeNameFromIndex(lfo.shape);

  const points = useMemo(() => {
    if (!graphShape) return [];
    return sampleLfoWavePoints({
      shape: graphShape,
      patternLength: view.stepLen,
      num: lfo.num,
      den: lfo.den,
      phase: lfo.phase,
      width: size.w,
      height: size.h,
      globalStep: view.globalStep,
    });
  }, [graphShape, view.stepLen, view.globalStep, lfo.num, lfo.den, lfo.phase, size.w, size.h]);

  const playCol =
    view.playing && graphShape
      ? lfoPlayheadIndex(view.playhead, view.stepLen, size.w)
      : null;

  const linePath = useMemo(() => {
    if (points.length === 0) return "";
    const first = points[0]!;
    let d = `M ${first.x} ${first.y}`;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      d += ` L ${p.x} ${p.y}`;
    }
    return d;
  }, [points]);

  const fillPath = useMemo(() => pointsToPath(points, size.h), [points, size.h]);
  const gradId = `lfo-grad-${lfoIdx}`;

  return (
    <div className="lfo-graph" ref={containerRef}>
      <svg
        className="lfo-graph-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--yellow)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--yellow)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={`h-${f}`}
            x1={0}
            y1={size.h * f}
            x2={size.w}
            y2={size.h * f}
            stroke="var(--border-dim)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        ))}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={`v-${f}`}
            x1={size.w * f}
            y1={0}
            x2={size.w * f}
            y2={size.h}
            stroke="var(--border-dim)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        ))}
        {fillPath ? <path d={fillPath} fill={`url(#${gradId})`} stroke="none" /> : null}
        {linePath ? (
          <path d={linePath} fill="none" stroke="var(--yellow)" strokeWidth={1.5} />
        ) : (
          <line
            x1={0}
            y1={size.h / 2}
            x2={size.w}
            y2={size.h / 2}
            stroke="var(--border-dim)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}
        {playCol != null ? (
          <line
            x1={playCol}
            y1={0}
            x2={playCol}
            y2={size.h}
            stroke="var(--yellow-bright)"
            strokeWidth={1.5}
            strokeOpacity={0.9}
          />
        ) : null}
      </svg>
      <div className="lfo-graph-overlay lfo-graph-overlay-top">
        {graphShape
          ? `${shapeLabel} · ${modeLabel} · DEPTH ${lfo.depth} · SPD ${lfo.speed} · ${lfoDestArrow(lfo.dest)}`
          : "OFF · no waveform"}
      </div>
      <div className="lfo-graph-overlay lfo-graph-overlay-bottom">
        {lfoTimingLabel(view.stepLen, lfo.num, lfo.den)}
      </div>
      <div className="lfo-graph-footer">
        <span className="d">
          LFO {lfoIdx + 1}/{activeCount} · {activeCount}/10 slots
        </span>
        <span className="y">
          {graphShape ? `${shapeLabel} ${lfoDestArrow(lfo.dest)}` : "—"}
        </span>
      </div>
    </div>
  );
}
