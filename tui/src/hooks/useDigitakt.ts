import { useState, useEffect, useCallback, useRef } from "react";
import type { DigitaktState, TrackName, CCParam } from "../types.js";
import { TRACK_NAMES, CC_PARAMS } from "../types.js";

const DEFAULT_STATE: DigitaktState = {
  current_pattern: Object.fromEntries(
    TRACK_NAMES.map((t) => [t, new Array(16).fill(0)])
  ) as DigitaktState["current_pattern"],
  bpm: 120,
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
  generation_status: "idle",
  generation_error: null,
  connected: false,
};

export interface DigitaktActions {
  setMute(track: TrackName, muted: boolean): Promise<void>;
  setCC(track: TrackName, param: CCParam, value: number): Promise<void>;
  setBpm(bpm: number): Promise<void>;
  play(): Promise<void>;
  stop(): Promise<void>;
  generate(prompt: string): Promise<void>;
}

export function useDigitakt(baseUrl: string): [DigitaktState, DigitaktActions] {
  const [state, setState] = useState<DigitaktState>(DEFAULT_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setState((prev) => ({
        ...prev,
        current_pattern: data["current_pattern"] as DigitaktState["current_pattern"],
        bpm: data["bpm"] as number,
        is_playing: data["is_playing"] as boolean,
        midi_port_name: data["midi_port_name"] as string | null,
        track_cc: data["track_cc"] as DigitaktState["track_cc"],
        track_muted: data["track_muted"] as DigitaktState["track_muted"],
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
        setState((prev) => {
          switch (msg.event) {
            case "pattern_changed":
              return { ...prev, current_pattern: msg.data["pattern"] as DigitaktState["current_pattern"] };
            case "bpm_changed":
              return { ...prev, bpm: msg.data["bpm"] as number };
            case "playback_started":
              return { ...prev, is_playing: true };
            case "playback_stopped":
              return { ...prev, is_playing: false };
            case "generation_started":
              return { ...prev, generation_status: "generating", generation_error: null };
            case "generation_complete":
              return {
                ...prev,
                generation_status: "idle",
                current_pattern: msg.data["pattern"] as DigitaktState["current_pattern"],
              };
            case "generation_failed":
              return {
                ...prev,
                generation_status: "failed",
                generation_error: msg.data["error"] as string,
              };
            case "mute_changed":
              return {
                ...prev,
                track_muted: {
                  ...prev.track_muted,
                  [msg.data["track"] as string]: msg.data["muted"] as boolean,
                },
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
              };
            default:
              return prev;
          }
        });
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => { ws.close(); };
  }, [baseUrl, fetchState]);

  useEffect(() => {
    connect();
    return () => {
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

    setBpm: useCallback(async (bpm: number) => {
      await api("POST", "/bpm", { bpm });
    }, [api]),

    play: useCallback(async () => { await api("POST", "/play"); }, [api]),
    stop: useCallback(async () => { await api("POST", "/stop"); }, [api]),

    generate: useCallback(async (prompt: string) => {
      await api("POST", "/generate", { prompt });
    }, [api]),
  };

  return [state, actions];
}
