export const TRACK_NAMES = [
  "kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal",
] as const;

/** Default gate length (% of step) when pattern omits gate or a step value. */
export const DEFAULT_GATE_PCT = 50;

export type TrackName = typeof TRACK_NAMES[number];

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
}

export type FocusPanel = "pattern" | "cc" | "log" | "prompt";
