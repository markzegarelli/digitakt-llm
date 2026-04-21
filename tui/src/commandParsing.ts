export const CHAIN_SUBCOMMANDS = ["next", "fire", "status", "clear"] as const;
type ChainSubcommand = (typeof CHAIN_SUBCOMMANDS)[number];

const KNOWN_SLASH_COMMANDS = new Set([
  "play", "stop", "new", "undo", "randbeat", "fresh", "bpm", "swing", "length",
  "prob", "vel", "gate", "pitch", "cc", "cc-step", "cond", "random", "mute",
  "save", "load", "delete", "fill", "chain", "patterns", "quit", "q", "help", "log",
  "clear", "history", "mode", "gen", "ask", "midi",
]);

export type ParsedChainCommand =
  | { kind: "subcommand"; subcommand: ChainSubcommand }
  | { kind: "set"; names: string[]; autoFlag: boolean }
  | { kind: "error"; message: string };

export function validateTrackValueArity(verb: string, parts: string[]): string | null {
  if (!["prob", "vel", "gate"].includes(verb)) return null;
  if (parts.length === 3) return null;
  return `Usage: /${verb} <track> <value> (per-step editing moved to TRIG panel).`;
}

export function parseChainCommand(parts: string[]): ParsedChainCommand {
  const sub = parts[1]?.toLowerCase();
  if (sub && CHAIN_SUBCOMMANDS.includes(sub as ChainSubcommand)) {
    return { kind: "subcommand", subcommand: sub as ChainSubcommand };
  }

  const autoFlag = parts.includes("--auto");
  const names = parts.slice(1).filter((p) => p !== "--auto");
  if (names.length === 0) {
    return {
      kind: "error",
      message: "usage: /chain <p1> <p2> ... [--auto]  or  /chain <next|fire|status|clear>",
    };
  }

  const reserved = names.filter((n) => CHAIN_SUBCOMMANDS.includes(n.toLowerCase() as ChainSubcommand));
  if (reserved.length > 0) {
    return {
      kind: "error",
      message: `✗ "${reserved.join('", "')}" is a reserved chain subcommand — rename the pattern`,
    };
  }

  return { kind: "set", names, autoFlag };
}

export function isKnownSlashCommand(verb: string): boolean {
  return KNOWN_SLASH_COMMANDS.has(verb);
}
