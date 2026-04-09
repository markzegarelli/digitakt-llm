export const TRACK_NAMES = [
  "kick", "snare", "hihat", "clap", "perc1", "perc2", "perc3", "perc4",
] as const;

export type TrackName = typeof TRACK_NAMES[number];

export const CC_PARAMS = [
  "tune", "filter", "resonance", "attack", "decay", "volume", "reverb", "delay",
] as const;

export type CCParam = typeof CC_PARAMS[number];

export interface DigitaktState {
  current_pattern: Record<TrackName, number[]>;
  bpm: number;
  is_playing: boolean;
  midi_port_name: string | null;
  track_cc: Record<TrackName, Record<CCParam, number>>;
  track_muted: Record<TrackName, boolean>;
  generation_status: "idle" | "generating" | "failed";
  generation_error: string | null;
  connected: boolean;
}

export type FocusPanel = "pattern" | "cc" | "prompt";
