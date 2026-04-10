export const TRACK_NAMES = [
  "kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal",
] as const;

export type TrackName = typeof TRACK_NAMES[number];

export const CC_PARAMS = [
  "tune", "filter", "resonance", "attack", "decay", "volume", "reverb", "delay",
] as const;

export type CCParam = typeof CC_PARAMS[number];

export interface DigitaktState {
  current_pattern: Record<TrackName, number[]>;
  bpm: number;
  swing: number;
  is_playing: boolean;
  midi_port_name: string | null;
  track_cc: Record<TrackName, Record<CCParam, number>>;
  track_muted: Record<TrackName, boolean>;
  track_velocity: Record<TrackName, number>;
  step_cc: Record<TrackName, Partial<Record<CCParam, (number | null)[]>>> | null;
  generation_status: "idle" | "generating" | "failed";
  generation_error: string | null;
  connected: boolean;
  log: string[];
  current_step: number | null;
}

export type FocusPanel = "pattern" | "cc" | "log" | "prompt";
