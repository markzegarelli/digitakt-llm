import type { TrackName } from "../backend/types.js";
import { TRACK_NAMES } from "../backend/types.js";

export function togglePendingMuteTrack(
  pending: readonly TrackName[],
  track: TrackName,
): TrackName[] {
  const set = new Set(pending);
  if (set.has(track)) set.delete(track);
  else set.add(track);
  return TRACK_NAMES.filter((t) => set.has(t));
}

export type MuteBadge = "" | "M" | "Q" | "MQ";

export type MuteIndicator = {
  badge: MuteBadge;
  /** True when bar-sync mute is queued (Shift+Q) but not yet applied. */
  qArmed: boolean;
};

export function muteIndicator(
  muted: boolean,
  staged: boolean,
  armed: boolean,
): MuteIndicator {
  const showQ = staged || armed;
  if (muted && showQ) return { badge: "MQ", qArmed: armed };
  if (muted) return { badge: "M", qArmed: false };
  if (showQ) return { badge: "Q", qArmed: armed };
  return { badge: "", qArmed: false };
}

/** @deprecated use muteIndicator */
export function muteBadge(muted: boolean, pending: boolean): MuteBadge {
  return muteIndicator(muted, pending, false).badge;
}
