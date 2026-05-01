import { expect, test } from "bun:test";
import type { TrackName } from "./types.js";
import {
  applyEuclidDepthKey,
  canHandleEuclidTrigShortcut,
  getEuclidStepTrigExitState,
  getEuclidTrigShortcutRouting,
  getEuclidTrackStripRows,
  getPatternMuteIntent,
  shouldRoutePatternMuteKey,
  togglePendingMuteTrack,
  tracksToQueueAndClear,
} from "./euclidMuteUi.js";

test("Euclidean Enter/Esc moves track-strip -> active-ring -> trig and back", () => {
  expect(applyEuclidDepthKey({ depth: "track-strip", keyName: "enter", k: 0 })).toEqual({
    depth: "active-ring",
    consumed: true,
    openTrig: false,
    logNoPulsesHint: false,
  });

  expect(applyEuclidDepthKey({ depth: "active-ring", keyName: "enter", k: 3 })).toEqual({
    depth: "trig",
    consumed: true,
    openTrig: true,
    logNoPulsesHint: false,
  });

  expect(applyEuclidDepthKey({ depth: "trig", keyName: "escape", k: 3 })).toEqual({
    depth: "active-ring",
    consumed: true,
    openTrig: false,
    logNoPulsesHint: false,
  });

  expect(applyEuclidDepthKey({ depth: "active-ring", keyName: "escape", k: 3 })).toEqual({
    depth: "track-strip",
    consumed: true,
    openTrig: false,
    logNoPulsesHint: false,
  });
});

test("Tab does not traverse Euclidean horizontal depth", () => {
  expect(applyEuclidDepthKey({ depth: "track-strip", keyName: "tab", k: 3 })).toEqual({
    depth: "track-strip",
    consumed: false,
    openTrig: false,
    logNoPulsesHint: false,
  });

  expect(applyEuclidDepthKey({ depth: "active-ring", keyName: "tab", k: 3 })).toEqual({
    depth: "active-ring",
    consumed: false,
    openTrig: false,
    logNoPulsesHint: false,
  });
});

test("TRIG can open only from active ring and is blocked at k=0", () => {
  expect(canHandleEuclidTrigShortcut("track-strip")).toBe(false);
  expect(canHandleEuclidTrigShortcut("active-ring")).toBe(true);
  expect(canHandleEuclidTrigShortcut("trig")).toBe(false);

  expect(applyEuclidDepthKey({ depth: "active-ring", keyName: "enter", k: 0 })).toEqual({
    depth: "active-ring",
    consumed: true,
    openTrig: false,
    logNoPulsesHint: true,
  });
});

test("Euclidean t routing opens only from active ring but preserves TRIG toggles", () => {
  expect(
    getEuclidTrigShortcutRouting({
      depth: "track-strip",
      patternStepEdit: false,
    }),
  ).toBe("ignore");
  expect(
    getEuclidTrigShortcutRouting({
      depth: "track-strip",
      patternStepEdit: true,
    }),
  ).toBe("ignore");
  expect(
    getEuclidTrigShortcutRouting({
      depth: "active-ring",
      patternStepEdit: false,
    }),
  ).toBe("open-trig");
  expect(
    getEuclidTrigShortcutRouting({
      depth: "trig",
      patternStepEdit: true,
    }),
  ).toBe("toggle-trig-keys");
});

test("Euclidean step+TRIG exit returns to active ring editing", () => {
  expect(getEuclidStepTrigExitState()).toEqual({
    depth: "active-ring",
    editBox: 0,
  });
});

test("m/q/Shift+Q intents target the selected track in any pattern UI mode", () => {
  expect(getPatternMuteIntent("m", "snare", new Set())).toEqual({
    kind: "immediate",
    track: "snare",
  });

  expect(getPatternMuteIntent("q", "snare", new Set())).toEqual({
    kind: "toggle-pending",
    track: "snare",
  });

  expect(getPatternMuteIntent("Q", "snare", new Set<TrackName>(["kick", "snare"]))).toEqual({
    kind: "queue-all",
  });

  expect(getPatternMuteIntent("Q", "snare", new Set())).toEqual({ kind: "none" });
});

test("standard mode can use the same mute intent helper without changing behavior", () => {
  const pending = new Set<TrackName>(["kick"]);

  expect(getPatternMuteIntent("m", "clap", pending)).toEqual({
    kind: "immediate",
    track: "clap",
  });
  expect(getPatternMuteIntent("q", "clap", pending)).toEqual({
    kind: "toggle-pending",
    track: "clap",
  });
  expect(getPatternMuteIntent("Q", "clap", pending)).toEqual({ kind: "queue-all" });
});

test("App mute routing only handles plain pattern row mute keys", () => {
  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "pattern",
      ctrl: false,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(true);
  expect(
    shouldRoutePatternMuteKey({
      input: "q",
      focus: "pattern",
      ctrl: false,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(true);
  expect(
    shouldRoutePatternMuteKey({
      input: "Q",
      focus: "pattern",
      ctrl: false,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(true);

  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "prompt",
      ctrl: false,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(false);
  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "cc",
      ctrl: false,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(false);
  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "pattern",
      ctrl: true,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(false);
  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "pattern",
      ctrl: false,
      meta: true,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(false);
  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "pattern",
      ctrl: false,
      meta: false,
      patternStepEdit: true,
      trigKeysActive: false,
    }),
  ).toBe(false);
  expect(
    shouldRoutePatternMuteKey({
      input: "m",
      focus: "pattern",
      ctrl: false,
      meta: false,
      patternStepEdit: true,
      trigKeysActive: true,
    }),
  ).toBe(false);
  expect(
    shouldRoutePatternMuteKey({
      input: "n",
      focus: "pattern",
      ctrl: false,
      meta: false,
      patternStepEdit: false,
      trigKeysActive: false,
    }),
  ).toBe(false);
});

test("pending mute toggles selected track and Shift+Q snapshots staged tracks", () => {
  const original = new Set<TrackName>();
  const first = togglePendingMuteTrack(original, "hihat");
  expect(Array.from(first)).toEqual(["hihat"]);
  expect(Array.from(original)).toEqual([]);

  const second = togglePendingMuteTrack(first, "hihat");
  expect(Array.from(second)).toEqual([]);
  expect(Array.from(first)).toEqual(["hihat"]);

  const queued = tracksToQueueAndClear(new Set<TrackName>(["kick", "snare"]));
  expect(queued.tracks).toEqual(["kick", "snare"]);
  expect(queued.nextPending.size).toBe(0);
});

test("track strip rows include all 8 tracks and standard M/Q/MQ badge language", () => {
  const rows = getEuclidTrackStripRows({
    selectedTrack: 1,
    trackMuted: {
      kick: true,
      snare: true,
      tom: false,
      clap: false,
      bell: false,
      hihat: false,
      openhat: false,
      cymbal: false,
    },
    pendingMuteTracks: new Set<TrackName>(["snare", "tom"]),
  });

  expect(rows.map((row) => row.track)).toEqual([
    "kick",
    "snare",
    "tom",
    "clap",
    "bell",
    "hihat",
    "openhat",
    "cymbal",
  ]);
  expect(rows.map((row) => row.label)).toEqual(["BD", "SD", "LT", "CL", "BL", "CH", "OH", "CY"]);
  expect(rows.map((row) => row.badge)).toEqual(["M", "MQ", "Q", "", "", "", "", ""]);
  expect(rows[0]).toMatchObject({ cursor: " ", label: "BD", badge: "M" });
  expect(rows[1]).toMatchObject({ cursor: ">", label: "SD", badge: "MQ" });
  expect(rows[2]).toMatchObject({ cursor: " ", label: "LT", badge: "Q" });
});

test("EuclidGridPanel component is importable", async () => {
  const mod = await import("./components/EuclidGridPanel.js");
  expect(typeof mod.EuclidGridPanel).toBe("function");
});
