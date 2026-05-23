import { describe, expect, it } from "vitest";
import {
  applyLfoDepth,
  lfoOutputAtGlobalStep,
  lfoShape,
  lfoWAtGlobalStep,
} from "../src/lib/lfoDisplay.js";

describe("lfoWAtGlobalStep", () => {
  it("matches four-step sine at integer steps", () => {
    const n = 4;
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 0],
      [3, -1],
    ];
    for (const [step, expected] of cases) {
      expect(lfoWAtGlobalStep("sine", n, 1, 1, 0, step)).toBeCloseTo(expected, 9);
    }
  });

  it("respects phase shift", () => {
    const n = 4;
    const w0 = lfoWAtGlobalStep("ramp", n, 1, 1, 0, 0);
    const wShift = lfoWAtGlobalStep("ramp", n, 1, 1, 0.25, 0);
    expect(w0).toBeCloseTo(-1, 9);
    expect(wShift).toBeCloseTo(lfoShape("ramp", 0.25), 9);
  });
});

describe("applyLfoDepth", () => {
  it("sweeps to hi at w=+1 full depth", () => {
    expect(applyLfoDepth(64, 1, 100, 0, 127)).toBe(127);
  });

  it("returns base at w=0", () => {
    expect(applyLfoDepth(64, 0, 100, 0, 127)).toBe(64);
  });

  it("sweeps to lo at w=-1 full depth", () => {
    expect(applyLfoDepth(64, -1, 100, 0, 127)).toBe(0);
  });

  it("ignores w at zero depth", () => {
    expect(applyLfoDepth(0, 1, 0, 0, 127)).toBe(0);
    expect(applyLfoDepth(100, -1, 0, 0, 127)).toBe(100);
  });

  it("clamps to narrow range", () => {
    expect(applyLfoDepth(5, 1, 100, 0, 10)).toBe(10);
    expect(applyLfoDepth(5, -1, 100, 0, 10)).toBe(0);
  });
});

describe("lfoOutputAtGlobalStep", () => {
  const track = {
    mix: { filter: 64 },
    trigs: [{ note: 60 }],
  };

  it("modulates CC base end-to-end", () => {
    const { w, value } = lfoOutputAtGlobalStep({
      shape: "sine",
      patternLength: 4,
      num: 1,
      den: 1,
      phase: 0,
      depth: 100,
      globalStep: 1,
      dest: "filter",
      track,
      playhead: 0,
    });
    expect(w).toBeCloseTo(1, 9);
    expect(value).toBe(127);
  });
});
