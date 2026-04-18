import { useState, useEffect, useCallback, useRef } from "react";
import type { DigitaktState, TrackName, CCParam, CCParamDef, PatternTrigState } from "../types.js";
import { TRACK_NAMES, emptyTrigState, parsePatternFromApi } from "../types.js";

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
  last_prompt: null,
  pattern_history: [],
  chain: [],
  chain_index: -1,
  chain_auto: false,
  chain_queued_index: null,
  chain_armed: false,
  generation_summary: null,
};

function formatLogEntry(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case "generation_started":   return `generating: ${data["prompt"]}...`;
    case "generation_complete":  return `pattern ready: ${data["prompt"]}`;
    case "generation_failed":    return `generation failed: ${data["error"]}`;
    case "pattern_changed":      return "pattern changed";
    case "bpm_changed":          return `BPM: ${data["bpm"]}`;
    case "playback_started":     return "playback started";
    case "playback_stopped":     return "playback stopped";
    case "midi_disconnected":    return `MIDI disconnected: ${data["port"]}`;
    case "cc_changed":           return `CC: ${data["track"]} ${data["param"]} = ${data["value"]}`;
    case "cc_step_changed":      return `CC step: ${data["track"]} ${data["param"]} step ${data["step"]} = ${data["value"]}`;
    case "mute_changed":         return `mute: ${data["track"]} = ${data["muted"]}`;
    case "velocity_changed":     return `velocity: ${data["track"]} = ${data["value"]}`;
    case "prob_changed":         return `prob: ${data["track"]} step ${data["step"]} = ${data["value"]}%`;
    case "vel_changed":          return `vel: ${data["track"]} step ${data["step"]} = ${data["value"]}`;
    case "swing_changed":        return `swing: ${data["amount"]}`;
    case "length_changed":       return `Pattern length → ${data["steps"]} steps`;
    case "fill_started":         return "Fill playing";
    case "fill_ended":           return "Fill ended — reverted";
    case "random_applied":       return `randomized ${data["param"]} for ${data["track"]}`;
    case "randbeat_applied":     return `randbeat: ${data["bpm"]} BPM, swing ${data["swing"]}`;
    case "state_reset":          return "state reset";
    case "pattern_loaded":       return "pattern loaded";
    case "ask_complete": {
      const ans = (data["answer"] as string) ?? "";
      const preview = ans.length > 80 ? ans.slice(0, 80) + "…" : ans;
      return `ask: ${preview}`;
    }
    default:                     return `${event}`;
  }
}

export interface DigitaktActions {
  setMute(track: TrackName, muted: boolean): Promise<void>;
  setMuteQueued(track: TrackName, muted: boolean): Promise<void>;
  setCC(track: TrackName, param: CCParam, value: number): Promise<void>;
  setCCStep(track: TrackName, param: CCParam, step: number, value: number | null): Promise<void>;
  setVelocity(track: TrackName, value: number): Promise<void>;
  setBpm(bpm: number): Promise<void>;
  play(): Promise<void>;
  stop(): Promise<void>;
  generate(prompt: string): Promise<void>;
  setProb(track: TrackName, step: number, value: number): Promise<void>;
  setProbTrack(track: TrackName, value: number): Promise<void>;
  setSwing(amount: number): Promise<void>;
  setVel(track: TrackName, step: number, value: number): Promise<void>;
  setVelTrack(track: TrackName, value: number): Promise<void>;
  randomize(track: string, param: string, lo: number, hi: number): Promise<void>;
  randbeat(): Promise<void>;
  ask(question: string): Promise<{ answer: string; is_implementable: boolean }>;
  callNew(): Promise<void>;
  callUndo(): Promise<void>;
  clearLog(): void;
  addLog(msg: string): void;
  queueFill(name: string): Promise<void>;
  setGate(track: string, step: number, value: number): Promise<Response>;
  setGateTrack(track: string, value: number): Promise<void>;
  setPitch(track: string, value: number): Promise<Response>;
  setCond(track: string, step: number, value: string | null): Promise<Response>;
  setChain(names: string[], auto?: boolean): Promise<void>;
  chainNext(): Promise<void>;
  chainFire(): Promise<void>;
  chainClear(): Promise<void>;
  setCCFocusedTrack(track: TrackName): Promise<void>;
}

export function useDigitakt(baseUrl: string): [DigitaktState, DigitaktActions] {
  const [state, setState] = useState<DigitaktState>(DEFAULT_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuttingDown = useRef(false);

  const api = useCallback(
    async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { detail?: unknown };
        const detail = Array.isArray(errBody.detail)
          ? (errBody.detail as Array<{ msg: string }>).map((e) => e.msg).join("; ")
          : ((errBody.detail as string | undefined) ?? `${method} ${path} → ${res.status}`);
        throw new Error(detail);
      }
      return res.json() as Promise<unknown>;
    },
    [baseUrl]
  );

  const fetchCCParams = useCallback(async () => {
    try {
      const data = await api("GET", "/cc-params") as { params: CCParamDef[] };
      const params = data.params.filter((p) => p.name !== "tune");
      setState((prev) => ({ ...prev, ccParams: params }));
    } catch {
      // Server not ready yet — will retry on reconnect
    }
  }, [api]);

  const fetchState = useCallback(async () => {
    try {
      const data = await api("GET", "/state") as Record<string, unknown>;
      const pattern = data["current_pattern"] as Record<string, unknown>;
      const plen = (data["pattern_length"] as number) ?? 16;
      const { velocities, trig } = parsePatternFromApi(pattern, plen);
      setState((prev) => ({
        ...prev,
        current_pattern: velocities,
        pattern_trig: trig,
        bpm: data["bpm"] as number,
        swing: (data["swing"] as number) ?? 0,
        pattern_length: plen,
        is_playing: data["is_playing"] as boolean,
        midi_port_name: data["midi_port_name"] as string | null,
        track_cc: data["track_cc"] as DigitaktState["track_cc"],
        track_muted: data["track_muted"] as DigitaktState["track_muted"],
        track_velocity: data["track_velocity"] as DigitaktState["track_velocity"],
        track_pitch: (data["track_pitch"] as Record<string, number>) ?? {},
        step_cc: (pattern["step_cc"] as DigitaktState["step_cc"]) ?? null,
        last_prompt: (data["last_prompt"] as string | null) ?? null,
        pattern_history: (data["pattern_history"] as DigitaktState["pattern_history"]) ?? [],
        chain: (data["chain"] as string[]) ?? prev.chain,
        chain_index: (data["chain_index"] as number) ?? prev.chain_index,
        chain_auto: (data["chain_auto"] as boolean) ?? prev.chain_auto,
        chain_queued_index: (data["chain_queued_index"] as number | null) ?? prev.chain_queued_index,
        chain_armed: (data["chain_armed"] as boolean) ?? prev.chain_armed,
        connected: true,
        midi_connected: (data["midi_port_name"] as string | null) !== null,
      }));
    } catch {
      // Server not ready yet — reconnect loop will retry
    }
  }, [api]);

  // Batch hardware CC updates into a single setState per flush interval to
  // prevent rapid successive Ink redraws when a knob is being turned.
  const hardwareCCQueue = useRef<Record<string, Record<string, number>>>({});
  const ccFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushHardwareCC = useCallback(() => {
    ccFlushTimer.current = null;
    const updates = hardwareCCQueue.current;
    hardwareCCQueue.current = {};
    if (Object.keys(updates).length === 0) return;
    setState((prev) => {
      const newCC = { ...prev.track_cc };
      for (const [track, params] of Object.entries(updates)) {
        newCC[track as TrackName] = { ...newCC[track as TrackName], ...params };
      }
      return { ...prev, track_cc: newCC };
    });
  }, []);

  const connect = useCallback(() => {
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => { fetchState(); fetchCCParams(); };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          event: string;
          data: Record<string, unknown>;
        };

        // Re-fetch full state for bulk pattern changes
        if (msg.event === "random_applied" || msg.event === "randbeat_applied") {
          fetchState();
        }

        // Hardware CC: batch into a single flush to prevent rapid Ink redraws
        if (msg.event === "cc_changed" && msg.data["source"] === "hardware") {
          const track = msg.data["track"] as string;
          const param = msg.data["param"] as string;
          const value = msg.data["value"] as number;
          if (!hardwareCCQueue.current[track]) hardwareCCQueue.current[track] = {};
          hardwareCCQueue.current[track][param] = value;
          if (!ccFlushTimer.current) {
            ccFlushTimer.current = setTimeout(flushHardwareCC, 80);
          }
          return;
        }

        const logEntry = formatLogEntry(msg.event, msg.data);

        setState((prev) => {
          const newLog = [...prev.log, logEntry].slice(-50);
          switch (msg.event) {
            case "pattern_changed": {
              const raw = msg.data["pattern"] as Record<string, unknown> | undefined;
              if (!raw) return { ...prev, log: newLog };
              const plen = prev.pattern_length;
              const { velocities, trig } = parsePatternFromApi(raw, plen);
              return { ...prev, current_pattern: velocities, pattern_trig: trig, log: newLog };
            }
            case "bpm_changed":
              return { ...prev, bpm: msg.data["bpm"] as number, log: newLog };
            case "playback_started":
              return { ...prev, is_playing: true, log: newLog };
            case "playback_stopped":
              return { ...prev, is_playing: false, current_step: null, log: newLog };
            case "step_changed":
              return { ...prev, current_step: msg.data["step"] as number, log: newLog };
            case "generation_started":
              return { ...prev, generation_status: "generating", generation_error: null, log: newLog };
            case "generation_complete": {
              const genBpm = msg.data["bpm"] as number | undefined;
              const raw = msg.data["pattern"] as Record<string, unknown> | undefined;
              const plen = prev.pattern_length;
              const parsed = raw
                ? parsePatternFromApi(raw, plen)
                : { velocities: prev.current_pattern, trig: prev.pattern_trig };
              return {
                ...prev,
                generation_status: "idle",
                current_pattern: parsed.velocities,
                pattern_trig: parsed.trig,
                last_prompt: (msg.data["prompt"] as string | null) ?? prev.last_prompt,
                generation_summary: (msg.data["summary"] as DigitaktState["generation_summary"]) ?? null,
                ...(genBpm ? { bpm: genBpm } : {}),
                log: newLog,
              };
            }
            case "generation_failed":
              return {
                ...prev,
                generation_status: "failed",
                generation_error: msg.data["error"] as string,
                log: newLog,
              };
            case "mute_changed":
              return {
                ...prev,
                track_muted: {
                  ...prev.track_muted,
                  [msg.data["track"] as string]: msg.data["muted"] as boolean,
                },
                log: newLog,
              };
            case "cc_changed":
              return {
                ...prev,
                track_cc: {
                  ...prev.track_cc,
                  [msg.data["track"] as string]: {
                    ...prev.track_cc[msg.data["track"] as TrackName],
                    [msg.data["param"] as string]: msg.data["value"] as number,
                  },
                },
                log: newLog,
              };
            case "cc_step_changed": {
              const csTrack = msg.data["track"] as TrackName;
              const csParam = msg.data["param"] as CCParam;
              const csStep = (msg.data["step"] as number) - 1;
              const csValue = msg.data["value"] as number;
              const prevStepCC = prev.step_cc ?? ({} as DigitaktState["step_cc"]);
              const prevTrack = (prevStepCC as Record<string, Record<string, (number | null)[]>>)[csTrack] ?? {};
              const prevParam = prevTrack[csParam] ?? new Array(prev.pattern_length).fill(null) as (number | null)[];
              const newParam = [...prevParam];
              newParam[csStep] = csValue === -1 ? null : csValue;
              return {
                ...prev,
                step_cc: {
                  ...prevStepCC,
                  [csTrack]: {
                    ...prevTrack,
                    [csParam]: newParam,
                  },
                } as DigitaktState["step_cc"],
                log: newLog,
              };
            }
            case "velocity_changed":
              return {
                ...prev,
                track_velocity: {
                  ...prev.track_velocity,
                  [msg.data["track"] as string]: msg.data["value"] as number,
                },
                log: newLog,
              };
            case "midi_disconnected":
              return { ...prev, midi_connected: false, log: newLog };
            case "swing_changed":
              return { ...prev, swing: msg.data["amount"] as number, log: newLog };
            case "length_changed": {
              const steps = (msg.data["steps"] as number) ?? 16;
              const { velocities, trig } = parsePatternFromApi(
                {
                  ...prev.current_pattern,
                  prob: prev.pattern_trig.prob,
                  gate: prev.pattern_trig.gate,
                  cond: prev.pattern_trig.cond,
                } as unknown as Record<string, unknown>,
                steps,
              );
              return {
                ...prev,
                pattern_length: steps,
                current_pattern: velocities,
                pattern_trig: trig,
                log: newLog,
              };
            }
            case "fill_started":
              return { ...prev, fill_active: true, fill_queued: false, log: newLog };
            case "fill_ended":
              return { ...prev, fill_active: false, log: newLog };
            case "vel_changed": {
              const velTrack = msg.data["track"] as TrackName;
              const velStep = (msg.data["step"] as number) - 1;
              const velValue = msg.data["value"] as number;
              const newPattern = { ...prev.current_pattern };
              newPattern[velTrack] = [...newPattern[velTrack]];
              newPattern[velTrack][velStep] = velValue;
              return { ...prev, current_pattern: newPattern, log: newLog };
            }
            case "gate_changed": {
              const gTrack = msg.data["track"] as TrackName;
              const gStep = (msg.data["step"] as number) - 1;
              const gVal = msg.data["value"] as number;
              const pt = prev.pattern_trig;
              const row = [...pt.gate[gTrack]];
              row[gStep] = gVal;
              return {
                ...prev,
                pattern_trig: { ...pt, gate: { ...pt.gate, [gTrack]: row } },
                log: newLog,
              };
            }
            case "pitch_changed":
              return {
                ...prev,
                track_pitch: { ...prev.track_pitch, [msg.data["track"] as string]: msg.data["value"] as number },
                log: newLog,
              };
            case "cond_changed": {
              const cTrack = msg.data["track"] as TrackName;
              const cStep = (msg.data["step"] as number) - 1;
              const cVal = (msg.data["value"] as string | null) ?? null;
              const pt = prev.pattern_trig;
              const row = [...pt.cond[cTrack]];
              row[cStep] = cVal;
              return {
                ...prev,
                pattern_trig: { ...pt, cond: { ...pt.cond, [cTrack]: row } },
                log: newLog,
              };
            }
            case "prob_changed": {
              const pTrack = msg.data["track"] as TrackName;
              const pStep = (msg.data["step"] as number) - 1;
              const pVal = msg.data["value"] as number;
              const pt = prev.pattern_trig;
              const row = [...pt.prob[pTrack]];
              row[pStep] = pVal;
              return {
                ...prev,
                pattern_trig: { ...pt, prob: { ...pt.prob, [pTrack]: row } },
                log: newLog,
              };
            }
            case "random_applied":
            case "randbeat_applied":
              return { ...prev, log: newLog };
            case "state_reset":
              fetchState();
              return { ...prev, log: newLog };
            case "pattern_loaded":
              fetchState();
              return { ...prev, log: newLog };
            case "chain_updated":
              return {
                ...prev,
                chain: (msg.data["chain"] as string[]) ?? [],
                chain_index: (msg.data["chain_index"] as number) ?? -1,
                chain_auto: (msg.data["chain_auto"] as boolean) ?? false,
                chain_queued_index: (msg.data["chain_queued_index"] as number | null) ?? null,
                chain_armed: (msg.data["chain_armed"] as boolean) ?? false,
                log: newLog,
              };
            case "chain_queued":
              return {
                ...prev,
                chain: (msg.data["chain"] as string[]) ?? prev.chain,
                chain_index: (msg.data["chain_index"] as number) ?? prev.chain_index,
                chain_auto: (msg.data["chain_auto"] as boolean) ?? prev.chain_auto,
                chain_queued_index: (msg.data["chain_queued_index"] as number | null) ?? prev.chain_queued_index,
                chain_armed: false,
                log: newLog,
              };
            case "chain_armed":
              return {
                ...prev,
                chain: (msg.data["chain"] as string[]) ?? prev.chain,
                chain_index: (msg.data["chain_index"] as number) ?? prev.chain_index,
                chain_auto: (msg.data["chain_auto"] as boolean) ?? prev.chain_auto,
                chain_queued_index: (msg.data["chain_queued_index"] as number | null) ?? prev.chain_queued_index,
                chain_armed: (msg.data["chain_armed"] as boolean) ?? true,
                log: newLog,
              };
            case "chain_advanced":
              return {
                ...prev,
                chain: (msg.data["chain"] as string[]) ?? prev.chain,
                chain_index: (msg.data["chain_index"] as number) ?? prev.chain_index,
                chain_auto: (msg.data["chain_auto"] as boolean) ?? prev.chain_auto,
                chain_queued_index: (msg.data["chain_queued_index"] as number | null) ?? null,
                chain_armed: (msg.data["chain_armed"] as boolean) ?? false,
                log: newLog,
              };
            case "ask_complete":
              return { ...prev, log: newLog };
            default:
              return { ...prev, log: newLog };
          }
        });
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      if (shuttingDown.current) return;
      setState((prev) => ({ ...prev, connected: false }));
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => { ws.close(); };
  }, [baseUrl, fetchState, fetchCCParams]);

  useEffect(() => {
    connect();
    return () => {
      shuttingDown.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const actions: DigitaktActions = {
    setMute: useCallback(async (track: TrackName, muted: boolean) => {
      setState((prev) => ({
        ...prev,
        track_muted: { ...prev.track_muted, [track]: muted },
      }));
      await api("POST", "/mute", { track, muted });
    }, [api]),

    setMuteQueued: useCallback(async (track: TrackName, muted: boolean) => {
      await api("POST", "/mute-queued", { track, muted });
    }, [api]),

    setCC: useCallback(async (track: TrackName, param: CCParam, value: number) => {
      setState((prev) => ({
        ...prev,
        track_cc: {
          ...prev.track_cc,
          [track]: { ...prev.track_cc[track], [param]: value },
        },
      }));
      await api("POST", "/cc", { track, param, value });
    }, [api]),

    setCCStep: useCallback(async (track: TrackName, param: CCParam, step: number, value: number | null) => {
      await api("POST", "/cc-step", { track, param, step, value: value ?? -1 });
    }, [api]),

    setVelocity: useCallback(async (track: TrackName, value: number) => {
      setState((prev) => ({
        ...prev,
        track_velocity: { ...prev.track_velocity, [track]: value },
      }));
      await api("POST", "/velocity", { track, value });
    }, [api]),

    setBpm: useCallback(async (bpm: number) => {
      await api("POST", "/bpm", { bpm });
    }, [api]),

    play: useCallback(async () => {
      try {
        await api("POST", "/play");
      } catch {
        setState((s) => ({
          ...s,
          log: [...s.log, "✗ Playback could not start"].slice(-50),
        }));
      }
    }, [api]),
    stop: useCallback(async () => { await api("POST", "/stop"); }, [api]),

    generate: useCallback(async (prompt: string) => {
      await api("POST", "/generate", { prompt });
    }, [api]),

    setProb: useCallback(async (track: TrackName, step: number, value: number) => {
      await api("POST", "/prob", { track, step, value });
    }, [api]),

    setProbTrack: useCallback(async (track: TrackName, value: number) => {
      await api("POST", "/prob-track", { track, value });
    }, [api]),

    setSwing: useCallback(async (amount: number) => {
      await api("POST", "/swing", { amount });
    }, [api]),

    setVel: useCallback(async (track: TrackName, step: number, value: number) => {
      await api("POST", "/vel", { track, step, value });
    }, [api]),

    setVelTrack: useCallback(async (track: TrackName, value: number) => {
      await api("POST", "/vel-track", { track, value });
    }, [api]),

    randomize: useCallback(async (track: string, param: string, lo: number, hi: number) => {
      await api("POST", "/random", { track, param, lo, hi });
    }, [api]),

    randbeat: useCallback(async () => {
      await api("POST", "/randbeat");
    }, [api]),

    ask: useCallback(async (question: string) => {
      const data = await api("POST", "/ask", { question }) as { answer: string; is_implementable: boolean };
      return { answer: data.answer, is_implementable: data.is_implementable ?? false };
    }, [api]),

    callNew: useCallback(async () => {
      await api("POST", "/new");
    }, [api]),

    callUndo: useCallback(async () => {
      await api("POST", "/undo").catch(() => {
        // 404 = no history, silently ignore
      });
    }, [api]),

      clearLog: useCallback(() => {
      setState((s) => ({ ...s, log: [] }));
    }, []),

    addLog: useCallback((msg: string) => {
      setState((s) => ({ ...s, log: [...s.log, msg].slice(-50) }));
    }, []),

    queueFill: useCallback(async (name: string) => {
      setState((s) => ({ ...s, fill_queued: name }));
      const resp = await fetch(`${baseUrl}/fill/${encodeURIComponent(name)}`, { method: "POST" });
      if (!resp.ok) {
        setState((s) => ({ ...s, fill_queued: false }));
        throw new Error(`Pattern '${name}' not found`);
      }
    }, [baseUrl]),

    setGate: useCallback((track: string, step: number, value: number) =>
      fetch(`${baseUrl}/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, step, value }),
      }), [baseUrl]),

    setGateTrack: useCallback(async (track: string, value: number) => {
      await api("POST", "/gate-track", { track, value });
    }, [api]),

    setPitch: useCallback((track: string, value: number) => {
      setState((s) => ({ ...s, track_pitch: { ...s.track_pitch, [track]: value } }));
      return fetch(`${baseUrl}/pitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, value }),
      });
    }, [baseUrl]),

    setCond: useCallback((track: string, step: number, value: string | null) =>
      fetch(`${baseUrl}/cond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, step, value }),
      }), [baseUrl]),

    setChain: useCallback(async (names: string[], auto = false) => {
      await api("POST", "/chain", { names, auto });
    }, [api]),

    chainNext: useCallback(async () => {
      await api("POST", "/chain/next");
    }, [api]),

    chainFire: useCallback(async () => {
      await api("POST", "/chain/fire");
    }, [api]),

    chainClear: useCallback(async () => {
      await api("DELETE", "/chain");
    }, [api]),

    setCCFocusedTrack: useCallback(async (track: TrackName) => {
      await api("POST", "/cc-focused-track", { track });
    }, [api]),
  };

  return [state, actions];
}
