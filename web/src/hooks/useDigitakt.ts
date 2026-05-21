import { useState, useEffect, useCallback } from "react";
import type { BackendClient, AppEvent } from "../backend/client.js";
import type { DigitaktState, TrackName, LfoDef, EuclidStripMode, CCParamDef } from "../backend/types.js";
import {
  TRACK_NAMES,
  DEFAULT_GATE_PCT,
  emptyTrigState,
  inferPatternLengthFromApi,
  parseEuclidStripMode,
  parseLfoFromApi,
  parsePatternFromApi,
} from "../backend/types.js";

const DEFAULT_STATE: DigitaktState = {
  current_pattern: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, new Array(16).fill(0)])
  ) as DigitaktState["current_pattern"],
  pattern_trig: emptyTrigState(16),
  bpm: 120,
  swing: 0,
  pattern_length: 16,
  fill_active: false,
  fill_queued: false,
  is_playing: false,
  midi_port_name: null,
  ccParams: [] as CCParamDef[],
  track_cc: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, {} as Record<string, number>])
  ) as DigitaktState["track_cc"],
  track_muted: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, false])
  ) as DigitaktState["track_muted"],
  track_velocity: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, 127])
  ) as DigitaktState["track_velocity"],
  track_pitch: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, 60])
  ) as Record<string, number>,
  step_cc: null,
  generation_status: "idle",
  generation_error: null,
  connected: false,
  midi_connected: false,
  log: [],
  current_step: null,
  global_step: null,
  last_prompt: null,
  pattern_history: [],
  chain: [],
  chain_index: -1,
  chain_auto: false,
  chain_queued_index: null,
  chain_armed: false,
  generation_summary: null,
  seq_mode: "standard" as const,
  euclid: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, { k: 0, n: 16, r: 0 }])
  ) as DigitaktState["euclid"],
  euclid_strip_mode: "grid" as const,
  lfo: {},
  lfo_out: {},
};

function parseEuclidBlock(
  raw: unknown,
  fallback: DigitaktState["euclid"],
): DigitaktState["euclid"] {
  if (!raw || typeof raw !== "object") return fallback;
  const block = raw as Record<string, unknown>;
  const result = { ...fallback };
  for (const t of TRACK_NAMES) {
    const row = block[t];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    result[t] = {
      k: typeof r["k"] === "number" ? r["k"] : fallback[t].k,
      n: typeof r["n"] === "number" ? r["n"] : fallback[t].n,
      r: typeof r["r"] === "number" ? r["r"] : fallback[t].r,
    };
  }
  return result;
}

function copyRow<T>(row: T[] | undefined, length: number, fill: T): T[] {
  if (Array.isArray(row)) return [...row];
  return Array.from({ length }, () => fill);
}

function isTrackName(t: unknown): t is TrackName {
  return typeof t === "string" && (TRACK_NAMES as readonly string[]).includes(t);
}

function applyEvent(state: DigitaktState, event: AppEvent): DigitaktState {
  const type = event["type"] as string;
  switch (type) {
    case "state_snapshot": {
      const raw = event as Record<string, unknown>;
      const pattern = raw["current_pattern"] as Record<string, unknown> | undefined;
      const plen = typeof raw["pattern_length"] === "number" ? raw["pattern_length"] : state.pattern_length;
      const { velocities, trig } = pattern
        ? parsePatternFromApi(pattern, plen)
        : { velocities: state.current_pattern, trig: state.pattern_trig };
      return {
        ...state,
        connected: true,
        bpm: typeof raw["bpm"] === "number" ? raw["bpm"] : state.bpm,
        swing: typeof raw["swing"] === "number" ? raw["swing"] : state.swing,
        pattern_length: plen,
        is_playing: typeof raw["is_playing"] === "boolean" ? raw["is_playing"] : state.is_playing,
        midi_port_name: typeof raw["midi_port_name"] === "string" ? raw["midi_port_name"] : state.midi_port_name,
        midi_connected: typeof raw["midi_connected"] === "boolean" ? raw["midi_connected"] : (raw["midi_port_name"] as string | null) !== null,
        track_muted: (raw["track_muted"] as DigitaktState["track_muted"]) ?? state.track_muted,
        track_velocity: (raw["track_velocity"] as DigitaktState["track_velocity"]) ?? state.track_velocity,
        track_pitch: (raw["track_pitch"] as Record<string, number>) ?? state.track_pitch,
        track_cc: (raw["track_cc"] as DigitaktState["track_cc"]) ?? state.track_cc,
        ccParams: Array.isArray(raw["cc_params"])
          ? (raw["cc_params"] as CCParamDef[]).filter((p) => p.name !== "tune")
          : state.ccParams,
        seq_mode: (raw["seq_mode"] as "standard" | "euclidean") ?? state.seq_mode,
        euclid_strip_mode: parseEuclidStripMode(raw["euclid_strip_mode"]),
        euclid: parseEuclidBlock(pattern?.["euclid"], state.euclid),
        lfo: parseLfoFromApi(pattern?.["lfo"]),
        lfo_out: {},
        current_pattern: velocities,
        pattern_trig: trig,
        fill_active: typeof raw["fill_active"] === "boolean" ? raw["fill_active"] : state.fill_active,
        last_prompt: (raw["last_prompt"] as string | null) ?? state.last_prompt,
        chain: (raw["chain"] as string[]) ?? state.chain,
        chain_index: (raw["chain_index"] as number) ?? state.chain_index,
        chain_auto: (raw["chain_auto"] as boolean) ?? state.chain_auto,
        chain_queued_index: (raw["chain_queued_index"] as number | null) ?? state.chain_queued_index,
        chain_armed: (raw["chain_armed"] as boolean) ?? state.chain_armed,
      };
    }
    case "pattern_changed": {
      const raw = event["pattern"] as Record<string, unknown> | undefined;
      if (!raw) return state;
      const plen = inferPatternLengthFromApi(raw, state.pattern_length);
      const { velocities, trig } = parsePatternFromApi(raw, plen);
      return {
        ...state,
        pattern_length: plen,
        current_pattern: velocities,
        pattern_trig: trig,
        seq_mode: (raw["seq_mode"] as "standard" | "euclidean") ?? state.seq_mode,
        euclid: parseEuclidBlock(raw["euclid"], state.euclid),
        euclid_strip_mode: parseEuclidStripMode(raw["euclid_strip_mode"]),
        lfo: parseLfoFromApi(raw["lfo"]),
        lfo_out: {},
      };
    }
    case "step_changed": {
      const st = event["step"] as number;
      const gsRaw = event["global_step"];
      const global_step = typeof gsRaw === "number" && Number.isFinite(gsRaw) ? gsRaw : st;
      return { ...state, current_step: st, global_step };
    }
    case "bpm_changed":
      return { ...state, bpm: typeof event["bpm"] === "number" ? event["bpm"] : state.bpm };
    case "swing_changed":
      return { ...state, swing: typeof event["amount"] === "number" ? event["amount"] : state.swing };
    case "playback_started":
      return { ...state, is_playing: true };
    case "playback_stopped":
      return { ...state, is_playing: false, current_step: null, global_step: null, lfo_out: {} };
    case "generation_started":
      return { ...state, generation_status: "generating", generation_error: null };
    case "generation_complete": {
      const raw = event["pattern"] as Record<string, unknown> | undefined;
      const plen = raw ? inferPatternLengthFromApi(raw, state.pattern_length) : state.pattern_length;
      const parsed = raw
        ? parsePatternFromApi(raw, plen)
        : { velocities: state.current_pattern, trig: state.pattern_trig };
      return {
        ...state,
        generation_status: "idle",
        pattern_length: plen,
        current_pattern: parsed.velocities,
        pattern_trig: parsed.trig,
        lfo: raw ? parseLfoFromApi(raw["lfo"]) : state.lfo,
        lfo_out: raw ? {} : state.lfo_out,
        seq_mode: raw ? ((raw["seq_mode"] as "standard" | "euclidean") ?? state.seq_mode) : state.seq_mode,
        euclid: raw ? parseEuclidBlock(raw["euclid"], state.euclid) : state.euclid,
        euclid_strip_mode: raw ? parseEuclidStripMode(raw["euclid_strip_mode"]) : state.euclid_strip_mode,
        last_prompt: (event["prompt"] as string | null) ?? state.last_prompt,
        generation_summary: (event["summary"] as DigitaktState["generation_summary"]) ?? null,
        ...(typeof event["bpm"] === "number" ? { bpm: event["bpm"] as number } : {}),
      };
    }
    case "generation_failed":
      return {
        ...state,
        generation_status: "failed",
        generation_error: typeof event["error"] === "string" ? event["error"] : "Generation failed",
      };
    case "mute_changed":
      return {
        ...state,
        track_muted: {
          ...state.track_muted,
          [event["track"] as string]: event["muted"] as boolean,
        },
      };
    case "cc_changed":
      return {
        ...state,
        track_cc: {
          ...state.track_cc,
          [event["track"] as string]: {
            ...state.track_cc[event["track"] as TrackName],
            [event["param"] as string]: event["value"] as number,
          },
        },
      };
    case "velocity_changed":
      return {
        ...state,
        track_velocity: {
          ...state.track_velocity,
          [event["track"] as string]: event["value"] as number,
        },
      };
    case "midi_connected":
      return { ...state, midi_port_name: event["port"] as string, midi_connected: true };
    case "midi_disconnected":
      return { ...state, midi_connected: false };
    case "fill_started":
      return { ...state, fill_active: true, fill_queued: false };
    case "fill_ended":
      return { ...state, fill_active: false };
    case "lfo_changed": {
      const t = event["target"] as string;
      const ld = event["lfo"] as LfoDef | null | undefined;
      const next = { ...state.lfo };
      const nextOut = { ...state.lfo_out };
      if (ld == null) { delete next[t]; delete nextOut[t]; }
      else { next[t] = ld; delete nextOut[t]; }
      return { ...state, lfo: next, lfo_out: nextOut };
    }
    case "lfo_value":
      return {
        ...state,
        lfo_out: {
          ...state.lfo_out,
          [event["target"] as string]: { value: event["value"] as number, base: event["base"] as number },
        },
      };
    case "vel_changed": {
      const track = event["track"];
      const stepRaw = event["step"];
      if (!isTrackName(track) || typeof stepRaw !== "number") return state;
      const step = stepRaw - 1;
      const val = event["value"] as number;
      const newPattern = { ...state.current_pattern };
      const row = copyRow(newPattern[track], state.pattern_length, 0);
      if (step < 0 || step >= row.length) return state;
      row[step] = val;
      newPattern[track] = row;
      return { ...state, current_pattern: newPattern };
    }
    case "gate_changed": {
      const track = event["track"];
      const stepRaw = event["step"];
      if (!isTrackName(track) || typeof stepRaw !== "number") return state;
      const step = stepRaw - 1;
      const val = event["value"] as number;
      const pt = state.pattern_trig;
      const row = copyRow(pt.gate[track], state.pattern_length, DEFAULT_GATE_PCT);
      if (step < 0 || step >= row.length) return state;
      row[step] = val;
      return { ...state, pattern_trig: { ...pt, gate: { ...pt.gate, [track]: row } } };
    }
    case "note_changed": {
      const track = event["track"];
      const stepRaw = event["step"];
      if (!isTrackName(track) || typeof stepRaw !== "number") return state;
      const step = stepRaw - 1;
      const val = (event["value"] ?? null) as number | null;
      const pt = state.pattern_trig;
      const row = copyRow(pt.note[track], state.pattern_length, null);
      if (step < 0 || step >= row.length) return state;
      row[step] = val;
      return { ...state, pattern_trig: { ...pt, note: { ...pt.note, [track]: row } } };
    }
    case "cond_changed": {
      const track = event["track"];
      const stepRaw = event["step"];
      if (!isTrackName(track) || typeof stepRaw !== "number") return state;
      const step = stepRaw - 1;
      const val = (event["value"] as string | null) ?? null;
      const pt = state.pattern_trig;
      const row = copyRow(pt.cond[track], state.pattern_length, null);
      if (step < 0 || step >= row.length) return state;
      row[step] = val;
      return { ...state, pattern_trig: { ...pt, cond: { ...pt.cond, [track]: row } } };
    }
    case "prob_changed": {
      const track = event["track"];
      const stepRaw = event["step"];
      if (!isTrackName(track) || typeof stepRaw !== "number") return state;
      const step = stepRaw - 1;
      const val = event["value"] as number;
      const pt = state.pattern_trig;
      const row = copyRow(pt.prob[track], state.pattern_length, 100);
      if (step < 0 || step >= row.length) return state;
      row[step] = val;
      return { ...state, pattern_trig: { ...pt, prob: { ...pt.prob, [track]: row } } };
    }
    case "chain_updated":
    case "chain_queued":
    case "chain_advanced":
    case "chain_armed":
      return {
        ...state,
        chain: (event["chain"] as string[]) ?? state.chain,
        chain_index: (event["chain_index"] as number) ?? state.chain_index,
        chain_auto: (event["chain_auto"] as boolean) ?? state.chain_auto,
        chain_queued_index: (event["chain_queued_index"] as number | null) ?? state.chain_queued_index,
        chain_armed: type === "chain_armed" ? true : (event["chain_armed"] as boolean) ?? state.chain_armed,
      };
    case "pitch_changed":
      return {
        ...state,
        track_pitch: { ...state.track_pitch, [event["track"] as string]: event["value"] as number },
      };
    default:
      return state;
  }
}

export interface DigitaktActions {
  play(): void;
  stop(): void;
  generate(prompt: string, variation?: boolean): void;
  setBpm(bpm: number): void;
  setSwing(amount: number): void;
  setVel(track: TrackName, step: number, value: number): void;
  setVelTrack(track: TrackName, value: number): void;
  setProb(track: TrackName, step: number, value: number): void;
  setProbTrack(track: TrackName, value: number): void;
  setGate(track: TrackName, step: number, value: number): void;
  setGateTrack(track: TrackName, value: number): void;
  setNote(track: TrackName, step: number, value: number | null): void;
  setCond(track: TrackName, step: number, cond: string | null): void;
  setCC(track: TrackName, param: string, value: number): void;
  setMute(track: TrackName, muted: boolean): void;
  muteQueued(track: TrackName, muted: boolean): void;
  connectMidi(port?: string): void;
  setLfoRoute(target: string, lfo: LfoDef | null): void;
  retargetLfoRoute(oldTarget: string, newTarget: string, lfo: LfoDef): void;
  setEuclidStripMode(mode: EuclidStripMode): void;
  queueFill(name: string): void;
  chainSlotFill(slot: number): void;
  chainNext(): void;
  chainFire(): void;
  chainClear(): void;
  setChain(names: string[], auto?: boolean): void;
  setPitch(track: TrackName, value: number): void;
  randomize(track: string, param: string, lo: number, hi: number): void;
  randbeat(): void;
  ask(question: string): Promise<{ answer: string; is_implementable: boolean }>;
  callNew(): void;
  callUndo(): void;
  addLog(msg: string): void;
  clearLog(): void;
}

export function useDigitakt(client: BackendClient): { state: DigitaktState; actions: DigitaktActions } {
  const [state, setState] = useState<DigitaktState>(DEFAULT_STATE);

  useEffect(() => {
    client.get("/state").then((raw) => {
      setState((s) => applyEvent(s, { type: "state_snapshot", ...(raw as Record<string, unknown>) }));
    }).catch(() => {});

    const unsub = client.subscribe((event) => {
      if (event["type"] === "random_applied" || event["type"] === "randbeat_applied" ||
          event["type"] === "state_reset" || event["type"] === "pattern_loaded") {
        client.get("/state").then((raw) => {
          setState((s) => applyEvent(s, { type: "state_snapshot", ...(raw as Record<string, unknown>) }));
        }).catch(() => {});
        return;
      }
      setState((s) => applyEvent(s, event));
    });

    return unsub;
  }, [client]);

  const post = useCallback((path: string, body?: object) => {
    const p = body !== undefined ? client.post(path, body) : client.post(path);
    p.catch(() => {});
    return p;
  }, [client]);

  const actions: DigitaktActions = {
    play: useCallback(() => post("/play"), [post]),
    stop: useCallback(() => post("/stop"), [post]),
    generate: useCallback((prompt, variation) => {
      const body: Record<string, unknown> = { prompt };
      if (variation !== undefined) body["variation"] = variation;
      post("/generate", body);
    }, [post]),
    setBpm: useCallback((bpm) => post("/bpm", { bpm }), [post]),
    setSwing: useCallback((amount) => post("/swing", { amount }), [post]),
    setVel: useCallback((track, step, value) => post("/vel", { track, step, value }), [post]),
    setVelTrack: useCallback((track, value) => post("/vel-track", { track, value }), [post]),
    setProb: useCallback((track, step, value) => post("/prob", { track, step, value }), [post]),
    setProbTrack: useCallback((track, value) => post("/prob-track", { track, value }), [post]),
    setGate: useCallback((track, step, value) => post("/gate", { track, step, value }), [post]),
    setGateTrack: useCallback((track, value) => post("/gate-track", { track, value }), [post]),
    setNote: useCallback((track, step, value) => post("/note", { track, step, value }), [post]),
    setCond: useCallback((track, step, cond) => post("/cond", { track, step, value: cond }), [post]),
    setCC: useCallback((track, param, value) => post("/cc", { track, param, value }), [post]),
    setMute: useCallback((track, muted) => {
      setState((s) => ({ ...s, track_muted: { ...s.track_muted, [track]: muted } }));
      post("/mute", { track, muted });
    }, [post]),
    muteQueued: useCallback((track, muted) => post("/mute-queued", { track, muted }), [post]),
    connectMidi: useCallback((port) => post("/midi/connect", port ? { port } : {}), [post]),
    setLfoRoute: useCallback((target, lfo) => post("/lfo", { target, lfo }), [post]),
    retargetLfoRoute: useCallback(
      (oldTarget, newTarget, lfo) => {
        setState((s) => {
          const next = { ...s.lfo };
          delete next[oldTarget];
          next[newTarget] = lfo;
          const nextOut = { ...s.lfo_out };
          delete nextOut[oldTarget];
          delete nextOut[newTarget];
          return { ...s, lfo: next, lfo_out: nextOut };
        });
        post("/lfo", { target: oldTarget, lfo: null });
        post("/lfo", { target: newTarget, lfo });
      },
      [post],
    ),
    setEuclidStripMode: useCallback((mode) => post("/euclid-strip-mode", { mode }), [post]),
    queueFill: useCallback((name) => {
      setState((s) => ({ ...s, fill_queued: name }));
      post(`/fill/${encodeURIComponent(name)}`);
    }, [post]),
    chainSlotFill: useCallback((slot) => {
      setState((s) => ({ ...s, fill_queued: `#${slot}` }));
      post(`/chain/slot/${slot}/fill`);
    }, [post]),
    chainNext: useCallback(() => post("/chain/next"), [post]),
    chainFire: useCallback(() => post("/chain/fire"), [post]),
    chainClear: useCallback(() => client.post("/chain").catch(() => {}), [client]),
    setChain: useCallback((names, auto = false) => post("/chain", { names, auto }), [post]),
    setPitch: useCallback((track, value) => {
      setState((s) => ({ ...s, track_pitch: { ...s.track_pitch, [track]: value } }));
      post("/pitch", { track, value });
    }, [post]),
    randomize: useCallback((track, param, lo, hi) => post("/random", { track, param, lo, hi }), [post]),
    randbeat: useCallback(() => post("/randbeat"), [post]),
    ask: useCallback(async (question) => {
      const data = await client.post("/ask", { question }) as { answer: string; is_implementable: boolean };
      return { answer: data.answer, is_implementable: data.is_implementable ?? false };
    }, [client]),
    callNew: useCallback(() => post("/new"), [post]),
    callUndo: useCallback(() => client.post("/undo").catch(() => {}), [client]),
    addLog: useCallback((msg) => setState((s) => ({ ...s, log: [...s.log, msg].slice(-200) })), []),
    clearLog: useCallback(() => setState((s) => ({ ...s, log: [] })), []),
  };

  return { state, actions };
}
