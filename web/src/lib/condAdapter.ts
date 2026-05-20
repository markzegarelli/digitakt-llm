import { TRIG_CONDITIONS } from "../design/constants.js";

const API_TO_INDEX: Record<string, number> = {
  "1:2": 1,
  "2:2": 2,
  "1:4": 3,
  "1:8": 4,
  "1:16": 5,
  fill: 6,
  "not:2": 9,
};

const INDEX_TO_API: Record<number, string | null> = {
  0: null,
  1: "1:2",
  2: "2:2",
  3: "1:4",
  4: "1:8",
  5: "1:16",
  6: "fill",
  7: null,
  8: null,
  9: "not:2",
  10: null,
};

export function condToIndex(raw: string | null | undefined): number {
  if (!raw) return 0;
  const key = raw.toLowerCase();
  return API_TO_INDEX[key] ?? 0;
}

export function indexToCond(index: number): string | null {
  return INDEX_TO_API[index] ?? null;
}

export function condLabel(index: number): string {
  return TRIG_CONDITIONS[index] ?? "—";
}
