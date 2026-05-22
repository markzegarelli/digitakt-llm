import type { DigitaktState, LfoDef, LfoShape, TrackName } from "../backend/types.js";
import { TRACK_NAMES } from "../backend/types.js";
import { LFO_DESTS, LFO_SHAPES, PARAM_NAMES, type ParamName } from "../design/constants.js";

export const MAX_LFO_SLOTS = 10;

export interface LfoSlotView {
  target: string;
  shape: number;
  dest: number;
  depth: number;
  speed: number;
  num: number;
  den: number;
  phase: number;
  mode: number;
}

const SHAPE_TO_ZIP: Record<LfoShape, number> = {
  sine: 2,
  triangle: 1,
  saw: 3,
  square: 4,
  ramp: 6,
};

const ZIP_TO_SHAPE: Record<number, LfoShape | null> = {
  0: null,
  1: "triangle",
  2: "sine",
  3: "saw",
  4: "square",
  5: "ramp",
  6: "ramp",
  7: null,
};

const CC_ALIAS: Record<string, ParamName> = {
  filter: "filter",
  reso: "reso",
  resonance: "reso",
  attack: "attack",
  hold: "hold",
  decay: "decay",
  volume: "volume",
  reverb: "reverb",
  delay: "delay",
};

function destIndexFromTarget(target: string, track: TrackName): number {
  const parts = target.split(":");
  if (parts[0] === "cc" && parts[1] === track) {
    const param = CC_ALIAS[parts[2] ?? ""] ?? "filter";
    const idx = (LFO_DESTS as readonly string[]).indexOf(param);
    return idx >= 0 ? idx : 0;
  }
  if (parts[0] === "pitch" && parts[1] === track) return LFO_DESTS.indexOf("pitch");
  if (parts[0] === "trig" && parts[1] === track) {
    const field = parts[2];
    if (field === "vel") return LFO_DESTS.indexOf("volume");
    if (field === "prob") return LFO_DESTS.indexOf("decay");
    if (field === "gate") return LFO_DESTS.indexOf("hold");
    if (field === "note") return LFO_DESTS.indexOf("pitch");
  }
  return 0;
}

function targetFromSlot(track: TrackName, destIdx: number): string {
  const dest = LFO_DESTS[destIdx] ?? "filter";
  if (dest === "pitch") return `pitch:${track}:main`;
  if (dest === "pan") return `cc:${track}:volume`;
  const param = PARAM_NAMES.includes(dest as ParamName) ? dest : "filter";
  return `cc:${track}:${param}`;
}

function rateToSpeed(num: number, den: number): number {
  const cycles = den > 0 ? num / den : 1;
  return Math.round(clamp(cycles * 32, 0, 127));
}

function speedToRate(speed: number): { num: number; den: number } {
  const cycles = Math.max(0.0625, speed / 32);
  if (cycles <= 1) return { num: Math.max(1, Math.round(cycles * 4)), den: 4 };
  return { num: Math.round(cycles), den: 1 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lfoDefToSlot(target: string, track: TrackName, def: LfoDef): LfoSlotView {
  return {
    target,
    shape: SHAPE_TO_ZIP[def.shape] ?? 2,
    dest: destIndexFromTarget(target, track),
    depth: def.depth,
    speed: rateToSpeed(def.rate.num, def.rate.den),
    num: def.rate.num,
    den: def.rate.den,
    phase: def.phase,
    mode: 0,
  };
}

export function slotToLfoDef(slot: LfoSlotView): LfoDef | null {
  const shape = ZIP_TO_SHAPE[slot.shape];
  if (!shape) return null;
  return {
    shape,
    depth: slot.depth,
    phase: slot.phase,
    rate: { num: slot.num, den: slot.den },
  };
}

export function lfosForTrack(state: DigitaktState, track: TrackName): LfoSlotView[] {
  const prefix = [`cc:${track}:`, `trig:${track}:`, `pitch:${track}:`];
  const slots: LfoSlotView[] = [];
  for (const [target, def] of Object.entries(state.lfo)) {
    if (!prefix.some((p) => target.startsWith(p))) continue;
    slots.push(lfoDefToSlot(target, track, def));
  }
  if (slots.length === 0) {
    slots.push({
      target: targetFromSlot(track, 0),
      shape: 0,
      dest: 0,
      depth: 0,
      speed: 32,
      num: 1,
      den: 1,
      phase: 0,
      mode: 0,
    });
  }
  return slots;
}

export function updateSlotTarget(track: TrackName, slot: LfoSlotView, destIdx: number): string {
  return targetFromSlot(track, destIdx);
}

export function applySlotField(
  slot: LfoSlotView,
  track: TrackName,
  field: "shape" | "dest" | "depth" | "speed" | "mult" | "mode",
  delta: number,
): { slot: LfoSlotView; target: string } {
  const next = { ...slot };
  if (field === "shape") {
    next.shape = (next.shape + delta + LFO_SHAPES.length) % LFO_SHAPES.length;
  } else if (field === "dest") {
    next.dest = (next.dest + delta + LFO_DESTS.length) % LFO_DESTS.length;
    next.target = targetFromSlot(track, next.dest);
  } else if (field === "depth") {
    next.depth = clamp(next.depth + delta, 0, 127);
  } else if (field === "speed") {
    next.speed = clamp(next.speed + delta, 0, 127);
    const rate = speedToRate(next.speed);
    next.num = rate.num;
    next.den = rate.den;
  } else if (field === "mult") {
    next.num = clamp(next.num + delta, 1, 16);
  } else if (field === "mode") {
    next.mode = (next.mode + delta + 4) % 4;
  }
  return { slot: next, target: next.target };
}

/** True when a field edit changes the LFO route key (e.g. dest change). */
export function slotTargetChanged(
  before: LfoSlotView,
  after: LfoSlotView,
  field: "shape" | "dest" | "depth" | "speed" | "mult" | "mode",
): boolean {
  return field === "dest" && after.target !== before.target;
}

export function newDefaultSlot(track: TrackName): LfoSlotView {
  return {
    target: targetFromSlot(track, 0),
    shape: 1,
    dest: 0,
    depth: 30,
    speed: 32,
    num: 1,
    den: 1,
    phase: 0,
    mode: 0,
  };
}

export function allTrackLfoSummary(state: DigitaktState): Record<TrackName, LfoSlotView[]> {
  return Object.fromEntries(TRACK_NAMES.map((t) => [t, lfosForTrack(state, t)])) as Record<
    TrackName,
    LfoSlotView[]
  >;
}
