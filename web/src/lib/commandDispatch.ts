import type { BackendClient } from "../backend/client.js";
import type { DigitaktActions } from "../hooks/useDigitakt.js";
import type { TrackName } from "../backend/types.js";
import {
  normalizeTrackAlias,
  normalizeCcParamAlias,
  normalizeLfoTarget,
  validateTrackValueArity,
  parseChainCommand,
} from "./slashParsing.js";

export interface CommandContext {
  actions: DigitaktActions;
  client: BackendClient;
  addLog: (msg: string) => void;
  onHelp?: () => void;
  onLoadPattern?: (name: string) => void;
  listPatterns?: () => Promise<Array<{ name: string }>>;
}

function trackFromNum(n: string): TrackName | null {
  const i = parseInt(n, 10) - 1;
  const names: TrackName[] = [
    "kick", "snare", "tom", "clap", "bell", "hihat", "openhat", "cymbal",
  ];
  return i >= 0 && i < 8 ? names[i]! : null;
}

export async function dispatchCommand(raw: string, ctx: CommandContext): Promise<boolean> {
  const stripped = raw.replace(/^[:/]/, "").trim();
  if (!stripped) return false;
  const parts = stripped.split(/\s+/);
  const verb = parts[0]?.toLowerCase();
  const err = (m: string) => ctx.addLog(`✗ ${m}`);

  switch (verb) {
    case "help":
      ctx.onHelp?.();
      return true;
    case "play":
      ctx.actions.play();
      return true;
    case "stop":
      ctx.actions.stop();
      return true;
    case "new":
      ctx.actions.callNew();
      return true;
    case "undo":
      ctx.actions.callUndo();
      return true;
    case "randbeat":
      ctx.actions.randbeat();
      return true;
    case "bpm": {
      const v = parseFloat(parts[1] ?? "");
      if (Number.isFinite(v)) ctx.actions.setBpm(v);
      else err("Usage: bpm <20-400>");
      return true;
    }
    case "swing": {
      const v = parseInt(parts[1] ?? "", 10);
      if (Number.isFinite(v)) ctx.actions.setSwing(v);
      else err("Usage: swing <0-100>");
      return true;
    }
    case "length": {
      const steps = parseInt(parts[1] ?? "", 10);
      if ([8, 16, 32].includes(steps)) {
        await ctx.client.post("/length", { steps });
      } else err("Usage: length 8|16|32");
      return true;
    }
    case "mute": {
      const t = trackFromNum(parts[1] ?? "") ?? (normalizeTrackAlias(parts[1] ?? "") as TrackName);
      if (t) ctx.actions.muteQueued(t, true);
      else err("Usage: mute <1-8|track>");
      return true;
    }
    case "save": {
      const name = parts[1];
      if (!name) { err("Usage: save <name>"); return true; }
      const tags = parts.slice(2).filter((p) => p.startsWith("#"));
      await ctx.client.post(`/patterns/${encodeURIComponent(name)}`, { tags });
      ctx.addLog(`Saved ${name}`);
      return true;
    }
    case "load": {
      const name = parts[1];
      if (name) {
        await ctx.client.post(`/patterns/${encodeURIComponent(name)}`);
        ctx.onLoadPattern?.(name);
      } else {
        const list = (await ctx.client.get("/patterns")) as { patterns?: Array<{ name: string }> };
        const names = list.patterns?.map((p) => p.name).join(", ") ?? "none";
        ctx.addLog(`Patterns: ${names}`);
      }
      return true;
    }
    case "patterns": {
      const list = (await ctx.client.get("/patterns")) as { patterns?: Array<{ name: string }> };
      const names = list.patterns?.map((p) => p.name).join(", ") ?? "none";
      ctx.addLog(`Patterns: ${names}`);
      return true;
    }
    case "fresh": {
      const prompt = parts.slice(1).join(" ");
      if (prompt) ctx.actions.generate(prompt, false);
      else err("Usage: fresh <prompt>");
      return true;
    }
    case "ask": {
      const q = parts.slice(1).join(" ");
      if (q) {
        const { answer } = await ctx.actions.ask(q);
        ctx.addLog(answer);
      }
      return true;
    }
    case "prob": {
      const arity = validateTrackValueArity("prob", parts);
      if (arity) { err(arity); return true; }
      ctx.actions.setProbTrack(normalizeTrackAlias(parts[1]!) as TrackName, parseInt(parts[2]!, 10));
      return true;
    }
    case "vel": {
      const arity = validateTrackValueArity("vel", parts);
      if (arity) { err(arity); return true; }
      ctx.actions.setVelTrack(normalizeTrackAlias(parts[1]!) as TrackName, parseInt(parts[2]!, 10));
      return true;
    }
    case "gate": {
      const arity = validateTrackValueArity("gate", parts);
      if (arity) { err(arity); return true; }
      ctx.actions.setGateTrack(normalizeTrackAlias(parts[1]!) as TrackName, parseInt(parts[2]!, 10));
      return true;
    }
    case "pitch":
      ctx.actions.setPitch(normalizeTrackAlias(parts[1]!) as TrackName, parseInt(parts[2]!, 10));
      return true;
    case "cc":
      ctx.actions.setCC(
        normalizeTrackAlias(parts[1]!) as TrackName,
        normalizeCcParamAlias(parts[2]!),
        parseInt(parts[3]!, 10),
      );
      return true;
    case "lfo": {
      const target = normalizeLfoTarget(parts[1] ?? "");
      if (!target) { err("Usage: lfo <target> ..."); return true; }
      if (parts[2]?.toLowerCase() === "clear") {
        ctx.actions.setLfoRoute(target, null);
        return true;
      }
      const shape = parts[2] ?? "";
      const depth = parseInt(parts[3] ?? "", 10);
      const rateS = parts[4] ?? "";
      const m = rateS.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!["sine", "square", "triangle", "ramp", "saw"].includes(shape) || !m) {
        err("Usage: lfo <target> <shape> <depth> <num/den>");
        return true;
      }
      ctx.actions.setLfoRoute(target, {
        shape: shape as "sine",
        depth,
        phase: parseFloat(parts[5] ?? "0") || 0,
        rate: { num: parseInt(m[1]!, 10), den: parseInt(m[2]!, 10) },
      });
      return true;
    }
    case "chain": {
      const parsed = parseChainCommand(parts);
      if (parsed.kind === "error") { err(parsed.message); return true; }
      if (parsed.kind === "set") ctx.actions.setChain(parsed.names, parsed.autoFlag);
      else if (parsed.kind === "subcommand") {
        if (parsed.subcommand === "next") ctx.actions.chainNext();
        else if (parsed.subcommand === "fire") ctx.actions.chainFire();
        else if (parsed.subcommand === "clear") ctx.actions.chainClear();
      } else if (parsed.kind === "fill_slot") ctx.actions.chainSlotFill(parsed.slot);
      return true;
    }
    case "fill":
      if (parts[1]) ctx.actions.queueFill(parts[1]);
      return true;
    case "random":
      ctx.actions.randomize(
        parts[1] ?? "all",
        parts[2] ?? "vel",
        parseInt((parts[3] ?? "0-127").split("-")[0]!, 10),
        parseInt((parts[3] ?? "0-127").split("-")[1]!, 10),
      );
      return true;
    default:
      err(`Unknown command: ${verb}`);
      return false;
  }
}

/** Zip-style CMD palette parser */
export interface ParsedCmd {
  mode: "name" | "param";
  prefix?: string;
  tokens: string[];
  matches?: import("../design/constants.js").CmdSpec[];
  cmd?: import("../design/constants.js").CmdSpec;
  paramIdx?: number;
  param?: import("../design/constants.js").CmdParamSpec;
  endsInSpace?: boolean;
  suggestions?: string[];
}

export function parseCmd(raw: string, commands: import("../design/constants.js").CmdSpec[]): ParsedCmd {
  const stripped = raw.replace(/^:/, "");
  const endsInSpace = /\s$/.test(stripped);
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const cmdName = (tokens[0] || "").toLowerCase();
  const cmd = commands.find((c) => c.name === cmdName);

  if (!cmd || (tokens.length === 1 && !endsInSpace)) {
    const prefix = (tokens[0] || "").toLowerCase();
    const matches = commands.filter((c) => c.name.startsWith(prefix));
    return { mode: "name", prefix, tokens, matches };
  }
  const enteredParamCount = tokens.length - 1;
  const paramIdx = endsInSpace ? enteredParamCount : Math.max(0, enteredParamCount - 1);
  const param = cmd.params && cmd.params[paramIdx];
  let suggestions: string[] = [];
  if (param && param.type === "choice") {
    const cur = endsInSpace ? "" : (tokens[tokens.length - 1] || "");
    suggestions = (param.options ?? []).filter((o) =>
      String(o).toLowerCase().startsWith(cur.toLowerCase()),
    );
  }
  return { mode: "param", cmd, paramIdx, param, tokens, endsInSpace, suggestions };
}

export function canRunCmd(parsed: ParsedCmd): boolean {
  if (parsed.mode !== "param" || !parsed.cmd) return false;
  if (!parsed.cmd.params || parsed.cmd.params.length === 0) return true;
  const reqCount = parsed.cmd.params.filter((p) => !p.optional).length;
  const valueTokens = parsed.tokens.length - 1;
  return valueTokens >= reqCount;
}
