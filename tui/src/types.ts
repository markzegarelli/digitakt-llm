export const TRACK_NAMES = [
  "kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal",
] as const;

export type TrackName = typeof TRACK_NAMES[number];

export interface CCParamDef {
  name: string;
  cc: number;
  default: number;
}

export type CCParam = string;

export interface DigitaktState {
  current_pattern: Record<TrackName, number[]>;
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
  generation_summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
  } | null;
}

export type FocusPanel = "pattern" | "cc" | "log" | "prompt";
