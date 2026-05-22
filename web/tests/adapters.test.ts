import { describe, it, expect } from "vitest";
import { condToIndex, indexToCond, condLabel } from "../src/lib/condAdapter.js";
import {
  applySlotField,
  lfoDefToSlot,
  newDefaultSlot,
  slotToLfoDef,
} from "../src/lib/lfoAdapter.js";
import { buildTrackViews, playheadFromState } from "../src/lib/viewModel.js";
import type { DigitaktState } from "../src/backend/types.js";
import { TRACK_NAMES, emptyTrigState } from "../src/backend/types.js";

describe("condAdapter", () => {
  it("maps API cond strings to indices", () => {
    expect(condToIndex(null)).toBe(0);
    expect(condToIndex("1:2")).toBe(1);
    expect(condToIndex("fill")).toBe(6);
    expect(indexToCond(6)).toBe("fill");
    expect(condLabel(1)).toBe("1:2");
  });
});

describe("lfoAdapter", () => {
  it("round-trips LFO def through slot view", () => {
    const slot = lfoDefToSlot("cc:kick:filter", "kick", {
      shape: "sine",
      depth: 40,
      phase: 0,
      rate: { num: 1, den: 4 },
    });
    expect(slot.shape).toBe(2);
    const def = slotToLfoDef({ ...slot, shape: 2 });
    expect(def?.shape).toBe("sine");
    expect(def?.depth).toBe(40);
  });

  it("maps cc decay target to LFO_DESTS decay index (not PARAM_NAMES index)", () => {
    const slot = lfoDefToSlot("cc:kick:decay", "kick", {
      shape: "triangle",
      depth: 10,
      phase: 0,
      rate: { num: 1, den: 1 },
    });
    expect(slot.dest).toBe(2);
  });

  it("applySlotField dest changes target key", () => {
    const slot = { ...newDefaultSlot("kick"), shape: 2, dest: 0 };
    const { slot: next, target } = applySlotField(slot, "kick", "dest", 1);
    expect(next.dest).toBe(1);
    expect(target).toBe("cc:kick:reso");
    expect(target).not.toBe(slot.target);
  });
});

describe("viewModel", () => {
  const base: DigitaktState = {
    current_pattern: Object.fromEntries(TRACK_NAMES.map((t) => [t, new Array(16).fill(0)])) as DigitaktState["current_pattern"],
    pattern_trig: emptyTrigState(16),
    bpm: 120,
    swing: 0,
    pattern_length: 16,
    fill_active: false,
    fill_queued: false,
    is_playing: true,
    midi_port_name: null,
    ccParams: [],
    track_cc: Object.fromEntries(TRACK_NAMES.map((t) => [t, {}])) as DigitaktState["track_cc"],
    track_muted: Object.fromEntries(TRACK_NAMES.map((t) => [t, false])) as DigitaktState["track_muted"],
    track_velocity: Object.fromEntries(TRACK_NAMES.map((t) => [t, 127])) as DigitaktState["track_velocity"],
    track_pitch: Object.fromEntries(TRACK_NAMES.map((t) => [t, 60])),
    step_cc: null,
    generation_status: "idle",
    generation_error: null,
    connected: true,
    midi_connected: false,
    log: [],
    current_step: 5,
    global_step: 4,
    last_prompt: null,
    pattern_history: [],
    chain: [],
    chain_index: -1,
    chain_auto: false,
    chain_queued_index: null,
    chain_armed: false,
    generation_summary: null,
    seq_mode: "standard",
    euclid: Object.fromEntries(TRACK_NAMES.map((t) => [t, { k: 0, n: 16, r: 0 }])),
    euclid_strip_mode: "grid",
    lfo: {},
    lfo_out: {},
  };

  it("builds 8 track rows", () => {
    const rows = buildTrackViews(base);
    expect(rows).toHaveLength(8);
    expect(rows[0]?.id).toBe("BD");
  });

  it("derives playhead from current_step", () => {
    expect(playheadFromState(base)).toBe(5);
    expect(playheadFromState({ ...base, is_playing: false, current_step: 3 })).toBe(0);
  });
});
