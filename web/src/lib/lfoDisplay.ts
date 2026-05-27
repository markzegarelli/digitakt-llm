/** LFO shape sampling for web waveform display (align with core/lfo.py / TUI). */
import { LFO_DESTS, LFO_SHAPES } from "../design/constants.js";

const PI = Math.PI;

export function normP(p: number): number {
  let x = p % 1;
  if (x < 0) x += 1;
  return x;
}

export function lfoShape(shape: string, p: number): number {
  p = normP(p);
  switch (shape) {
    case "sine":
      return Math.sin(2 * PI * p);
    case "triangle":
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case "square":
      return p < 0.5 ? 1 : -1;
    case "ramp":
      return 2 * p - 1;
    case "saw":
      return 1 - 2 * p;
    default:
      return 0;
  }
}

export function cycleSteps(patternLength: number, num: number, den: number): number {
  return Math.max(1, Math.floor((patternLength * num) / den));
}

const STRIP = "▁▂▃▄▅▆▇█";

export function lfoStrip(shape: string, phase: number, width: number): string {
  let s = "";
  for (let i = 0; i < width; i++) {
    const p = i / width;
    const w = lfoShape(shape, p + phase);
    const u = (w + 1) / 2;
    const idx = Math.min(STRIP.length - 1, Math.max(0, Math.round(u * (STRIP.length - 1))));
    s += STRIP[idx]!;
  }
  return s;
}

export function lfoPlayheadIndex(currentStep: number, patternLength: number, width: number): number {
  const pl = Math.max(1, patternLength);
  const s = currentStep % pl;
  const ph = s / pl;
  return Math.min(width - 1, Math.max(0, Math.floor(ph * width)));
}

/** Fixed playhead x (px) near the left edge; waveform scrolls underneath. */
export function lfoFixedPlayheadX(width: number): number {
  const w = Math.max(2, Math.round(width));
  return Math.max(6, Math.round(w * 0.06));
}

/** Braille column index matching {@link lfoFixedPlayheadX} for a given char width. */
export function lfoFixedPlayheadCol(cols: number): number {
  const c = Math.max(1, cols);
  return Math.max(1, Math.round(c * 0.06));
}

/** Map web LFO shape index to core shape name for graph sampling. */
export function lfoShapeNameFromIndex(shapeIdx: number): string | null {
  const map: Record<number, string> = {
    1: "triangle",
    2: "sine",
    3: "saw",
    4: "square",
    6: "ramp",
  };
  return map[shapeIdx] ?? null;
}

const SHAPE_ABBR: Record<number, string> = {
  1: "TRI",
  2: "SIN",
  3: "SAW",
  4: "SQR",
  5: "EXP",
  6: "RMP",
  7: "RND",
};

const DEST_ABBR: Record<string, string> = {
  filter: "FIL",
  reso: "RES",
  decay: "DEC",
  volume: "VOL",
  pitch: "PIT",
  reverb: "REV",
  delay: "DLY",
  pan: "PAN",
};

export function lfoRoutePill(shapeIdx: number, destIdx: number): string | null {
  if (shapeIdx === 0) return null;
  const shape = SHAPE_ABBR[shapeIdx] ?? LFO_SHAPES[shapeIdx]?.slice(0, 3).toUpperCase() ?? "?";
  const dest = LFO_DESTS[destIdx] ?? "filter";
  const destAbbr = DEST_ABBR[dest] ?? dest.slice(0, 3).toUpperCase();
  return `${shape}-${destAbbr}`;
}

export function lfoDestArrow(destIdx: number): string {
  const dest = LFO_DESTS[destIdx] ?? "filter";
  return `-> ${dest.toUpperCase()}`;
}

/** Static base value for depth-scaled waveform display (zero axis = min, base = max at depth 100%). */
export function lfoBaseValueForDest(
  mix: Record<string, number>,
  trigs: { note: number }[],
  destIdx: number,
): { base: number; max: number } {
  const dest = LFO_DESTS[destIdx] ?? "filter";
  if (dest === "pitch") return { base: trigs[0]?.note ?? 60, max: 127 };
  if (dest === "pan") return { base: mix.volume ?? 64, max: 127 };
  if (dest in mix) return { base: mix[dest] ?? 64, max: 127 };
  return { base: 64, max: 127 };
}

export function lfoTimingLabel(stepLen: number, num: number, den: number): string {
  const pl = Math.max(1, stepLen);
  const csn = cycleSteps(pl, num, den);
  const bars = Math.max(1, Math.round(csn / pl));
  const cyc = csn / pl;
  const barLabel = bars === 1 ? "1 bar" : `${bars} bar`;
  return `${barLabel} · ${cyc.toFixed(2)} cyc`;
}

/** Vertical inset so stroke/fill stays inside the plot (px, min fraction of height). */
export function lfoPlotInsets(height: number): { padY: number; baseline: number } {
  const h = Math.max(2, Math.round(height));
  const padY = Math.max(6, Math.round(h * 0.1));
  return { padY, baseline: h - padY - 0.5 };
}

/** Bipolar LFO weight at fractional global step (mirror core/lfo.py `lfo_w_at_step`). */
export function lfoWAtGlobalStep(
  shape: string,
  patternLength: number,
  num: number,
  den: number,
  phase: number,
  globalStep: number,
): number {
  const csn = cycleSteps(patternLength, num, den);
  return lfoShape(shape, (globalStep % csn) / csn + phase);
}

/** Match Python 3 `round()` (half-to-even) for engine-aligned depth clamp. */
function pyRound(x: number): number {
  const fl = Math.floor(x);
  const frac = x - fl;
  if (Math.abs(frac - 0.5) < 1e-12) {
    return fl % 2 === 0 ? fl : fl + 1;
  }
  return Math.round(x);
}

/** Modulate base by bipolar w with depth clamped 0–100 (mirror `apply_depth_clamp`). */
export function applyLfoDepth(
  base: number,
  w: number,
  depthPct: number,
  lo: number,
  hi: number,
): number {
  const depth = Math.max(0, Math.min(100, depthPct));
  const half = (hi - lo) / 2;
  const v = pyRound(base + w * (depth / 100) * half);
  return Math.max(lo, Math.min(hi, v));
}

/** Map bipolar w to SVG plot Y on the depth-scaled waveform (matches {@link sampleLfoWavePoints}). */
export function lfoPlotYFromScaledWave(
  w: number,
  height: number,
  baseValue: number,
  maxValue: number,
  depth: number,
): number {
  const h = Math.max(2, Math.round(height));
  const { padY, baseline } = lfoPlotInsets(h);
  const plotH = h - padY * 2;
  const peakNorm = (Math.max(0, baseValue) / Math.max(1, maxValue)) * (depth / 100);
  const u = (w + 1) / 2;
  return Math.max(padY, Math.min(h - padY - 1, baseline - u * peakNorm * plotH));
}

export function lfoDestBase(
  track: { mix: Record<string, number>; trigs: { note: number }[] },
  dest: string,
  playhead: number,
): number {
  if (dest === "pitch") {
    const trig = track.trigs[playhead];
    return trig?.note ?? 60;
  }
  return track.mix[dest] ?? 64;
}

/** Engine-aligned modulated destination value at a fractional global step. */
export function lfoOutputAtGlobalStep(opts: {
  shape: string;
  patternLength: number;
  num: number;
  den: number;
  phase: number;
  depth: number;
  globalStep: number;
  dest: string;
  track: { mix: Record<string, number>; trigs: { note: number }[] };
  playhead: number;
}): { w: number; value: number } {
  const w = lfoWAtGlobalStep(
    opts.shape,
    opts.patternLength,
    opts.num,
    opts.den,
    opts.phase,
    opts.globalStep,
  );
  const base = lfoDestBase(opts.track, opts.dest, opts.playhead);
  const value = applyLfoDepth(base, w, opts.depth, 0, 127);
  return { w, value };
}

/**
 * Sample LFO waveform points using the same engine-aligned logic as TUI `lfoBrailleLines`.
 */
export function sampleLfoWavePoints(opts: {
  shape: string;
  patternLength: number;
  num: number;
  den: number;
  phase: number;
  depth: number;
  baseValue: number;
  maxValue?: number;
  width: number;
  height: number;
  globalStep?: number | null;
}): { x: number; y: number }[] {
  const {
    shape,
    patternLength,
    num,
    den,
    phase,
    depth,
    baseValue,
    maxValue = 127,
    width,
    height,
    globalStep,
  } = opts;
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const pl = Math.max(1, patternLength);
  const anchorG = globalStep != null && globalStep >= 0 ? globalStep : 0;
  const playheadX = lfoFixedPlayheadX(w);
  const stepPerPx = pl / Math.max(1, w - 1);
  const { padY, baseline } = lfoPlotInsets(h);
  const plotH = h - padY * 2;
  const peakNorm = (Math.max(0, baseValue) / Math.max(1, maxValue)) * (depth / 100);
  const wAtG = (g: number) => lfoWAtGlobalStep(shape, pl, num, den, phase, g);

  const points: { x: number; y: number }[] = [];
  for (let px = 0; px < w; px++) {
    const g = anchorG + (px - playheadX) * stepPerPx;
    const val = wAtG(g);
    const u = (val + 1) / 2;
    const y = Math.max(padY, Math.min(h - padY - 1, baseline - u * peakNorm * plotH));
    points.push({ x: px, y });
  }
  return points;
}
