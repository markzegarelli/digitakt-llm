import type { DigitaktState, TrackName } from "../backend/types.js";
import { TRACK_NAMES } from "../backend/types.js";
import {
  PARAM_NAMES,
  TRACKS,
  type UiMode,
  type StepStyle,
} from "../design/constants.js";
import { condToIndex } from "./condAdapter.js";
import { lfosForTrack, type LfoSlotView } from "./lfoAdapter.js";

export interface StepView {
  on: boolean;
  velocity: number;
  note: number;
  gate: number;
  prob: number;
  condition: number;
  microShift: number;
}

export interface TrackView {
  id: string;
  name: TrackName;
  muted: boolean;
  muteStaged: boolean;
  muteArmed: boolean;
  mix: Record<string, number>;
  trigs: StepView[];
  lfos: LfoSlotView[];
}

export interface ChatMessage {
  who: "user" | "llm" | "sys";
  t: string;
  text: string;
  pending?: boolean;
  delta?: [string, number][];
}

export interface UiCursor {
  track: number;
  step: number;
  mixParam: number;
  trigField: number;
  lfoField: number;
  lfoIdx: number;
  chatLine: number;
}

export interface UiState {
  mode: UiMode;
  prevMode: UiMode;
  lastWorkbench: "TRIG" | "MIX" | "LFO";
  cursor: UiCursor;
  cmd: string;
  cmdHighlight: number;
  cmdHistory: string[];
  cmdHistoryIdx: number;
  helpOpen: boolean;
  chat: ChatMessage[];
  stepStyle: StepStyle;
  patternName: string;
  patternIndex: number;
  /** Tracks staged with q (yellow Q) before Shift+Q. */
  pendingMuteTracks: TrackName[];
  /** Tracks queued on server (red Q) until mute_changed. */
  armedMuteTracks: TrackName[];
}

export interface WorkbenchView {
  ui: UiState;
  tracks: TrackView[];
  playing: boolean;
  playhead: number;
  bpm: number;
  swing: number;
  stepLen: number;
  globalStep: number | null;
  bar: number;
  midiPort: string;
  midiConnected: boolean;
  version: string;
  generationStatus: DigitaktState["generation_status"];
  chainLabel: string;
  seqMode: DigitaktState["seq_mode"];
}

export function defaultUiState(): UiState {
  return {
    mode: "SEQ",
    prevMode: "SEQ",
    lastWorkbench: "TRIG",
    cursor: { track: 0, step: 0, mixParam: 0, trigField: 1, lfoField: 0, lfoIdx: 0, chatLine: 0 },
    cmd: "",
    cmdHighlight: 0,
    cmdHistory: [],
    cmdHistoryIdx: -1,
    helpOpen: false,
    chat: [
      { who: "sys", t: "boot", text: "DGTK web ready. Connect Digitakt via /midi or hardware menu." },
    ],
    stepStyle: "blocks",
    patternName: "LIVE PATTERN",
    patternIndex: 0,
    pendingMuteTracks: [],
    armedMuteTracks: [],
  };
}

function ccValue(state: DigitaktState, track: TrackName, param: string): number {
  const row = state.track_cc[track];
  if (row[param] !== undefined) return row[param]!;
  const def = state.ccParams.find((p) => p.name === param);
  return def?.default ?? 64;
}

export function buildTrackViews(
  state: DigitaktState,
  pendingMuteTracks: readonly TrackName[] = [],
  armedMuteTracks: readonly TrackName[] = [],
): TrackView[] {
  const staged = new Set(pendingMuteTracks);
  const armed = new Set(armedMuteTracks);
  const len = state.pattern_length;
  return TRACKS.map((meta) => {
    const name = meta.name;
    const trigs: StepView[] = [];
    for (let i = 0; i < len; i++) {
      const vel = state.current_pattern[name][i] ?? 0;
      const note =
        state.pattern_trig.note[name][i] ?? state.track_pitch[name] ?? 60;
      trigs.push({
        on: vel > 0,
        velocity: vel,
        note: note ?? 60,
        gate: state.pattern_trig.gate[name][i] ?? 50,
        prob: state.pattern_trig.prob[name][i] ?? 100,
        condition: condToIndex(state.pattern_trig.cond[name][i]),
        microShift: 0,
      });
    }
    const mix: Record<string, number> = {};
    for (const p of PARAM_NAMES) {
      const apiKey = p === "reso" ? (rowHas(state, name, "reso") ? "reso" : "resonance") : p;
      mix[p] = ccValue(state, name, apiKey);
    }

    return {
      id: meta.id,
      name,
      muted: state.track_muted[name],
      muteStaged: staged.has(name),
      muteArmed: armed.has(name),
      mix,
      trigs,
      lfos: lfosForTrack(state, name),
    };
  });
}

function rowHas(state: DigitaktState, track: TrackName, param: string): boolean {
  return state.track_cc[track][param] !== undefined;
}

export function playheadFromState(state: DigitaktState): number {
  if (!state.is_playing || state.current_step == null) return 0;
  return Math.max(0, state.current_step - 1);
}

export function chainHeaderLabel(state: DigitaktState): string {
  if (!state.chain.length) return "";
  const pos = state.chain_index >= 0 ? state.chain_index + 1 : 0;
  const name = state.chain_index >= 0 ? state.chain[state.chain_index] : "—";
  const extra = state.chain_armed ? " · ARM" : state.chain_queued_index != null ? " · Q" : "";
  return `${pos}/${state.chain.length} ${name ?? ""}${extra}`;
}

export function buildWorkbenchView(state: DigitaktState, ui: UiState): WorkbenchView {
  const gs = state.global_step;
  const bar = gs != null ? Math.floor(gs / state.pattern_length) + 1 : 1;
  return {
    ui,
    tracks: buildTrackViews(state, ui.pendingMuteTracks, ui.armedMuteTracks),
    playing: state.is_playing,
    playhead: playheadFromState(state),
    bpm: state.bpm,
    swing: state.swing,
    stepLen: state.pattern_length,
    globalStep: gs,
    bar,
    midiPort: state.midi_port_name ?? "—",
    midiConnected: state.midi_connected,
    version: "v0.5",
    generationStatus: state.generation_status,
    chainLabel: chainHeaderLabel(state),
    seqMode: state.seq_mode,
  };
}

export function trackAtCursor(view: WorkbenchView): TrackView {
  return view.tracks[view.ui.cursor.track]!;
}

export function nowTag(startMs: number): string {
  const ms = Date.now() - startMs;
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `+${m}:${String(s).padStart(2, "0")}`;
}
