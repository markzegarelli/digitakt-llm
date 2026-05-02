export const CHAIN_SUBCOMMANDS = ["next", "fire", "status", "clear"] as const;
type ChainSubcommand = (typeof CHAIN_SUBCOMMANDS)[number];

export type CommandParamSpec = {
  label: string;
  required: boolean;
  defaultValue?: string;
  suggestions?: string[];
};

export type CommandSpec = {
  params: CommandParamSpec[];
  formHint?: string;
};

const KNOWN_SLASH_COMMANDS = new Set([
  "play", "stop", "new", "undo", "randbeat", "fresh", "bpm", "swing", "length",
  "prob", "vel", "gate", "pitch", "cc", "cc-step", "cond", "random", "mute",
  "save", "load", "delete", "fill", "chain", "patterns", "quit", "q", "help", "log",
  "clear", "history", "mode", "euclid-strip", "gen", "ask", "midi", "lfo",
]);

const COMMAND_SPECS: Record<string, CommandSpec> = {
  ask: { params: [{ label: "question", required: true }] },
  bpm: { params: [{ label: "n", required: true, defaultValue: "128", suggestions: ["120", "128", "135", "140"] }] },
  cc: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "param", required: true, suggestions: ["filter_cutoff", "filter_res", "delay_send", "reverb_send"] },
      { label: "value", required: true, defaultValue: "64", suggestions: ["0", "32", "64", "96", "127"] },
    ],
  },
  "cc-step": { params: [{ label: "track", required: true }, { label: "param", required: true }, { label: "step", required: true }, { label: "value|-1", required: true }] },
  chain: {
    params: [{ label: "p1", required: true }, { label: "p2", required: false }, { label: "--auto", required: false }],
    formHint: "or next|fire|status|clear",
  },
  clear: { params: [] },
  cond: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "step", required: true, defaultValue: "1", suggestions: ["1", "5", "9", "13"] },
      { label: "1:2|not:2|fill|clear", required: true, suggestions: ["1:2", "not:2", "fill", "clear"] },
    ],
  },
  delete: { params: [{ label: "name", required: false }] },
  "euclid-strip": {
    params: [{ label: "grid|fractional", required: false, suggestions: ["grid", "fractional"] }],
    formHint: "bare = toggle (Euclidean only)",
  },
  fill: { params: [{ label: "name", required: true }] },
  fresh: { params: [{ label: "prompt", required: true }] },
  gate: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "0-100", required: true, defaultValue: "50", suggestions: ["25", "50", "75", "100"] },
    ],
  },
  gen: { params: [] },
  help: { params: [] },
  history: { params: [] },
  length: { params: [{ label: "8|16|32", required: true, defaultValue: "16", suggestions: ["8", "16", "32"] }] },
  lfo: {
    params: [
      { label: "target", required: true, suggestions: ["cc:kick:filter", "cc:snare:resonance", "trig:hihat:vel", "pitch:kick:main"] },
      { label: "shape", required: true, defaultValue: "sine", suggestions: ["sine", "square", "triangle", "ramp", "saw"] },
      { label: "depth", required: true, defaultValue: "25", suggestions: ["10", "25", "50", "75", "100"] },
      { label: "num/den", required: true, defaultValue: "1/4", suggestions: ["1/2", "1/4", "1/8", "3/8"] },
      { label: "phase", required: false, defaultValue: "0", suggestions: ["0", "0.25", "0.5", "0.75", "1"] },
    ],
    formHint: "or <target> clear",
  },
  load: { params: [{ label: "name", required: false }] },
  log: { params: [] },
  midi: { params: [{ label: "list", required: false }] },
  mode: { params: [{ label: "chat|beat|standard|euclidean", required: true, defaultValue: "beat", suggestions: ["beat", "chat", "standard", "euclidean"] }] },
  mute: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "on|off|toggle", required: false, defaultValue: "toggle", suggestions: ["toggle", "on", "off"] },
    ],
  },
  new: { params: [] },
  patterns: { params: [{ label: "#tag", required: false }] },
  pitch: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "0-127", required: true, defaultValue: "60", suggestions: ["36", "48", "60", "72", "84"] },
    ],
  },
  play: { params: [] },
  prob: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "value", required: true, defaultValue: "100", suggestions: ["25", "50", "75", "100"] },
    ],
  },
  q: { params: [] },
  quit: { params: [] },
  random: {
    params: [
      { label: "track|all", required: true, defaultValue: "all", suggestions: ["all", "kick", "snare", "hat"] },
      { label: "vel|prob", required: true, defaultValue: "vel", suggestions: ["vel", "prob"] },
      { label: "lo-hi", required: false, defaultValue: "0-127", suggestions: ["0-127", "40-100", "70-127", "0-100"] },
    ],
  },
  randbeat: { params: [] },
  save: { params: [{ label: "name", required: true }, { label: "#tag1", required: false }, { label: "#tag2", required: false }] },
  stop: { params: [] },
  swing: { params: [{ label: "n", required: true, defaultValue: "54", suggestions: ["50", "54", "58", "62"] }] },
  undo: { params: [] },
  vel: {
    params: [
      { label: "track", required: true, suggestions: ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "cymbal"] },
      { label: "value", required: true, defaultValue: "100", suggestions: ["64", "90", "100", "110", "127"] },
    ],
  },
};

export type SlashDraftState = {
  command: string | null;
  args: string[];
  hasTrailingSpace: boolean;
  isExactCommand: boolean;
};

const TRACK_ALIASES: Record<string, string> = {
  bd: "kick",
  sd: "snare",
  lt: "tom",
  cp: "clap",
  bl: "bell",
  ch: "hihat",
  hh: "hihat",
  oh: "openhat",
  cy: "cymbal",
  ophat: "openhat",
  cymbl: "cymbal",
};

const CC_PARAM_ALIASES: Record<string, string> = {
  fil: "filter",
  filterfreq: "filter",
  filtercutoff: "filter",
  res: "resonance",
  resonanceq: "resonance",
  att: "attack",
  atk: "attack",
  dec: "decay",
  rel: "decay",
  sus: "hold",
  vol: "volume",
  lvl: "volume",
  rev: "reverb",
  dly: "delay",
};

export function parseSlashDraft(text: string): SlashDraftState {
  if (!text.startsWith("/")) {
    return { command: null, args: [], hasTrailingSpace: false, isExactCommand: false };
  }
  const raw = text.slice(1);
  const hasTrailingSpace = /\s$/.test(raw);
  const tokens = raw.trim().length > 0 ? raw.trim().split(/\s+/) : [];
  const command = tokens[0]?.toLowerCase() ?? null;
  const args = tokens.slice(1);
  const isExactCommand = command !== null && isKnownSlashCommand(command);
  return { command, args, hasTrailingSpace, isExactCommand };
}

export function normalizeTrackAlias(raw: string): string {
  const key = raw.toLowerCase();
  return TRACK_ALIASES[key] ?? key;
}

export function normalizeCcParamAlias(raw: string): string {
  const key = raw.toLowerCase();
  return CC_PARAM_ALIASES[key] ?? key;
}

export function normalizeLfoTarget(raw: string): string {
  const parts = raw.split(":");
  if (parts.length !== 3) return raw.toLowerCase();
  const kind = parts[0]!.toLowerCase();
  const track = normalizeTrackAlias(parts[1]!);
  const restRaw = parts[2]!;
  const rest =
    kind === "cc" ? normalizeCcParamAlias(restRaw) : restRaw.toLowerCase();
  return `${kind}:${track}:${rest}`;
}

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

export function getCommandSpec(command: string): CommandSpec | null {
  return COMMAND_SPECS[command] ?? null;
}

export function isExactSlashCommandToken(text: string): boolean {
  return parseSlashDraft(text).isExactCommand;
}
