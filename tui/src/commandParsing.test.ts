import { describe, expect, test } from "bun:test";
import {
  isKnownSlashCommand,
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
