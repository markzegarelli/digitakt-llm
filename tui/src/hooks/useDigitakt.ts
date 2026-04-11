import { useState, useEffect, useCallback, useRef } from "react";
import type { DigitaktState, TrackName, CCParam } from "../types.js";
import { TRACK_NAMES, CC_PARAMS } from "../types.js";

const DEFAULT_STATE: DigitaktState = {
  current_pattern: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, new Array(16).fill(0)])
  ) as DigitaktState["current_pattern"],
  bpm: 120,
  swing: 0,
  pattern_length: 16,
  fill_active: false,
  fill_queued: false,
  is_playing: false,
  midi_port_name: null,
  track_cc: Object.fromEntries(
    TRACK_NAMES.map((t) => [
      t,
      Object.fromEntries(CC_PARAMS.map((p) => [p, 64])),
    ])
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
  log: [],
  current_step: null,
  pattern_history: [],
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
    default:                     return `${event}`;
  }
}

export interface DigitaktActions {
  setMute(track: TrackName, muted: boolean): Promise<void>;
  setCC(track: TrackName, param: CCParam, value: number): Promise<void>;
  setCCStep(track: TrackName, param: CCParam, step: number, value: number | null): Promise<void>;
  setVelocity(track: TrackName, value: number): Promise<void>;
  setBpm(bpm: number): Promise<void>;
  play(): Promise<void>;
  stop(): Promise<void>;
  generate(prompt: string): Promise<void>;
  setProb(track: TrackName, step: number, value: number): Promise<void>;
  setSwing(amount: number): Promise<void>;
  setVel(track: TrackName, step: number, value: number): Promise<void>;
  randomize(track: string, param: string, lo: number, hi: number): Promise<void>;
  randbeat(): Promise<void>;
  ask(question: string): Promise<string>;
  callNew(): Promise<void>;
  callUndo(): Promise<void>;
  clearLog(): void;
  addLog(msg: string): void;
  queueFill(name: string): Promise<void>;
  setGate(track: string, step: number, value: number): Promise<Response>;
  setPitch(track: string, value: number): Promise<Response>;
  setCond(track: string, step: number, value: string | null): Promise<Response>;
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
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
      return res.json() as Promise<unknown>;
    },
    [baseUrl]
  );

  const fetchState = useCallback(async () => {
    try {
      const data = await api("GET", "/state") as Record<string, unknown>;
      const pattern = data["current_pattern"] as Record<string, unknown>;
      setState((prev) => ({
        ...prev,
        current_pattern: pattern as DigitaktState["current_pattern"],
        bpm: data["bpm"] as number,
        swing: (data["swing"] as number) ?? 0,
        pattern_length: (data["pattern_length"] as number) ?? 16,
        is_playing: data["is_playing"] as boolean,
        midi_port_name: data["midi_port_name"] as string | null,
        track_cc: data["track_cc"] as DigitaktState["track_cc"],
        track_muted: data["track_muted"] as DigitaktState["track_muted"],
        track_velocity: data["track_velocity"] as DigitaktState["track_velocity"],
        track_pitch: (data["track_pitch"] as Record<string, number>) ?? {},
        step_cc: (pattern["step_cc"] as DigitaktState["step_cc"]) ?? null,
        pattern_history: (data["pattern_history"] as DigitaktState["pattern_history"]) ?? [],
        connected: true,
      }));
    } catch {
      // Server not ready yet — reconnect loop will retry
    }
  }, [api]);

  const connect = useCallback(() => {
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => { fetchState(); };

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

        const logEntry = formatLogEntry(msg.event, msg.data);

        setState((prev) => {
          const newLog = [...prev.log, logEntry].slice(-50);
          switch (msg.event) {
            case "pattern_changed":
              return { ...prev, current_pattern: msg.data["pattern"] as DigitaktState["current_pattern"], log: newLog };
            case "bpm_changed":
              return { ...prev, bpm: msg.data["bpm"] as number, log: newLog };
            case "playback_started":
              return { ...prev, is_playing: true, log: newLog };
            case "playback_stopped":
              return { ...prev, is_playing: false, current_step: null, log: newLog };
            case "step_changed":
              return { ...prev, current_step: msg.data["step"] as number };
            case "generation_started":
              return { ...prev, generation_status: "generating", generation_error: null, log: newLog };
            case "generation_complete": {
              const genBpm = msg.data["bpm"] as number | undefined;
              return {
                ...prev,
                generation_status: "idle",
                current_pattern: msg.data["pattern"] as DigitaktState["current_pattern"],
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
              const prevParam = prevTrack[csParam] ?? new Array(16).fill(null) as (number | null)[];
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
            case "swing_changed":
              return { ...prev, swing: msg.data["amount"] as number, log: newLog };
            case "length_changed":
              return { ...prev, pattern_length: (msg.data["steps"] as number) ?? 16, log: newLog };
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
            case "gate_changed":
              fetchState();
              return { ...prev, log: newLog };
            case "pitch_changed":
              return {
                ...prev,
                track_pitch: { ...prev.track_pitch, [msg.data["track"] as string]: msg.data["value"] as number },
                log: newLog,
              };
            case "cond_changed":
              fetchState();
              return { ...prev, log: newLog };
            case "prob_changed":
            case "random_applied":
            case "randbeat_applied":
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
  }, [baseUrl, fetchState]);

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

    play: useCallback(async () => { await api("POST", "/play"); }, [api]),
    stop: useCallback(async () => { await api("POST", "/stop"); }, [api]),

    generate: useCallback(async (prompt: string) => {
      await api("POST", "/generate", { prompt });
    }, [api]),

    setProb: useCallback(async (track: TrackName, step: number, value: number) => {
      await api("POST", "/prob", { track, step, value });
    }, [api]),

    setSwing: useCallback(async (amount: number) => {
      await api("POST", "/swing", { amount });
    }, [api]),

    setVel: useCallback(async (track: TrackName, step: number, value: number) => {
      await api("POST", "/vel", { track, step, value });
    }, [api]),

    randomize: useCallback(async (track: string, param: string, lo: number, hi: number) => {
      await api("POST", "/random", { track, param, lo, hi });
    }, [api]),

    randbeat: useCallback(async () => {
      await api("POST", "/randbeat");
    }, [api]),

    ask: useCallback(async (question: string) => {
      const data = await api("POST", "/ask", { question }) as { answer: string };
      return data.answer;
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
      setState((s) => ({ ...s, fill_queued: true }));
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
  };

  return [state, actions];
}
