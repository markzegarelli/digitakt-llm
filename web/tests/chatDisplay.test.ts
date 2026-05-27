import { describe, it, expect } from "vitest";
import { formatGenerationReply } from "../src/lib/chatDisplay.js";

describe("formatGenerationReply", () => {
  it("includes parsed response metadata and producer notes", () => {
    const text = formatGenerationReply({
      prompt: "techno",
      track_summary: "BDx4  CHx8",
      latency_ms: 1200,
      producer_notes: "Try a sub-bass on /2.",
      parsed_response: "BPM 140 · swing 25\n\nTry a sub-bass on /2.",
    });
    expect(text).toContain("Pattern: BDx4  CHx8 · 1200ms");
    expect(text).toContain("BPM 140");
    expect(text).toContain("Try a sub-bass on /2.");
  });

  it("shows track summary when producer notes are absent", () => {
    const text = formatGenerationReply({
      prompt: "hats",
      track_summary: "CHx16",
      latency_ms: 800,
    });
    expect(text).toBe("Pattern: CHx16 · 800ms");
  });

  it("shows producer notes with latency when track summary is empty", () => {
    const text = formatGenerationReply({
      prompt: "ambient",
      track_summary: "empty",
      latency_ms: 900,
      producer_notes: "Layer a pad in Lydian.",
    });
    expect(text).toBe("Generated in 900ms\n\nLayer a pad in Lydian.");
  });

  it("falls back when nothing is available", () => {
    const text = formatGenerationReply({
      prompt: "x",
      track_summary: "empty",
      latency_ms: 0,
    });
    expect(text).toBe("Pattern ready.");
  });
});
