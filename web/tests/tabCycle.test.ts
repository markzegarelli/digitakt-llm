import { describe, it, expect } from "vitest";
import { nextTabMode } from "../src/lib/tabCycle.js";

describe("nextTabMode", () => {
  it("cycles CHAT forward to SEQ", () => {
    expect(nextTabMode("CHAT", "TRIG", false)).toBe("SEQ");
  });

  it("cycles CHAT backward to last workbench", () => {
    expect(nextTabMode("CHAT", "MIX", true)).toBe("MIX");
  });

  it("cycles SEQ forward to workbench", () => {
    expect(nextTabMode("SEQ", "LFO", false)).toBe("LFO");
  });

  it("cycles workbench forward to CHAT", () => {
    expect(nextTabMode("TRIG", "TRIG", false)).toBe("CHAT");
  });
});
