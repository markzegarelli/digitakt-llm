import { test, expect } from "bun:test";
import { inferPatternLengthFromApi } from "./types.js";

test("inferPatternLength prefers explicit pattern_length", () => {
  expect(
    inferPatternLengthFromApi(
      { pattern_length: 32, kick: new Array(16).fill(0) } as Record<string, unknown>,
      16,
    ),
  ).toBe(32);
});

test("inferPatternLength from longest track row", () => {
  const raw = {
    kick: new Array(24).fill(0),
    snare: new Array(8).fill(0),
  } as Record<string, unknown>;
  expect(inferPatternLengthFromApi(raw, 16)).toBe(24);
});

test("inferPatternLength falls back when empty", () => {
  expect(inferPatternLengthFromApi({} as Record<string, unknown>, 16)).toBe(16);
});
