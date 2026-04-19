import { expect, test } from "bun:test";
import {
  canFieldUseTrackWide,
  shouldClearNoteOverrideOnCommit,
  shouldClearNoteOverrideOnDelete,
} from "./trigEditing.js";

test("track-wide mode is only supported for prob, vel, and gate rows", () => {
  expect(canFieldUseTrackWide(0)).toBe(true); // prob
  expect(canFieldUseTrackWide(1)).toBe(true); // vel
  expect(canFieldUseTrackWide(3)).toBe(true); // gate
  expect(canFieldUseTrackWide(2)).toBe(false); // note
  expect(canFieldUseTrackWide(4)).toBe(false); // cond
});

test("empty commit on note row clears note override", () => {
  expect(shouldClearNoteOverrideOnCommit(2, "")).toBe(true);
  expect(shouldClearNoteOverrideOnCommit(2, " ")).toBe(true);
  expect(shouldClearNoteOverrideOnCommit(2, "64")).toBe(false);
  expect(shouldClearNoteOverrideOnCommit(1, "")).toBe(false);
});

test("delete on note row clears only when input buffer is empty", () => {
  expect(shouldClearNoteOverrideOnDelete(2, "")).toBe(true);
  expect(shouldClearNoteOverrideOnDelete(2, "7")).toBe(false);
  expect(shouldClearNoteOverrideOnDelete(0, "")).toBe(false);
});
