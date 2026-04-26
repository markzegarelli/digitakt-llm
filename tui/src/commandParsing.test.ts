import { describe, expect, test } from "bun:test";
import {
  getCommandSpec,
  isExactSlashCommandToken,
  isKnownSlashCommand,
  normalizeCcParamAlias,
  normalizeLfoTarget,
  normalizeTrackAlias,
  parseSlashDraft,
  parseChainCommand,
  validateTrackValueArity,
} from "./commandParsing.js";

describe("track-wide command arity", () => {
  test("accepts new two-arg form for prob/vel/gate", () => {
    expect(validateTrackValueArity("prob", ["prob", "kick", "80"])).toBeNull();
    expect(validateTrackValueArity("vel", ["vel", "snare", "96"])).toBeNull();
    expect(validateTrackValueArity("gate", ["gate", "hat", "50"])).toBeNull();
  });

  test("rejects legacy four-arg forms with migration guidance", () => {
    expect(validateTrackValueArity("prob", ["prob", "kick", "5", "80"])).toContain("/prob <track> <value>");
    expect(validateTrackValueArity("vel", ["vel", "snare", "8", "110"])).toContain("/vel <track> <value>");
    expect(validateTrackValueArity("gate", ["gate", "hat", "4", "70"])).toContain("/gate <track> <value>");
  });
});

describe("/chain parsing", () => {
  test("recognizes chain subcommands", () => {
    expect(parseChainCommand(["chain", "next"])).toEqual({ kind: "subcommand", subcommand: "next" });
    expect(parseChainCommand(["chain", "fire"])).toEqual({ kind: "subcommand", subcommand: "fire" });
    expect(parseChainCommand(["chain", "status"])).toEqual({ kind: "subcommand", subcommand: "status" });
    expect(parseChainCommand(["chain", "clear"])).toEqual({ kind: "subcommand", subcommand: "clear" });
  });

  test("rejects reserved chain set names", () => {
    const out = parseChainCommand(["chain", "intro", "next"]);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.message).toContain("reserved chain subcommand");
    }
  });
});

describe("removed commands are unknown", () => {
  test("legacy command verbs are not recognized", () => {
    expect(isKnownSlashCommand("prob-track")).toBe(false);
    expect(isKnownSlashCommand("chain-next")).toBe(false);
  });
});

describe("MIDI slash command", () => {
  test("recognizes midi", () => {
    expect(isKnownSlashCommand("midi")).toBe(true);
  });
});

describe("slash draft detection", () => {
  test("activates only when full command token is present", () => {
    expect(isExactSlashCommandToken("/lo")).toBe(false);
    expect(isExactSlashCommandToken("/lfo")).toBe(true);
    expect(isExactSlashCommandToken("/lfo ")).toBe(true);
    expect(isExactSlashCommandToken("/lfo target")).toBe(true);
  });

  test("parses command and args from draft text", () => {
    expect(parseSlashDraft("/random kick prob 20-90")).toEqual({
      command: "random",
      args: ["kick", "prob", "20-90"],
      hasTrailingSpace: false,
      isExactCommand: true,
    });
  });
});

describe("command specs", () => {
  test("provides parameter metadata for exact command hints", () => {
    expect(getCommandSpec("lfo")).toMatchObject({
      params: [
        { label: "target", required: true },
        { label: "shape", required: true, defaultValue: "sine" },
        { label: "depth", required: true },
        { label: "num/den", required: true },
        { label: "phase", required: false },
      ],
      formHint: "or <target> clear",
    });
  });
});

describe("lfo and cc alias normalization", () => {
  test("normalizes shorthand track aliases", () => {
    expect(normalizeTrackAlias("sd")).toBe("snare");
    expect(normalizeTrackAlias("ch")).toBe("hihat");
    expect(normalizeTrackAlias("oh")).toBe("openhat");
  });

  test("normalizes shorthand cc param aliases", () => {
    expect(normalizeCcParamAlias("res")).toBe("resonance");
    expect(normalizeCcParamAlias("vol")).toBe("volume");
    expect(normalizeCcParamAlias("dly")).toBe("delay");
  });

  test("normalizes lfo target aliases end-to-end", () => {
    expect(normalizeLfoTarget("cc:sd:res")).toBe("cc:snare:resonance");
    expect(normalizeLfoTarget("trig:ch:vel")).toBe("trig:hihat:vel");
    expect(normalizeLfoTarget("pitch:oh:main")).toBe("pitch:openhat:main");
    expect(normalizeLfoTarget("cc:snare:filter")).toBe("cc:snare:filter");
  });
});
