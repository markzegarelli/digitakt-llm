export const CHAIN_SUBCOMMANDS = ["next", "fire", "status", "clear"] as const;
type ChainSubcommand = (typeof CHAIN_SUBCOMMANDS)[number];

const TRACK_ALIASES: Record<string, string> = {
  bd: "kick", sd: "snare", lt: "tom", cp: "clap", bl: "bell",
  ch: "hihat", hh: "hihat", oh: "openhat", cy: "cymbal",
  ophat: "openhat", cymbl: "cymbal",
};

const CC_PARAM_ALIASES: Record<string, string> = {
  fil: "filter", filterfreq: "filter", filtercutoff: "filter",
  res: "resonance", reso: "resonance", resonanceq: "resonance",
  att: "attack", atk: "attack", dec: "decay", rel: "decay",
  sus: "hold", vol: "volume", lvl: "volume", rev: "reverb", dly: "delay",
};

export function normalizeTrackAlias(raw: string): string {
  return TRACK_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
}

export function normalizeCcParamAlias(raw: string): string {
  return CC_PARAM_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
}

export function normalizeLfoTarget(raw: string): string {
  const parts = raw.split(":");
  if (parts.length !== 3) return raw.toLowerCase();
  const kind = parts[0]!.toLowerCase();
  const track = normalizeTrackAlias(parts[1]!);
  const restRaw = parts[2]!;
  const rest = kind === "cc" ? normalizeCcParamAlias(restRaw) : restRaw.toLowerCase();
  return `${kind}:${track}:${rest}`;
}

export type ParsedChainCommand =
  | { kind: "subcommand"; subcommand: ChainSubcommand }
  | { kind: "fill_slot"; slot: number }
  | { kind: "set"; names: string[]; autoFlag: boolean }
  | { kind: "error"; message: string };

export function validateTrackValueArity(verb: string, parts: string[]): string | null {
  if (!["prob", "vel", "gate"].includes(verb)) return null;
  if (parts.length === 3) return null;
  return `Usage: /${verb} <track> <value>`;
}

export function parseChainCommand(parts: string[]): ParsedChainCommand {
  const sub = parts[1]?.toLowerCase();
  if (sub === "fill") {
    const slot = parseInt(parts[2] ?? "", 10);
    if (!Number.isFinite(slot) || slot < 1) {
      return { kind: "error", message: "usage: /chain fill <slot>" };
    }
    return { kind: "fill_slot", slot };
  }
  if (sub && CHAIN_SUBCOMMANDS.includes(sub as ChainSubcommand)) {
    return { kind: "subcommand", subcommand: sub as ChainSubcommand };
  }
  const autoFlag = parts.includes("--auto");
  const names = parts.slice(1).filter((p) => p !== "--auto");
  if (names.length === 0) {
    return { kind: "error", message: "usage: /chain <p1> <p2> ..." };
  }
  return { kind: "set", names, autoFlag };
}
