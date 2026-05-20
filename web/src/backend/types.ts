export const TRACK_NAMES = [
  "kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal",
] as const;

/** Default gate length (% of step) when pattern omits gate or a step value. */
export const DEFAULT_GATE_PCT = 50;

export type TrackName = typeof TRACK_NAMES[number];

/** Euclidean track-strip layout (display only; hits remain on discrete pattern steps). */
export type EuclidStripMode = "grid" | "fractional";

export function parseEuclidStripMode(raw: unknown): EuclidStripMode {
  return raw === "fractional" ? "fractional" : "grid";
}

export type LfoShape = "sine" | "square" | "triangle" | "ramp" | "saw";

export interface LfoDef {
  shape: LfoShape;
  depth: number;
  phase: number;
  rate: { num: number; den: number };
}

export interface CCParamDef {
  name: string;
  cc: number;
  default: number;
}

export type CCParam = string;

/** Per-step trig metadata (mirrors server `current_pattern` prob/gate/cond/note maps). */
export interface PatternTrigState {
  prob: Record<TrackName, number[]>;
  gate: Record<TrackName, number[]>;
  cond: Record<TrackName, (string | null)[]>;
  /** null = inherit `track_pitch` for that step */
  note: Record<TrackName, (number | null)[]>;
}

/** One row from `GET /patterns` for the load/delete picker. */
export interface PatternListEntry {
  name: string;
  tags: string[];
  bpm: number | null;
  pattern_length: number | null;
  swing: number | null;
}

export type PatternModalState =
  | { phase: "pick"; intent: "load" | "delete"; entries: PatternListEntry[]; idx: number }
  | { phase: "delete-confirm"; name: string };

export function emptyTrigState(length: number): PatternTrigState {
  const row = () => new Array(length).fill(null) as (string | null)[];
  const probRow = () => new Array(length).fill(100);
  const gateRow = () => new Array(length).fill(DEFAULT_GATE_PCT);
  const noteRow = () => new Array(length).fill(null) as (number | null)[];
  return {
    prob: Object.fromEntries(TRACK_NAMES.map((t) => [t, probRow()])) as Record<TrackName, number[]>,
    gate: Object.fromEntries(TRACK_NAMES.map((t) => [t, gateRow()])) as Record<TrackName, number[]>,
    cond: Object.fromEntries(TRACK_NAMES.map((t) => [t, row()])) as Record<TrackName, (string | null)[]>,
    note: Object.fromEntries(TRACK_NAMES.map((t) => [t, noteRow()])) as Record<TrackName, (number | null)[]>,
  };
}

/** Split API `current_pattern` dict into velocity lanes + trig maps (pads to `patternLength`). */
export function parsePatternFromApi(
  raw: Record<string, unknown> | null | undefined,
  patternLength: number,
): { velocities: Record<TrackName, number[]>; trig: PatternTrigState } {
  const velocities = {} as Record<TrackName, number[]>;
  for (const t of TRACK_NAMES) {
    const arr = raw?.[t];
    const nums = Array.isArray(arr) ? (arr as unknown[]).map((x) => (typeof x === "number" ? x : 0)) : [];
    const row = nums.slice(0, patternLength);
    while (row.length < patternLength) row.push(0);
    velocities[t] = row;
  }

  const trig = emptyTrigState(patternLength);

  const mergeNumMap = (key: "prob" | "gate", fill: number) => {
    const block = raw?.[key];
    if (!block || typeof block !== "object") return;
    for (const t of TRACK_NAMES) {
      const arr = (block as Record<string, unknown>)[t];
      if (!Array.isArray(arr)) continue;
      const nums = arr.map((x) => (typeof x === "number" ? x : fill)).slice(0, patternLength);
      while (nums.length < patternLength) nums.push(fill);
      trig[key][t] = nums.slice(0, patternLength);
    }
  };

  mergeNumMap("prob", 100);
  mergeNumMap("gate", DEFAULT_GATE_PCT);

  const noteBlock = raw?.["note"];
  if (noteBlock && typeof noteBlock === "object") {
    for (const t of TRACK_NAMES) {
      const arr = (noteBlock as Record<string, unknown>)[t];
      if (!Array.isArray(arr)) continue;
      const cells = arr.slice(0, patternLength).map((x) => {
        if (x === null || x === undefined) return null;
        if (typeof x === "number" && x >= 0 && x <= 127) return x;
        return null;
      }) as (number | null)[];
      while (cells.length < patternLength) cells.push(null);
      trig.note[t] = cells.slice(0, patternLength);
    }
  }

  const condBlock = raw?.["cond"];
  if (condBlock && typeof condBlock === "object") {
    for (const t of TRACK_NAMES) {
      const arr = (condBlock as Record<string, unknown>)[t];
      if (!Array.isArray(arr)) continue;
      const cells = arr
        .slice(0, patternLength)
        .map((x) => (x === null || x === undefined ? null : String(x))) as (string | null)[];
      while (cells.length < patternLength) cells.push(null);
      trig.cond[t] = cells.slice(0, patternLength);
    }
  }

  return { velocities, trig };
}

/** Derive step count from a `current_pattern` API object when WebSocket frames omit `pattern_length`. */
export function inferPatternLengthFromApi(
  raw: Record<string, unknown> | undefined,
  fallback: number,
): number {
  if (!raw || typeof raw !== "object") return fallback;
  const explicit = raw["pattern_length"];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    const e = Math.round(explicit);
    if (e >= 1 && e <= 64) return e;
  }
  let max = 0;
  for (const t of TRACK_NAMES) {
    const arr = raw[t];
    if (Array.isArray(arr)) max = Math.max(max, arr.length);
  }
  for (const key of ["prob", "gate", "cond", "note"] as const) {
    const block = raw[key];
    if (!block || typeof block !== "object") continue;
    const o = block as Record<string, unknown>;
    for (const t of TRACK_NAMES) {
      const arr = o[t];
      if (Array.isArray(arr)) max = Math.max(max, arr.length);
    }
  }
  if (max >= 1) return max;
  return fallback;
}

export interface DigitaktState {
  current_pattern: Record<TrackName, number[]>;
  /** Parsed from the same document as `current_pattern` on the server. */
  pattern_trig: PatternTrigState;
  bpm: number;
  swing: number;
  pattern_length: number;
  fill_active: boolean;
  fill_queued: string | false;
  is_playing: boolean;
  midi_port_name: string | null;
  ccParams: CCParamDef[];
  track_cc: Record<TrackName, Record<string, number>>;
  track_muted: Record<TrackName, boolean>;
  track_velocity: Record<TrackName, number>;
  track_pitch: Record<string, number>;
  step_cc: Record<TrackName, Partial<Record<string, (number | null)[]>>> | null;
  generation_status: "idle" | "generating" | "failed";
  generation_error: string | null;
  connected: boolean;
  midi_connected: boolean;
  log: string[];
  current_step: number | null;
  /** Monotonic step index from engine while playing (`step_changed.global_step`); null when stopped. */
  global_step: number | null;
  last_prompt: string | null;
  pattern_history: Array<{ prompt: string; timestamp: number; bpm?: number; length?: number; swing?: number }>;
  chain: string[];
  chain_index: number;
  chain_auto: boolean;
  chain_queued_index: number | null;
  chain_armed: boolean;
  generation_summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
    producer_notes?: string;
  } | null;
  seq_mode: "standard" | "euclidean";
  euclid: Record<TrackName, { k: number; n: number; r: number }>;
  euclid_strip_mode: EuclidStripMode;
  /** LFO routes keyed e.g. `cc:kick:filter`, `trig:snare:prob`, `pitch:kick:main` */
  lfo: Record<string, LfoDef>;
  /**
   * Live modulated output from the engine (CC LFO) while playing, keyed by LFO `target`.
   * Cleared when playback stops. Not persisted — WebSocket `lfo_value` only.
   */
  lfo_out: Record<string, { value: number; base: number }>;
}

export function parseLfoFromApi(raw: unknown): Record<string, LfoDef> {
  if (!raw || typeof raw !== "object") return {};
  const inBlock = raw as Record<string, unknown>;
  const out: Record<string, LfoDef> = {};
  for (const [k, v] of Object.entries(inBlock)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const rate = o.rate;
    if (typeof o.shape !== "string" || typeof o.depth !== "number" || !rate || typeof rate !== "object")
      continue;
    const rn = (rate as Record<string, unknown>)["num"];
    const rd = (rate as Record<string, unknown>)["den"];
    if (typeof rn !== "number" || typeof rd !== "number") continue;
    if (
      o.shape !== "sine" &&
      o.shape !== "square" &&
      o.shape !== "triangle" &&
      o.shape !== "ramp" &&
      o.shape !== "saw"
    ) {
      continue;
    }
    out[k] = {
      shape: o.shape,
      depth: o.depth,
      phase: typeof o.phase === "number" ? o.phase : 0,
      rate: { num: rn, den: rd },
    };
  }
  return out;
}

export type FocusPanel = "pattern" | "cc" | "lfo" | "prompt";
