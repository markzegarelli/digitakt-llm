import type { TrackName } from "./types.js";
import { TRACK_NAMES } from "./types.js";

const TRACK_LABELS: Record<TrackName, string> = {
  kick: "BD",
  snare: "SD",
  tom: "LT",
  clap: "CL",
  bell: "BL",
  hihat: "CH",
  openhat: "OH",
  cymbal: "CY",
};

export type EuclidDepth = "track-strip" | "active-ring" | "trig";
export type EuclidDepthKey = "enter" | "escape" | "tab";

export interface EuclidDepthKeyInput {
  depth: EuclidDepth;
  keyName: EuclidDepthKey;
  k: number;
}

export interface EuclidDepthKeyResult {
  depth: EuclidDepth;
  consumed: boolean;
  openTrig: boolean;
  logNoPulsesHint: boolean;
}

export function getEuclidStepTrigExitState(): { depth: EuclidDepth; editBox: 0 } {
  return { depth: "active-ring", editBox: 0 };
}

export function canHandleEuclidTrigShortcut(depth: EuclidDepth): boolean {
  return depth === "active-ring";
}

export type EuclidTrigShortcutRouting = "ignore" | "open-trig" | "toggle-trig-keys";

export function getEuclidTrigShortcutRouting({
  depth,
  patternStepEdit,
}: {
  depth: EuclidDepth;
  patternStepEdit: boolean;
}): EuclidTrigShortcutRouting {
  if (patternStepEdit && depth === "trig") return "toggle-trig-keys";
  if (!patternStepEdit && canHandleEuclidTrigShortcut(depth)) return "open-trig";
  return "ignore";
}

export function applyEuclidDepthKey({
  depth,
  keyName,
  k,
}: EuclidDepthKeyInput): EuclidDepthKeyResult {
  if (keyName === "tab") {
    return { depth, consumed: false, openTrig: false, logNoPulsesHint: false };
  }

  if (keyName === "enter") {
    if (depth === "track-strip") {
      return { depth: "active-ring", consumed: true, openTrig: false, logNoPulsesHint: false };
    }
    if (depth === "active-ring") {
      if (k <= 0) {
        return { depth: "active-ring", consumed: true, openTrig: false, logNoPulsesHint: true };
      }
      return { depth: "trig", consumed: true, openTrig: true, logNoPulsesHint: false };
    }
    return { depth: "trig", consumed: false, openTrig: false, logNoPulsesHint: false };
  }

  if (depth === "trig") {
    return { depth: "active-ring", consumed: true, openTrig: false, logNoPulsesHint: false };
  }
  if (depth === "active-ring") {
    return { depth: "track-strip", consumed: true, openTrig: false, logNoPulsesHint: false };
  }
  return { depth: "track-strip", consumed: false, openTrig: false, logNoPulsesHint: false };
}

export type PatternMuteIntent =
  | { kind: "immediate"; track: TrackName }
  | { kind: "toggle-pending"; track: TrackName }
  | { kind: "queue-all" }
  | { kind: "none" };

export interface EuclidTrackStripRow {
  track: TrackName;
  cursor: ">" | " ";
  label: string;
  badge: "" | "M" | "Q" | "MQ";
}

export type PatternMuteRouteFocus = "pattern" | "cc" | "lfo" | "prompt";

export function shouldRoutePatternMuteKey({
  input,
  focus,
  ctrl,
  meta,
  patternStepEdit,
  trigKeysActive,
}: {
  input: string;
  focus: PatternMuteRouteFocus;
  ctrl: boolean | undefined;
  meta: boolean | undefined;
  patternStepEdit: boolean;
  trigKeysActive: boolean;
}): boolean {
  return (
    focus === "pattern" &&
    !ctrl &&
    !meta &&
    !patternStepEdit &&
    !trigKeysActive &&
    (input === "m" || input === "q" || input === "Q")
  );
}

export function getPatternMuteIntent(
  input: string,
  selectedTrack: TrackName,
  pendingMuteTracks: Set<TrackName>,
): PatternMuteIntent {
  if (input === "m") return { kind: "immediate", track: selectedTrack };
  if (input === "q") return { kind: "toggle-pending", track: selectedTrack };
  if (input === "Q" && pendingMuteTracks.size > 0) return { kind: "queue-all" };
  return { kind: "none" };
}

export function togglePendingMuteTrack(
  pendingMuteTracks: Set<TrackName>,
  track: TrackName,
): Set<TrackName> {
  const next = new Set(pendingMuteTracks);
  if (next.has(track)) next.delete(track);
  else next.add(track);
  return next;
}

export function tracksToQueueAndClear(
  pendingMuteTracks: Set<TrackName>,
): { tracks: TrackName[]; nextPending: Set<TrackName> } {
  return {
    tracks: Array.from(pendingMuteTracks),
    nextPending: new Set<TrackName>(),
  };
}

function muteBadge(muted: boolean, pending: boolean): "" | "M" | "Q" | "MQ" {
  if (muted && pending) return "MQ";
  if (muted) return "M";
  if (pending) return "Q";
  return "";
}

export function getEuclidTrackStripRows({
  selectedTrack,
  trackMuted,
  pendingMuteTracks,
}: {
  selectedTrack: number;
  trackMuted: Record<TrackName, boolean>;
  pendingMuteTracks: Set<TrackName>;
}): EuclidTrackStripRow[] {
  return TRACK_NAMES.map((track, index) => ({
    track,
    cursor: index === selectedTrack ? ">" : " ",
    label: TRACK_LABELS[track],
    badge: muteBadge(trackMuted[track] ?? false, pendingMuteTracks.has(track)),
  }));
}
