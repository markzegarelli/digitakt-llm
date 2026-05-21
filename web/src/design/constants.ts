import type { TrackName } from "../backend/types.js";
import { TRACK_NAMES } from "../backend/types.js";

export const TRACKS = [
  { id: "BD", name: "kick" as TrackName, color: "#f0a020" },
  { id: "SD", name: "snare" as TrackName, color: "#f0a020" },
  { id: "LT", name: "tom" as TrackName, color: "#f0a020" },
  { id: "CL", name: "clap" as TrackName, color: "#f0a020" },
  { id: "BL", name: "bell" as TrackName, color: "#f0a020" },
  { id: "CH", name: "hihat" as TrackName, color: "#f0a020" },
  { id: "OH", name: "openhat" as TrackName, color: "#f0a020" },
  { id: "CY", name: "cymbal" as TrackName, color: "#f0a020" },
] as const;

export const TRACK_ID_BY_NAME: Record<TrackName, string> = Object.fromEntries(
  TRACKS.map((t) => [t.name, t.id]),
) as Record<TrackName, string>;

export const TRACK_NAME_BY_ID: Record<string, TrackName> = Object.fromEntries(
  TRACKS.map((t) => [t.id, t.name]),
) as Record<string, TrackName>;

export const TRACK_INDEX: Record<TrackName, number> = Object.fromEntries(
  TRACK_NAMES.map((n, i) => [n, i]),
) as Record<TrackName, number>;

export const PARAM_NAMES = [
  "filter", "reso", "attack", "hold", "decay", "volume", "reverb", "delay",
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export const LFO_SHAPES = ["off", "tri", "sin", "saw", "sqr", "exp", "ramp", "rnd"] as const;
export const LFO_DESTS = ["filter", "reso", "decay", "volume", "pitch", "reverb", "delay", "pan"] as const;

export const TRIG_CONDITIONS = [
  "—", "1:2", "2:2", "1:4", "1:8", "1:16", "FILL", "PRE", "NEI", "FIRST", "NOT FIRST",
] as const;

export type UiMode = "SEQ" | "TRIG" | "MIX" | "LFO" | "CHAT" | "CMD";

export type StepStyle = "blocks" | "dots" | "pitchroll";

export interface CmdParamSpec {
  name: string;
  ph: string;
  type: "number" | "string" | "choice";
  min?: number;
  max?: number;
  optional?: boolean;
  options?: string[];
}

export interface CmdSpec {
  name: string;
  desc: string;
  params?: CmdParamSpec[];
}

export const COMMANDS: CmdSpec[] = [
  { name: "bpm", desc: "set tempo", params: [{ name: "bpm", ph: "20–400", type: "number", min: 20, max: 400 }] },
  { name: "play", desc: "start transport" },
  { name: "stop", desc: "stop transport" },
  { name: "swing", desc: "set swing %", params: [{ name: "amt", ph: "0–100", type: "number", min: 0, max: 100 }] },
  { name: "length", desc: "pattern steps", params: [{ name: "steps", ph: "8|16|32", type: "choice", options: ["8", "16", "32"] }] },
  { name: "mute", desc: "toggle track mute", params: [{ name: "track", ph: "1–8", type: "choice", options: ["1", "2", "3", "4", "5", "6", "7", "8"] }] },
  { name: "save", desc: "save pattern", params: [{ name: "name", ph: "name", type: "string" }] },
  { name: "load", desc: "load pattern", params: [{ name: "name", ph: "name", type: "string" }] },
  { name: "patterns", desc: "list saved patterns" },
  { name: "new", desc: "reset pattern" },
  { name: "undo", desc: "undo pattern" },
  { name: "randbeat", desc: "random techno beat" },
  { name: "midi", desc: "connect Digitakt MIDI (optional: list | exact port name)" },
  { name: "help", desc: "open help" },
];

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function fmtBpm(b: number): string {
  return b.toFixed(1);
}

export function fmt2(n: number): string {
  return String(n).padStart(2, "0");
}

export function noteName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const o = Math.floor(midi / 12) - 1;
  return names[midi % 12]! + o;
}
