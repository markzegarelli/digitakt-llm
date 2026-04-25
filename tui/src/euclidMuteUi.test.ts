import { expect, test } from "bun:test";
import type { TrackName } from "./types.js";
import {
  applyEuclidDepthKey,
  canHandleEuclidTrigShortcut,
  getEuclidTrackStripRows,
  getPatternMuteIntent,
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

  expect(applyEuclidDepthKey({ depth: "active-ring", keyName: "enter", k: 0 })).toEqual({
    depth: "active-ring",
    consumed: true,
    openTrig: false,
    logNoPulsesHint: true,
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

test("pending mute toggles selected track and Shift+Q snapshots staged tracks", () => {
  const first = togglePendingMuteTrack(new Set<TrackName>(), "hihat");
  expect(Array.from(first)).toEqual(["hihat"]);

  const second = togglePendingMuteTrack(first, "hihat");
  expect(Array.from(second)).toEqual([]);

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
  expect(rows[0]).toMatchObject({ cursor: " ", label: "BD", badge: "M" });
  expect(rows[1]).toMatchObject({ cursor: ">", label: "SD", badge: "MQ" });
  expect(rows[2]).toMatchObject({ cursor: " ", label: "LT", badge: "Q" });
});
