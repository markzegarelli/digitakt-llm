import React, { useState, useCallback, useRef, useEffect, useReducer } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useDigitakt } from "./hooks/useDigitakt.js";
import { StatusBar } from "./components/StatusBar.js";
import { StepGrid } from "./components/StepGrid.js";
import { ChainPanel } from "./components/ChainPanel.js";
import { GenerationSummary } from "./components/GenerationSummary.js";
import { FocusRail } from "./components/FocusRail.js";
import { CCPanel } from "./components/CCPanel.js";
import { ActivityLog } from "./components/ActivityLog.js";
import { Prompt } from "./components/Prompt.js";
import { TrigEditPanel } from "./components/TrigEditPanel.js";
import { EuclidRingPanel } from "./components/EuclidRingPanel.js";
import { EuclidTrackStrip } from "./components/EuclidTrackStrip.js";
import {
  applyEuclidDepthKey,
  getEuclidTrigShortcutRouting,
  getPatternMuteIntent,
  shouldRoutePatternMuteKey,
  togglePendingMuteTrack,
  tracksToQueueAndClear,
  type EuclidDepth,
} from "./euclidMuteUi.js";
import {
  EUCLID_N_MAX,
  advanceEuclideanHitMasterStep,
  euclideanMasterStepHit,
  listEuclideanHitMasterSteps,
  snapMasterStepToEuclideanHit,
} from "./euclidRing.js";
import { computeSplitStackLayout } from "./layout.js";
import {
  isKnownSlashCommand,
  parseChainCommand,
  validateTrackValueArity,
} from "./commandParsing.js";
import {
  canFieldUseTrackWide,
  shouldClearNoteOverrideOnCommit,
  shouldClearNoteOverrideOnDelete,
} from "./trigEditing.js";
import type { FocusPanel, TrackName, CCParam, PatternModalState, PatternListEntry } from "./types.js";
import { DEFAULT_GATE_PCT, TRACK_NAMES } from "./types.js";
import { theme } from "./theme.js";

interface AppProps { baseUrl: string; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Track alias map: normalize shorthand display names to canonical API names
const TRACK_ALIASES: Record<string, string> = { ophat: "openhat", cymbl: "cymbal" };
const normalizeTrack = (raw: string) => TRACK_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();

// Accept common shorthand for the two /random param values
const normalizeRandomParam = (raw: string): string => {
  if (raw === "vel" || raw === "v" || raw === "velocity") return "velocity";
  if (raw === "p") return "prob";
  return raw;
};

export function App({ baseUrl }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, actions] = useDigitakt(baseUrl);
  const [, forceRedraw] = useReducer((x: number) => x + 1, 0);

  const [focus, setFocus]               = useState<FocusPanel>("pattern");
  const [patternTrack, setPatternTrack] = useState(0);
  const [ccTrack, setCCTrack]           = useState(0);
  const [ccParam, setCCParam]           = useState(0);
  const [ccStepMode, setCCStepMode]     = useState(false);
  const [ccSelectedStep, setCCSelectedStep] = useState(0);
  const [ccStepInputBuffer, setCCStepInputBuffer] = useState("");
  const [showHelp, setShowHelp]         = useState(false);
  const [showLog, setShowLog]           = useState(false);
  const [answerText, setAnswerText]     = useState<string | null>(null);
  const lastAnswerRef                   = useRef<string | null>(null);
  const [askPending, setAskPending]     = useState(false);
  const [inputMode, setInputMode]       = useState<"beat" | "chat">("beat");
  const [showHistory, setShowHistory]   = useState(false);
  const [pendingMuteTracks, setPendingMuteTracks] = useState<Set<TrackName>>(new Set());
  const [implementableHint, setImplementableHint] = useState(false);
  const [barCount, setBarCount] = useState(0);
  const acActiveRef = useRef(false);
  const [patternModal, setPatternModal] = useState<PatternModalState | null>(null);
  const [chainStripFocused, setChainStripFocused] = useState(false);
  const [chainSlotIdx, setChainSlotIdx] = useState(0);

  const [patternStepEdit, setPatternStepEdit] = useState(false);
  const [patternSelectedStep, setPatternSelectedStep] = useState(0);
  /** When step edit is on, arrows/digits go to TRIG fields instead of the step column (TRIG panel is always visible). */
  const [trigKeysActive, setTrigKeysActive] = useState(false);
  const [trigField, setTrigField] = useState(0);
  const [trigInputBuffer, setTrigInputBuffer] = useState("");
  const [trigTrackWide, setTrigTrackWide] = useState(false);
  const [euclidEditBox, setEuclidEditBox] = useState<number | null>(null);
  const [euclidDepth, setEuclidDepth] = useState<EuclidDepth>("track-strip");
  // 0=k, 1=n, 2=r; null = no box focused

  const euclidSnapTrack = TRACK_NAMES[patternTrack] as TrackName;
  const euclidSnapRow = state.euclid[euclidSnapTrack] ?? { k: 0, n: 16, r: 0 };
  const euclidSnapK = euclidSnapRow.k;
  const euclidSnapN = euclidSnapRow.n;
  const euclidSnapR = euclidSnapRow.r;

  /** TRIG keyplane while step edit: runs for SEQ or MIX focus so arrows still hit TRIG, not MIX bars. */
  const consumeTrigKeysRef = useRef<(input: string, key: Record<string, boolean | undefined>) => boolean>(() => false);

  useEffect(() => {
    setPatternSelectedStep((s) => clamp(s, 0, Math.max(0, state.pattern_length - 1)));
  }, [state.pattern_length]);

  useEffect(() => {
    const max = Math.max(0, state.chain.length - 1);
    setChainSlotIdx((i) => clamp(i, 0, max));
  }, [state.chain.length]);

  // Clear TRIG edit state when switching to euclidean; clear euclid edit box when switching to standard.
  useEffect(() => {
    setEuclidDepth("track-strip");
    if (state.seq_mode === "euclidean") {
      setPatternStepEdit(false);
      setTrigKeysActive(false);
      setTrigTrackWide(false);
      setEuclidEditBox(null);
    } else {
      setEuclidEditBox(null);
    }
  }, [state.seq_mode]);

  // Clear euclid edit state when SEQ panel loses focus.
  useEffect(() => {
    if (focus !== "pattern") {
      setEuclidEditBox(null);
      setEuclidDepth("track-strip");
    }
  }, [focus]);

  /** Euclidean step+TRIG: keep selection on a pulse step when k/n/r, track, or length changes; exit if k=0. */
  useEffect(() => {
    if (state.seq_mode !== "euclidean" || !patternStepEdit) return;
    const track = TRACK_NAMES[patternTrack] as TrackName;
    const row = state.euclid[track] ?? { k: 0, n: 16, r: 0 };
    const pl = state.pattern_length;
    const hits = listEuclideanHitMasterSteps(row.k, row.n, row.r, pl);
    if (hits.length === 0) {
      setPatternStepEdit(false);
      setTrigKeysActive(false);
      setTrigTrackWide(false);
      setTrigField(0);
      actions.addLog("Step+TRIG closed: no Euclidean pulses (k=0). Raise k to edit per-pulse TRIG.");
      return;
    }
    if (!euclideanMasterStepHit(row.k, row.n, row.r, patternSelectedStep)) {
      setPatternSelectedStep(snapMasterStepToEuclideanHit(patternSelectedStep, hits, pl));
    }
  }, [
    actions.addLog,
    state.seq_mode,
    patternStepEdit,
    patternTrack,
    state.pattern_length,
    patternSelectedStep,
    euclidSnapK,
    euclidSnapN,
    euclidSnapR,
  ]);

  /** Option B: keep SEQ selected track and MIX selected track in lockstep. */
  useEffect(() => {
    setCCTrack(patternTrack);
  }, [patternTrack]);

  useEffect(() => {
    setPatternTrack(ccTrack);
  }, [ccTrack]);

  useEffect(() => {
    if (!canFieldUseTrackWide(trigField)) setTrigTrackWide(false);
  }, [trigField]);

  useEffect(() => {
    const maxParam = Math.max(0, state.ccParams.length - 1);
    setCCParam((p) => clamp(p, 0, maxParam));
  }, [state.ccParams.length]);

  /** Leaving SEQ/MIX for CMD clears step edit; tab between SEQ and MIX keeps it. */
  useEffect(() => {
    if (focus === "prompt") {
      setPatternStepEdit(false);
      setTrigKeysActive(false);
      setTrigTrackWide(false);
    }
  }, [focus]);

  useEffect(() => {
    setTrigInputBuffer("");
  }, [trigKeysActive, patternSelectedStep, patternTrack]);

  // Clear the full screen when generation completes so Ink redraws into a
  // clean buffer, preventing ghost rows from the previous "generating" frame.
  // After clearing, forceRedraw() ensures Ink repaints immediately.
  const prevGenStatus = useRef(state.generation_status);
  useEffect(() => {
    if (prevGenStatus.current === "generating" && state.generation_status !== "generating") {
      const id = setTimeout(() => { stdout?.write('\x1b[2J\x1b[3J\x1b[H'); forceRedraw(); }, 0);
      prevGenStatus.current = state.generation_status;
      return () => clearTimeout(id);
    }
    prevGenStatus.current = state.generation_status;
  }, [state.generation_status, stdout, forceRedraw]);

  useEffect(() => {
    if (state.current_step === 0 && state.is_playing) {
      setBarCount((n) => n + 1);
    }
  }, [state.current_step, state.is_playing]);

  // Ink 5.x uses eraseLines(n) on every re-render to wipe ghost rows from
  // taller previous frames, so no manual screen clear is needed when the
  // Prompt shrinks (help/history/answer → normal). A manual clear + forceRedraw
  // causes the screen to stay blank because React produces the same output as
  // the previous render (panel already dismissed), Ink sees no diff, and skips
  // writing to stdout — leaving a blank screen until the next real state change.

  const fetchPatternNamesAndOpenPicker = useCallback((intent: "load" | "delete") => {
    fetch(`${baseUrl}/patterns`)
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({})) as { detail?: unknown };
          const d = b.detail;
          actions.addLog(
            typeof d === "string" ? `✗ ${d}` : `✗ /patterns: HTTP ${r.status}`,
          );
          return null as { patterns?: unknown[] } | null;
        }
        return r.json() as Promise<{ patterns?: unknown[] }>;
      })
      .then((d) => {
        if (!d) return;
        const raw = Array.isArray(d.patterns) ? d.patterns : [];
        const entries: PatternListEntry[] = raw.map((p) => {
          if (!p || typeof p !== "object") {
            return { name: "?", tags: [], bpm: null, pattern_length: null, swing: null };
          }
          const o = p as Record<string, unknown>;
          const name = typeof o.name === "string" ? o.name : "?";
          const tags = Array.isArray(o.tags) ? o.tags.map((t) => String(t)) : [];
          const bpm = typeof o.bpm === "number" ? o.bpm : null;
          const pattern_length = typeof o.pattern_length === "number" ? o.pattern_length : null;
          const swing = typeof o.swing === "number" ? o.swing : null;
          return { name, tags, bpm, pattern_length, swing };
        });
        if (entries.length === 0) {
          actions.addLog("No saved patterns.");
          return;
        }
        setPatternModal({ phase: "pick", intent, entries, idx: 0 });
        setFocus("prompt");
      })
      .catch((err: Error) => actions.addLog(`✗ /patterns: ${err.message}`));
  }, [actions, baseUrl]);

  const runPatternLoadByName = useCallback((name: string) => {
    setShowLog(true);
    fetch(`${baseUrl}/patterns/${encodeURIComponent(name)}`)
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({})) as { detail?: unknown };
          const d = b.detail;
          actions.addLog(
            typeof d === "string" ? `✗ ${d}` : `Pattern "${name}" not found`,
          );
          return;
        }
        actions.addLog(
          state.is_playing ? `Queued "${name}" for next bar` : `Loaded "${name}"`,
        );
      })
      .catch((err: Error) => actions.addLog(`✗ /load: ${err.message}`));
  }, [actions, baseUrl, setShowLog, state.is_playing]);

  const runPatternDeleteByName = useCallback((name: string) => {
    fetch(`${baseUrl}/patterns/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({})) as { detail?: unknown };
          const d = b.detail;
          actions.addLog(
            typeof d === "string" ? `✗ ${d}` : `✗ Could not delete "${name}"`,
          );
          return;
        }
        actions.addLog(`Deleted saved pattern "${name}".`);
      })
      .catch((err: Error) => actions.addLog(`✗ /delete: ${err.message}`));
  }, [actions, baseUrl]);

  const handleEuclidValueChange = useCallback((field: "k" | "n" | "r", delta: number) => {
    const track = TRACK_NAMES[patternTrack] as TrackName;
    const current = state.euclid[track] ?? { k: 0, n: 16, r: 0 };
    const raw = current[field] + delta;
    const clamped =
      field === "k" ? Math.max(0, Math.min(raw, current.n)) :
      field === "n" ? Math.max(1, Math.min(raw, EUCLID_N_MAX)) :
      /* r */ Math.max(0, Math.min(raw, Math.max(0, current.n - 1)));
    const updated = { ...current, [field]: clamped };
    fetch(`${baseUrl}/seq-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "euclidean", euclid: { [track]: updated } }),
    }).catch((err: Error) => actions.addLog(`✗ /seq-mode: ${err.message}`));
  }, [baseUrl, patternTrack, state.euclid, actions]);

  const openEuclidTrig = useCallback((shiftT: boolean): boolean => {
    const track = TRACK_NAMES[patternTrack] as TrackName;
    const row = state.euclid[track] ?? { k: 0, n: 16, r: 0 };
    const hits = listEuclideanHitMasterSteps(row.k, row.n, row.r, state.pattern_length);
    if (hits.length === 0) {
      actions.addLog("No Euclidean pulses on this track (k=0). Raise k to use step+TRIG.");
      return false;
    }

    const maxStep = Math.max(0, state.pattern_length - 1);
    const play = state.current_step;
    const seed =
      shiftT && state.is_playing && play !== null && play >= 0
        ? clamp(play, 0, maxStep)
        : 0;
    const selected = snapMasterStepToEuclideanHit(seed, hits, state.pattern_length);

    setEuclidEditBox(null);
    setPatternStepEdit(true);
    setEuclidDepth("trig");
    setPatternSelectedStep(selected);
    setTrigKeysActive(false);
    setTrigTrackWide(shiftT && canFieldUseTrackWide(trigField));
    setTrigField(0);
    setTrigInputBuffer("");
    return true;
  }, [
    actions,
    patternTrack,
    state.current_step,
    state.euclid,
    state.is_playing,
    state.pattern_length,
    trigField,
  ]);

  const handleCommand = useCallback((cmd: string) => {
    const stripped = cmd.startsWith("/") ? cmd.slice(1) : cmd;
    const parts = stripped.trim().split(/\s+/);
    const verb = parts[0]?.toLowerCase();

    // Local-only commands (no API call)
    switch (verb) {
      case "quit": case "q":
        exit(); setTimeout(() => process.exit(0), 50); return;
      case "help": setShowHelp(true); setFocus("prompt"); return;
      case "log":  setShowLog((v) => !v); return;
      case "clear": actions.clearLog(); return;
      case "history": setShowHistory(true); setFocus("prompt"); return;
      case "mode": {
        const m = parts[1]?.toLowerCase();
        if (m === "chat" || m === "beat") {
          setInputMode(m);
          return;
        }
        if (m === "standard" || m === "euclidean") {
          fetch(`${baseUrl}/seq-mode`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: m }),
          })
            .then(async (r) => {
              if (!r.ok) {
                const b = await r.json().catch(() => ({})) as { detail?: unknown };
                const d = b.detail;
                actions.addLog(
                  typeof d === "string" ? `✗ ${d}` : `✗ /seq-mode failed (${r.status})`,
                );
                return;
              }
              actions.addLog(`Sequencing mode → ${m}`);
            })
            .catch((err: Error) => actions.addLog(`✗ /seq-mode: ${err.message}`));
          return;
        }
        actions.addLog("✗ Usage: /mode chat|beat|standard|euclidean");
        return;
      }
      case "gen":
        if (lastAnswerRef.current) { setImplementableHint(false); actions.generate(lastAnswerRef.current); }
        else actions.addLog("✗ No ask response to generate from. Use /ask first.");
        return;
      case "ask": {
        const question = parts.slice(1).join(" ");
        if (question) {
          setAskPending(true); setFocus("prompt");
          actions.ask(question)
            .then(({ answer, is_implementable }) => {
              setAskPending(false); lastAnswerRef.current = answer;
              setAnswerText(answer); setImplementableHint(true);
            })
            .catch(() => { setAskPending(false); setAnswerText("Error: could not get answer."); });
        }
        return;
      }
    }

    // Commands with API dispatch — Python validates, errors surface from response
    const dispatchError = (err: Error) => actions.addLog(`✗ ${err.message}`);

    switch (verb) {
      case "play":  actions.play(); break;
      case "stop":  actions.stop(); break;
      case "new":   actions.callNew(); setImplementableHint(false); break;
      case "undo":  actions.callUndo(); setImplementableHint(false); break;
      case "randbeat": actions.randbeat(); break;
      case "fresh": {
        const rest = parts.slice(1).join(" ").trim();
        if (!rest) {
          actions.addLog("✗ Usage: /fresh <prompt> — new pattern without prior-context variation.");
          break;
        }
        setImplementableHint(false);
        actions.generate(rest, { variation: false }).catch(dispatchError);
        break;
      }
      case "bpm":   actions.setBpm(parseFloat(parts[1] ?? "")).catch(dispatchError); break;
      case "swing": actions.setSwing(parseInt(parts[1] ?? "", 10)).catch(dispatchError); break;
      case "length":
        fetch(`${baseUrl}/length`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: parseInt(parts[1] ?? "", 10) }),
        }).then(async r => { if (!r.ok) { const b = await r.json().catch(() => ({})) as { detail?: unknown }; actions.addLog(`✗ ${b.detail ?? r.status}`); } });
        break;
      case "prob":
        {
          const arityError = validateTrackValueArity("prob", parts);
          if (arityError) {
            actions.addLog(`✗ ${arityError}`);
            break;
          }
        }
        actions.setProbTrack(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10))
          .catch(dispatchError); break;
      case "vel":
        {
          const arityError = validateTrackValueArity("vel", parts);
          if (arityError) {
            actions.addLog(`✗ ${arityError}`);
            break;
          }
        }
        actions.setVelTrack(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10))
          .catch(dispatchError); break;
      case "gate":
        {
          const arityError = validateTrackValueArity("gate", parts);
          if (arityError) {
            actions.addLog(`✗ ${arityError}`);
            break;
          }
        }
        actions.setGateTrack(normalizeTrack(parts[1] ?? ""), parseInt(parts[2] ?? "", 10))
          .catch(dispatchError); break;
      case "pitch":
        actions.setPitch(normalizeTrack(parts[1] ?? ""), parseInt(parts[2] ?? "", 10))
          .catch(dispatchError); break;
      case "cc":
        actions.setCC(normalizeTrack(parts[1] ?? "") as TrackName, parts[2] as CCParam, parseInt(parts[3] ?? "", 10))
          .catch(dispatchError); break;
      case "cc-step":
        actions.setCCStep(normalizeTrack(parts[1] ?? "") as TrackName, parts[2] as CCParam, parseInt(parts[3] ?? "", 10), parseInt(parts[4] ?? "", 10) === -1 ? null : parseInt(parts[4] ?? "", 10))
          .catch(dispatchError); break;
      case "cond":
        actions.setCond(normalizeTrack(parts[1] ?? ""), parseInt(parts[2] ?? "", 10), parts[3] === "clear" ? null : (parts[3] ?? null))
          .catch(dispatchError); break;
      case "random": {
        const param = normalizeRandomParam(parts[2] ?? "velocity");
        const lo = parseInt(parts[3]?.replace(/^\[|\]$/g, "").split("-")[0] ?? "", 10) || (param === "prob" ? 0 : 0);
        const hi = parseInt(parts[3]?.replace(/^\[|\]$/g, "").split("-")[1] ?? "", 10) || (param === "prob" ? 100 : 127);
        actions.randomize(normalizeTrack(parts[1] ?? "all"), param, lo, hi).catch(dispatchError);
        break;
      }
      case "mute": {
        const trackArg = normalizeTrack(parts[1] ?? "") as TrackName;
        const flag = parts[2]?.toLowerCase() ?? "toggle";
        const muted = flag === "on" ? true : flag === "off" ? false : !state.track_muted[trackArg];
        actions.setMuteQueued(trackArg, muted).catch(dispatchError);
        break;
      }
      case "save": {
        const name = parts[1];
        if (name) {
          const tags = parts.slice(2).filter(p => p.startsWith("#")).map(p => p.slice(1));
          fetch(`${baseUrl}/patterns/${encodeURIComponent(name)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tags }),
          }).then(() => actions.addLog(`Saved "${name}"${tags.length ? `  [${tags.join(", ")}]` : ""}`));
        }
        break;
      }
      case "load": {
        const name = parts[1];
        if (!name) {
          fetchPatternNamesAndOpenPicker("load");
          break;
        }
        runPatternLoadByName(name);
        break;
      }
      case "delete": {
        const name = parts[1];
        if (!name) {
          fetchPatternNamesAndOpenPicker("delete");
          break;
        }
        setPatternModal({ phase: "delete-confirm", name });
        setFocus("prompt");
        break;
      }
      case "fill":
        if (parts[1]) actions.queueFill(parts[1]).catch((err: Error) => actions.addLog(`Error: ${err.message}`));
        break;
      case "chain": {
        const chainCommand = parseChainCommand(parts);
        if (chainCommand.kind === "subcommand") {
          const sub = chainCommand.subcommand;
          if (sub === "next") {
            actions.chainNext()
              .then(() => actions.addLog("chain: queued next candidate"))
              .catch(dispatchError);
          } else if (sub === "fire") {
            actions.chainFire()
              .then(() => actions.addLog("chain: armed for next 1"))
              .catch(dispatchError);
          } else if (sub === "status") {
            const { chain, chain_index, chain_auto, chain_queued_index, chain_armed } = state;
            if (chain.length === 0) actions.addLog("no chain defined");
            else {
              const pos = chain_index < 0 ? "unstarted" : `${chain_index + 1}/${chain.length}`;
              const queued = chain_queued_index === null ? "none" : `${chain_queued_index + 1}/${chain.length}`;
              const armed = chain_armed ? "armed@1" : "idle";
              actions.addLog(`chain [${pos} queued:${queued} ${armed}]: ${chain.join(" -> ")}${chain_auto ? " (auto)" : ""}`);
            }
          } else if (sub === "clear") {
            actions.chainClear().then(() => actions.addLog("chain cleared")).catch(dispatchError);
          }
          break;
        }
        if (chainCommand.kind === "error") {
          actions.addLog(chainCommand.message);
          break;
        }
        actions.setChain(chainCommand.names, chainCommand.autoFlag)
          .then(() => actions.addLog(`chain set: ${chainCommand.names.join(" -> ")}${chainCommand.autoFlag ? " (auto)" : ""}`))
          .catch(dispatchError);
        break;
      }
      case "patterns": {
        const filterTag = parts[1]?.startsWith("#") ? parts[1].slice(1) : null;
        setShowLog(true);
        fetch(`${baseUrl}/patterns`)
          .then(async (r) => {
            if (!r.ok) {
              const b = await r.json().catch(() => ({})) as { detail?: unknown };
              const d = b.detail;
              actions.addLog(
                typeof d === "string" ? `✗ /patterns: ${d}` : `✗ /patterns: HTTP ${r.status}`,
              );
              return null;
            }
            return r.json() as Promise<{ patterns?: Array<{ name: string; tags?: string[] }> }>;
          })
          .then((d) => {
            if (!d) return;
            const entries = Array.isArray(d.patterns) ? d.patterns : [];
            const list = filterTag
              ? entries.filter((p) => Array.isArray(p.tags) && p.tags.includes(filterTag))
              : entries;
            if (list.length === 0) {
              actions.addLog(filterTag ? `No patterns tagged #${filterTag}.` : "No saved patterns.");
              return;
            }
            list.forEach((p) => {
              const tags = Array.isArray(p.tags) ? p.tags : [];
              actions.addLog(`  ${p.name}${tags.length ? `  [${tags.join(", ")}]` : ""}`);
            });
          })
          .catch((err: Error) => actions.addLog(`✗ /patterns: ${err.message}`));
        break;
      }
      case "midi": {
        const sub = parts[1]?.toLowerCase();
        if (sub === "list") {
          fetch(`${baseUrl}/midi/outputs`)
            .then(async (r) => {
              if (!r.ok) {
                const b = await r.json().catch(() => ({})) as { detail?: unknown };
                const d = b.detail;
                actions.addLog(
                  typeof d === "string" ? `✗ /midi list: ${d}` : `✗ /midi list: HTTP ${r.status}`,
                );
                return;
              }
              const d = await r.json() as { ports?: string[] };
              const ports = Array.isArray(d.ports) ? d.ports : [];
              if (ports.length === 0) actions.addLog("No MIDI output ports.");
              else ports.forEach((p) => actions.addLog(`  ${p}`));
            })
            .catch((err: Error) => actions.addLog(`✗ /midi list: ${err.message}`));
          break;
        }
        fetch(`${baseUrl}/midi/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
          .then(async (r) => {
            if (!r.ok) {
              const b = await r.json().catch(() => ({})) as { detail?: unknown };
              const det = b.detail;
              if (det && typeof det === "object" && det !== null && "message" in det) {
                const o = det as { message: string; available?: string[] };
                actions.addLog(`✗ ${o.message}`);
                if (Array.isArray(o.available) && o.available.length > 0) {
                  actions.addLog("MIDI outputs:");
                  o.available.forEach((p) => actions.addLog(`  ${p}`));
                }
              } else {
                actions.addLog(
                  typeof det === "string" ? `✗ ${det}` : `✗ /midi: HTTP ${r.status}`,
                );
              }
              return;
            }
          })
          .catch((err: Error) => actions.addLog(`✗ /midi: ${err.message}`));
        break;
      }
      default:
        if (cmd.startsWith("/") && !isKnownSlashCommand(verb)) {
          actions.addLog(`✗ Unknown command: "/${verb}". Type /help for commands.`);
          return;
        }
        if (cmd.startsWith("/")) return;
        if (stripped.trim()) {
          if (inputMode === "chat") {
            setAskPending(true); setFocus("prompt");
            actions.ask(stripped.trim())
              .then(({ answer, is_implementable }) => {
                setAskPending(false); lastAnswerRef.current = answer;
                setAnswerText(answer); setImplementableHint(true);
              })
              .catch(() => { setAskPending(false); setAnswerText("Error: could not get answer."); });
          } else { setImplementableHint(false); actions.generate(stripped.trim()); }
        }
    }
  }, [
    actions,
    baseUrl,
    exit,
    fetchPatternNamesAndOpenPicker,
    inputMode,
    runPatternLoadByName,
    setShowLog,
    state.is_playing,
    state.track_muted,
    state.chain,
    state.chain_index,
    state.chain_auto,
  ]);

  consumeTrigKeysRef.current = (input, key) => {
    if (!patternStepEdit || !trigKeysActive) return false;

    const plen = state.pattern_length;
    const maxStep = Math.max(0, plen - 1);
    const track = TRACK_NAMES[patternTrack] as TrackName;
    const stepIdx = patternSelectedStep;
    const prob = state.pattern_trig.prob[track]?.[stepIdx] ?? 100;
    const vel = state.current_pattern[track]?.[stepIdx] ?? 0;
    const noteOv = state.pattern_trig.note[track]?.[stepIdx];
    const resolvedPitch = noteOv != null ? noteOv : (state.track_pitch[track] ?? 60);
    const gate = state.pattern_trig.gate[track]?.[stepIdx] ?? DEFAULT_GATE_PCT;
    const cond = state.pattern_trig.cond[track]?.[stepIdx] ?? null;
    const err = (e: Error) => actions.addLog(`✗ ${e.message}`);

    const commitTrigBuffer = (buf: string) => {
      if (trigField === 4) return;
      if (shouldClearNoteOverrideOnCommit(trigField, buf)) {
        actions.setNote(track, stepIdx + 1, null).catch(() => {});
        return;
      }
      if (buf.length === 0) return;
      const raw = parseInt(buf, 10);
      if (Number.isNaN(raw)) return;
      if (trigField === 0) {
        if (trigTrackWide) {
          actions.setProbTrack(track, clamp(raw, 0, 100)).catch(err);
        } else {
          actions.setProb(track, stepIdx + 1, clamp(raw, 0, 100)).catch(err);
        }
      } else if (trigField === 1) {
        if (trigTrackWide) {
          actions.setVelTrack(track, clamp(raw, 0, 127)).catch(err);
        } else {
          actions.setVel(track, stepIdx + 1, clamp(raw, 0, 127)).catch(err);
        }
      } else if (trigField === 2) {
        actions.setNote(track, stepIdx + 1, clamp(raw, 0, 127)).catch(() => {});
      } else if (trigField === 3) {
        if (trigTrackWide) {
          actions.setGateTrack(track, clamp(raw, 0, 100)).catch(err);
        } else {
          actions.setGate(track, stepIdx + 1, clamp(raw, 0, 100)).catch(err);
        }
      }
    };

    if (key.escape) {
      setTrigInputBuffer("");
      if (state.seq_mode === "euclidean") {
        setPatternStepEdit(false);
        setTrigKeysActive(false);
        setTrigTrackWide(false);
        setTrigField(0);
        setEuclidDepth("active-ring");
        setEuclidEditBox(0);
        return true;
      }
      setTrigKeysActive(false);
      setTrigTrackWide(false);
      return true;
    }

    if (key.return) {
      commitTrigBuffer(trigInputBuffer);
      setTrigInputBuffer("");
      return true;
    }

    if (key.upArrow || key.downArrow) {
      commitTrigBuffer(trigInputBuffer);
      setTrigInputBuffer("");
      setTrigField((f) => clamp(f + (key.downArrow ? 1 : -1), 0, 4));
      return true;
    }

    if (trigField === 4 && (key.leftArrow || key.rightArrow)) {
      const order: (string | null)[] = [null, "1:2", "not:2", "fill"];
      const curI = Math.max(0, order.indexOf(cond));
      const nextI = (curI + (key.rightArrow ? 1 : -1) + order.length) % order.length;
      actions.setCond(track, stepIdx + 1, order[nextI] ?? null).catch(() => {});
      return true;
    }

    if (input === "[" || input === "]") {
      commitTrigBuffer(trigInputBuffer);
      setTrigInputBuffer("");
      if (state.seq_mode === "euclidean") {
        const row = state.euclid[track] ?? { k: 0, n: 16, r: 0 };
        const d = input === "]" ? 1 : (-1 as const);
        setPatternSelectedStep((s) =>
          advanceEuclideanHitMasterStep(s, d, row.k, row.n, row.r, plen),
        );
      } else {
        setPatternSelectedStep((s) => clamp(s + (input === "]" ? 1 : -1), 0, maxStep));
      }
      return true;
    }

    if (trigField !== 4 && (key.leftArrow || key.rightArrow)) {
      if (trigInputBuffer.length > 0) {
        commitTrigBuffer(trigInputBuffer);
        setTrigInputBuffer("");
      }
      const delta = (key.rightArrow ? 1 : -1) * (key.shift ? 10 : 1);
      if (trigField === 0) {
        if (trigTrackWide) {
          actions.setProbTrack(track, clamp(prob + delta, 0, 100)).catch(err);
        } else {
          actions.setProb(track, stepIdx + 1, clamp(prob + delta, 0, 100)).catch(err);
        }
      } else if (trigField === 1) {
        if (trigTrackWide) {
          actions.setVelTrack(track, clamp(vel + delta, 0, 127)).catch(err);
        } else {
          actions.setVel(track, stepIdx + 1, clamp(vel + delta, 0, 127)).catch(err);
        }
      } else if (trigField === 2) {
        actions.setNote(track, stepIdx + 1, clamp(resolvedPitch + delta, 0, 127)).catch(() => {});
      } else if (trigField === 3) {
        if (trigTrackWide) {
          actions.setGateTrack(track, clamp(gate + delta, 0, 100)).catch(err);
        } else {
          actions.setGate(track, stepIdx + 1, clamp(gate + delta, 0, 100)).catch(err);
        }
      }
      return true;
    }

    if (trigField !== 4 && (key.backspace || key.delete)) {
      if (trigInputBuffer.length > 0) {
        setTrigInputBuffer((b) => b.slice(0, -1));
      } else if (shouldClearNoteOverrideOnDelete(trigField, trigInputBuffer)) {
        actions.setNote(track, stepIdx + 1, null).catch(() => {});
      }
      return true;
    }

    if (trigField !== 4 && /^\d$/.test(input)) {
      const hi = trigField === 0 || trigField === 3 ? 100 : 127;
      const newBuf = trigInputBuffer + input;
      const n = parseInt(newBuf, 10);
      if (n <= hi) {
        setTrigInputBuffer(newBuf);
        const maxDigits = hi >= 100 ? 3 : 2;
        if (newBuf.length >= maxDigits) {
          commitTrigBuffer(newBuf);
          setTrigInputBuffer("");
        }
      }
      return true;
    }

    return true;
  };

  const handlePatternMuteKey = useCallback((input: string): boolean => {
    const track = TRACK_NAMES[patternTrack] as TrackName;
    const intent = getPatternMuteIntent(input, track, pendingMuteTracks);

    if (intent.kind === "immediate") {
      actions.setMute(intent.track, !state.track_muted[intent.track])
        .catch((e: Error) => actions.addLog(`✗ ${e.message}`));
      return true;
    }

    if (intent.kind === "toggle-pending") {
      setPendingMuteTracks((prev) => togglePendingMuteTrack(prev, intent.track));
      return true;
    }

    if (intent.kind === "queue-all") {
      const queued = tracksToQueueAndClear(pendingMuteTracks);
      setPendingMuteTracks(queued.nextPending);
      for (const queuedTrack of queued.tracks) {
        actions.setMuteQueued(queuedTrack, !state.track_muted[queuedTrack])
          .catch((e: Error) => actions.addLog(`✗ ${e.message}`));
      }
      return true;
    }

    return false;
  }, [actions, patternTrack, pendingMuteTracks, state.track_muted]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      setTimeout(() => process.exit(0), 50);
      return;
    }
    if (key.ctrl && input === "g") {
      if (lastAnswerRef.current) {
        setAnswerText(null);
        setImplementableHint(false);
        actions.generate(lastAnswerRef.current);
      }
      return;
    }
    if (focus !== "prompt" && input === "?" && !key.ctrl && !key.meta) {
      setShowHelp(true);
      setFocus("prompt");
      return;
    }

    if (patternModal && key.escape) {
      setPatternModal(null);
      return;
    }

    if (chainStripFocused) {
      if (key.escape) {
        setChainStripFocused(false);
        setFocus("pattern");
        return;
      }
      if (input === "c" && !key.ctrl && !key.meta) {
        setChainStripFocused(false);
        return;
      }
      if (key.leftArrow) {
        setChainSlotIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.rightArrow) {
        setChainSlotIdx((i) => Math.min(Math.max(0, state.chain.length - 1), i + 1));
        return;
      }
      if (input === "n" && !key.ctrl && !key.meta) {
        actions.chainNext().catch((e: Error) => actions.addLog(`✗ ${e.message}`));
        return;
      }
      if (input === "N" && !key.ctrl && !key.meta) {
        actions.chainFire().catch((e: Error) => actions.addLog(`✗ ${e.message}`));
        return;
      }
    }

    if (!chainStripFocused && focus !== "prompt" && input === "c" && !key.ctrl && !key.meta && state.chain.length > 0) {
      setChainStripFocused(true);
      setChainSlotIdx(state.chain_index >= 0 ? state.chain_index : 0);
      return;
    }

    if (key.tab) {
      if (acActiveRef.current) return;  // let Prompt handle Tab for autocomplete
      if (chainStripFocused) setChainStripFocused(false);
      if (key.shift) {
        setInputMode((m) => m === "beat" ? "chat" : "beat");
      } else {
        if (focus === "pattern" && patternStepEdit && state.seq_mode !== "euclidean") {
          setTrigKeysActive((a) => !a);
          return;
        }
        const nextFocus: FocusPanel =
          focus === "pattern" ? "cc" :
          focus === "cc" ? "prompt" :
          "pattern";
        setFocus(nextFocus);
        if (nextFocus === "cc") {
          void actions.setCCFocusedTrack(TRACK_NAMES[ccTrack]);
        }
      }
      return;
    }
    if (input === "/" && focus !== "prompt") { setFocus("prompt"); return; }

    // SEQ (pattern): plain t / Shift+t — step edit + TRIG; Shift+t from row view opens TRIG + ALL in one step.
    if (focus === "pattern" && !key.ctrl && !key.meta) {
      const ch = typeof input === "string" ? input.trim() : "";
      if (ch === "t" || ch === "T") {
        const shiftT = ch === "T" || (ch === "t" && key.shift);

        if (state.seq_mode === "euclidean") {
          const routing = getEuclidTrigShortcutRouting({ depth: euclidDepth, patternStepEdit });
          if (routing === "ignore") return;
          if (routing === "open-trig") {
            openEuclidTrig(shiftT);
            return;
          }
        }

        if (!patternStepEdit) {
          if (shiftT) {
            const maxStep = Math.max(0, state.pattern_length - 1);
            const play = state.current_step;
            const step =
              play !== null && play >= 0 ? clamp(play, 0, maxStep) : 0;
            setEuclidEditBox(null);
            setPatternStepEdit(true);
            setPatternSelectedStep(step);
            setTrigKeysActive(true);
            setTrigTrackWide(true);
            setTrigField(0);
            setTrigInputBuffer("");
            return;
          }
        } else if (patternStepEdit) {
          if (!trigKeysActive) {
            setTrigKeysActive(true);
            setTrigTrackWide(!!shiftT && canFieldUseTrackWide(trigField));
            return;
          }
          if (shiftT) {
            if (canFieldUseTrackWide(trigField)) setTrigTrackWide((w) => !w);
            return;
          }
          setTrigKeysActive(false);
          setTrigTrackWide(false);
          return;
        }
      }
    }

    if (focus === "prompt") return;  // Prompt handles its own keys

    if (shouldRoutePatternMuteKey({
      input,
      focus,
      ctrl: key.ctrl,
      meta: key.meta,
      patternStepEdit,
      trigKeysActive,
    })) {
      if (handlePatternMuteKey(input)) return;
    }

    if (input === " ") {
      if (focus === "pattern" && patternStepEdit) {
        const track = TRACK_NAMES[patternTrack];
        if (track) {
          const cur = state.current_pattern[track][patternSelectedStep] ?? 0;
          const next = cur > 0 ? 0 : state.track_velocity[track] ?? 127;
          actions.setVel(track, patternSelectedStep + 1, next).catch((e: Error) => actions.addLog(`✗ ${e.message}`));
        }
        return;
      }
      state.is_playing ? actions.stop() : actions.play();
      return;
    }
    if (input === "+") { actions.setBpm(Math.min(400, state.bpm + 1)); return; }
    if (input === "-") { actions.setBpm(Math.max(20,  state.bpm - 1)); return; }

    if (consumeTrigKeysRef.current(input, key as Record<string, boolean | undefined>)) return;

    if (focus === "pattern") {
      const plen = state.pattern_length;
      const maxStep = Math.max(0, plen - 1);

      if (state.seq_mode === "euclidean" && (key.return || key.escape)) {
        const result = applyEuclidDepthKey({
          depth: euclidDepth,
          keyName: key.return ? "enter" : "escape",
          k: euclidSnapK,
        });

        if (result.consumed) {
          if (result.logNoPulsesHint) {
            actions.addLog("No Euclidean pulses on this track (k=0). Raise k to use step+TRIG.");
          }
          if (result.openTrig) {
            if (!openEuclidTrig(false)) setEuclidDepth("active-ring");
            return;
          }

          setEuclidDepth(result.depth);
          if (result.depth !== "trig") {
            setPatternStepEdit(false);
            setTrigKeysActive(false);
            setTrigTrackWide(false);
            setTrigField(0);
            setTrigInputBuffer("");
          }
          setEuclidEditBox(result.depth === "active-ring" ? 0 : null);
          return;
        }
      }

      // Step + TRIG (standard and euclidean): must run before euclidean ring-only swallow.
      if (patternStepEdit) {
        if (key.escape) {
          if (state.seq_mode === "euclidean") {
            setPatternStepEdit(false);
            setTrigKeysActive(false);
            setTrigTrackWide(false);
            setTrigField(0);
            setTrigInputBuffer("");
            setEuclidDepth("active-ring");
            setEuclidEditBox(0);
            return;
          }
          setPatternStepEdit(false);
          setTrigKeysActive(false);
          setTrigTrackWide(false);
          setTrigField(0);
          return;
        }
        if (key.return) {
          setPatternStepEdit(false);
          setTrigKeysActive(false);
          setTrigTrackWide(false);
          setTrigField(0);
          return;
        }
        if (input === "[" || input === "]") {
          if (state.seq_mode === "euclidean") {
            const track = TRACK_NAMES[patternTrack] as TrackName;
            const row = state.euclid[track] ?? { k: 0, n: 16, r: 0 };
            const d = input === "]" ? 1 : (-1 as const);
            setPatternSelectedStep((s) =>
              advanceEuclideanHitMasterStep(s, d, row.k, row.n, row.r, plen),
            );
          } else {
            setPatternSelectedStep((s) => clamp(s + (input === "]" ? 1 : -1), 0, maxStep));
          }
          return;
        }
        if (key.leftArrow || key.rightArrow) {
          if (state.seq_mode === "euclidean") {
            const track = TRACK_NAMES[patternTrack] as TrackName;
            const row = state.euclid[track] ?? { k: 0, n: 16, r: 0 };
            const d = key.rightArrow ? 1 : (-1 as const);
            setPatternSelectedStep((s) =>
              advanceEuclideanHitMasterStep(s, d, row.k, row.n, row.r, plen),
            );
          } else {
            setPatternSelectedStep((s) => clamp(s + (key.rightArrow ? 1 : -1), 0, maxStep));
          }
          return;
        }
        if (key.upArrow)   setPatternTrack((t) => clamp(t - 1, 0, 7));
        if (key.downArrow) setPatternTrack((t) => clamp(t + 1, 0, 7));
        return;
      }

      // Euclidean ring view (k/n/r): Enter toggles k/n/r edit; ]/[ cycle fields; ↑/↓ value or track.
      if (state.seq_mode === "euclidean") {
        if (key.escape && euclidEditBox !== null) {
          setEuclidEditBox(null);
          return;
        }
        if (key.return) {
          setEuclidEditBox((b) => (b === null ? 0 : null));
          return;
        }
        if (euclidDepth === "active-ring" && euclidEditBox !== null && (input === "[" || input === "]")) {
          setEuclidEditBox((b) => {
            const cur = b ?? 0;
            return (input === "]" ? (cur + 1) % 3 : (cur + 2) % 3) as 0 | 1 | 2;
          });
          return;
        }
        if (euclidDepth === "active-ring" && euclidEditBox !== null && (key.leftArrow || key.rightArrow) && !key.shift) {
          setEuclidEditBox((b) => {
            const cur = b ?? 0;
            return (key.rightArrow ? (cur + 1) % 3 : (cur + 2) % 3) as 0 | 1 | 2;
          });
          return;
        }
        if (key.upArrow || key.downArrow) {
          if (euclidDepth === "track-strip") {
            setPatternTrack((t) => clamp(t + (key.downArrow ? 1 : -1), 0, 7));
          } else if (euclidDepth === "active-ring" && euclidEditBox !== null) {
            const fields = ["k", "n", "r"] as const;
            const field = fields[euclidEditBox as 0 | 1 | 2];
            const delta = (key.upArrow ? 1 : -1) * (key.shift ? 10 : 1);
            handleEuclidValueChange(field, delta);
          }
          return;
        }
        return; // swallow remaining keys in euclidean ring view
      }

      if (key.upArrow)   setPatternTrack((t) => clamp(t - 1, 0, 7));
      if (key.downArrow) setPatternTrack((t) => clamp(t + 1, 0, 7));
      if (key.return) {
        setPatternStepEdit(true);
        setPatternSelectedStep(0);
        setTrigKeysActive(false);
        setTrigField(0);
        setTrigTrackWide(false);
        return;
      }
      if (input === "n") {
        actions.chainNext().catch((e: Error) => actions.addLog(`✗ ${e.message}`));
      }
      if (input === "N") {
        actions.chainFire().catch((e: Error) => actions.addLog(`✗ ${e.message}`));
      }
      return;
    }

    if (focus === "cc") {
      if (ccStepMode) {
        const track = TRACK_NAMES[ccTrack] as TrackName;
        const param = state.ccParams[ccParam]?.name ?? "";

        // Commit number buffer helper
        const commitBuffer = (buf: string) => {
          if (buf.length > 0 && track && param) {
            const val = clamp(parseInt(buf, 10), 0, 127);
            actions.setCCStep(track, param, ccSelectedStep + 1, val);
          }
        };

        if (key.escape) {
          commitBuffer(ccStepInputBuffer);
          setCCStepInputBuffer("");
          setCCStepMode(false);
          return;
        }

        if (key.leftArrow || key.rightArrow) {
          if (key.shift) {
            commitBuffer(ccStepInputBuffer);
            setCCStepInputBuffer("");
            if (track && param) {
              const stepOverrides = state.step_cc?.[track]?.[param];
              const current = stepOverrides?.[ccSelectedStep] ?? state.track_cc[track][param];
              const delta = (key.rightArrow ? 1 : -1) * 10;
              actions.setCCStep(track, param, ccSelectedStep + 1, clamp(current + delta, 0, 127));
            }
            return;
          }
          commitBuffer(ccStepInputBuffer);
          setCCStepInputBuffer("");
          setCCSelectedStep((s) => clamp(s + (key.rightArrow ? 1 : -1), 0, Math.max(0, state.pattern_length - 1)));
          return;
        }

        if (key.return) {
          commitBuffer(ccStepInputBuffer);
          setCCStepInputBuffer("");
          return;
        }

        if (key.upArrow || key.downArrow) {
          setCCStepInputBuffer("");
          if (track && param) {
            const stepOverrides = state.step_cc?.[track]?.[param];
            const current = stepOverrides?.[ccSelectedStep] ?? state.track_cc[track][param];
            const delta = (key.upArrow ? 1 : -1) * (key.shift ? 10 : 1);
            actions.setCCStep(track, param, ccSelectedStep + 1, clamp(current + delta, 0, 127));
          }
          return;
        }

        // Backspace: pop digit from buffer, or revert step to global when buffer empty
        if (key.backspace || key.delete) {
          if (ccStepInputBuffer.length > 0) {
            setCCStepInputBuffer((b) => b.slice(0, -1));
          } else {
            if (track && param) actions.setCCStep(track, param, ccSelectedStep + 1, null);
          }
          return;
        }

        // Digit entry: build number buffer
        if (/^\d$/.test(input)) {
          const newBuf = ccStepInputBuffer + input;
          const val = parseInt(newBuf, 10);
          if (val <= 127) {
            setCCStepInputBuffer(newBuf);
            // Auto-commit at 3 digits
            if (newBuf.length >= 3 && track && param) {
              actions.setCCStep(track, param, ccSelectedStep + 1, val);
              setCCStepInputBuffer("");
            }
          }
          return;
        }

        return;  // swallow other keys while in step-edit mode
      }

      // Normal CC panel navigation
      if (key.upArrow)   setCCParam((p) => clamp(p - 1, 0, Math.max(0, state.ccParams.length - 1)));
      if (key.downArrow) setCCParam((p) => clamp(p + 1, 0, Math.max(0, state.ccParams.length - 1)));

      if (input === "[") { const next = clamp(ccTrack - 1, 0, 7); setCCTrack(next); void actions.setCCFocusedTrack(TRACK_NAMES[next]); return; }
      if (input === "]") { const next = clamp(ccTrack + 1, 0, 7); setCCTrack(next); void actions.setCCFocusedTrack(TRACK_NAMES[next]); return; }

      // Enter step-edit mode for the selected CC param
      if ((input === "e" || key.return) && state.ccParams.length > 0) {
        setCCStepMode(true);
        setCCSelectedStep(0);
        setCCStepInputBuffer("");
        return;
      }

      if (key.leftArrow || key.rightArrow) {
        const sign = (key.rightArrow ? 1 : -1) * (key.shift ? 10 : 1);
        const track = TRACK_NAMES[ccTrack];
        const param = state.ccParams[ccParam]?.name;
        if (track && param) {
          const current = state.track_cc[track][param] ?? 64;
          actions.setCC(track, param as CCParam, clamp(current + sign, 0, 127));
        }
      }
      return;
    }
  });

  const termCols = stdout?.columns ?? 120;
  const termRows = stdout?.rows ?? 28;
  const helpMaxVisibleRows = Math.max(10, Math.min(22, termRows - 20));
  const { centerBudget, stackWidth, seqGridWidth, mixWidth, trigWidth: trigRowW } = computeSplitStackLayout({
    termCols,
    showLog,
    showTrig: true,
  });
  const muteCount = TRACK_NAMES.filter((t) => state.track_muted[t]).length;

  return (
    <Box flexDirection="column" width={termCols}>
      <StatusBar
        bpm={state.bpm}
        swing={state.swing}
        isPlaying={state.is_playing}
        midiConnected={state.midi_connected}
        midiPortName={state.midi_port_name}
        patternName={state.last_prompt}
        patternLength={state.pattern_length}
        currentStep={state.current_step}
        barCount={barCount}
        generationStatus={state.generation_status}
        fillActive={state.fill_active}
        fillQueued={state.fill_queued}
        muteCount={muteCount}
      />
      <ChainPanel
        chain={state.chain}
        chainIndex={state.chain_index}
        chainAuto={state.chain_auto}
        queuedIndex={state.chain_queued_index}
        armed={state.chain_armed}
        stripFocused={chainStripFocused}
        selectedSlotIdx={chainSlotIdx}
      />
      <Box flexDirection="row" width={termCols}>
        <FocusRail focus={focus} />
        <Box flexDirection="row" flexGrow={1} width={centerBudget}>
          <Box flexDirection="column" width={stackWidth}>
            <Box flexDirection="row" width={stackWidth}>
              {state.seq_mode === "euclidean" ? (
                <>
                  <EuclidTrackStrip
                    selectedTrack={patternTrack}
                    trackMuted={state.track_muted}
                    pendingMuteTracks={pendingMuteTracks}
                    isFocused={focus === "pattern" && euclidDepth === "track-strip"}
                    width={12}
                  />
                  <EuclidRingPanel
                    width={patternStepEdit ? Math.max(0, seqGridWidth - 12) : Math.max(0, stackWidth - 12)}
                    track={TRACK_NAMES[patternTrack] as TrackName}
                    euclid={state.euclid}
                    currentStep={state.current_step}
                    isFocused={focus === "pattern" && euclidDepth === "active-ring"}
                    editBox={euclidDepth === "active-ring" ? euclidEditBox : null}
                    stepTrigEdit={patternStepEdit}
                    selectedPatternStep={patternStepEdit ? patternSelectedStep : null}
                  />
                  {patternStepEdit && (
                    <TrigEditPanel
                      width={trigRowW}
                      keysActive={trigKeysActive}
                      track={TRACK_NAMES[patternTrack] as TrackName}
                      stepIndex={patternSelectedStep}
                      prob={state.pattern_trig.prob[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 100}
                      velocity={state.current_pattern[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 0}
                      pitch={(() => {
                        const tr = TRACK_NAMES[patternTrack] as TrackName;
                        const ov = state.pattern_trig.note[tr]?.[patternSelectedStep];
                        return ov != null ? ov : (state.track_pitch[tr] ?? 60);
                      })()}
                      gate={state.pattern_trig.gate[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? DEFAULT_GATE_PCT}
                      cond={state.pattern_trig.cond[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? null}
                      selectedField={trigField}
                      inputBuffer={trigInputBuffer}
                      trackWide={trigTrackWide}
                    />
                  )}
                </>
              ) : (
                <>
                  <StepGrid
                    contentWidth={seqGridWidth}
                    pattern={state.current_pattern}
                    patternTrig={state.pattern_trig}
                    patternLength={state.pattern_length}
                    currentStep={state.current_step}
                    trackMuted={state.track_muted}
                    selectedTrack={patternTrack}
                    pendingMuteTracks={pendingMuteTracks}
                    stepEditMode={patternStepEdit}
                    selectedStep={patternSelectedStep}
                    isFocused={focus === "pattern"}
                  />
                  <TrigEditPanel
                    width={trigRowW}
                    keysActive={trigKeysActive}
                    track={TRACK_NAMES[patternTrack] as TrackName}
                    stepIndex={patternSelectedStep}
                    prob={state.pattern_trig.prob[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 100}
                    velocity={state.current_pattern[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 0}
                    pitch={(() => {
                      const tr = TRACK_NAMES[patternTrack] as TrackName;
                      const ov = state.pattern_trig.note[tr]?.[patternSelectedStep];
                      return ov != null ? ov : (state.track_pitch[tr] ?? 60);
                    })()}
                    gate={state.pattern_trig.gate[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? DEFAULT_GATE_PCT}
                    cond={state.pattern_trig.cond[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? null}
                    selectedField={trigField}
                    inputBuffer={trigInputBuffer}
                    trackWide={trigTrackWide}
                  />
                </>
              )}
            </Box>
            <Box flexDirection="row" width={stackWidth}>
              <CCPanel
                contentWidth={mixWidth}
                ccParams={state.ccParams}
                trackCC={state.track_cc}
                stepCC={state.step_cc}
                patternTrig={state.pattern_trig}
                patternLength={state.pattern_length}
                currentStep={state.current_step}
                selectedTrack={ccTrack}
                trackMuted={state.track_muted}
                pendingMuteTracks={pendingMuteTracks}
                selectedParam={ccParam}
                isFocused={focus === "cc"}
                stepMode={ccStepMode}
                selectedStep={ccSelectedStep}
                stepInputBuffer={ccStepInputBuffer}
              />
            </Box>
            <GenerationSummary
              summary={state.generation_summary}
              generationStatus={state.generation_status}
              lastPrompt={state.last_prompt}
            />
            <Prompt
              isFocused={focus === "prompt"}
              generationStatus={state.generation_status}
              generationError={state.generation_error}
              onCommand={handleCommand}
              patternModal={patternModal}
              onPatternModalClose={() => setPatternModal(null)}
              onPatternModalNav={(dir) => {
                setPatternModal((m) => {
                  if (!m || m.phase !== "pick") return m;
                  const ni = clamp(m.idx + dir, 0, m.entries.length - 1);
                  return { ...m, idx: ni };
                });
              }}
              onPatternModalPick={() => {
                setPatternModal((m) => {
                  if (!m || m.phase !== "pick") return m;
                  const picked = m.entries[m.idx]?.name;
                  if (!picked) return null;
                  if (m.intent === "load") {
                    queueMicrotask(() => runPatternLoadByName(picked));
                    return null;
                  }
                  return { phase: "delete-confirm", name: picked };
                });
              }}
              onDeleteConfirmYes={() => {
                setPatternModal((m) => {
                  if (!m || m.phase !== "delete-confirm") return m;
                  const n = m.name;
                  queueMicrotask(() => runPatternDeleteByName(n));
                  return null;
                });
              }}
              showHelp={showHelp}
              helpMaxVisibleRows={helpMaxVisibleRows}
            onClearHelp={() => {
              setShowHelp(false);
              stdout?.write("\x1b[2J\x1b[3J\x1b[H");
              setTimeout(() => forceRedraw(), 0);
            }}
            onOpenHelp={() => setShowHelp(true)}
              answerText={answerText}
              askPending={askPending}
              onClearAnswer={() => setAnswerText(null)}
              inputMode={inputMode}
              showHistory={showHistory}
              historyItems={state.pattern_history ?? []}
              onClearHistory={() => setShowHistory(false)}
              implementableHint={implementableHint}
              onDismissHint={() => setImplementableHint(false)}
              acActiveRef={acActiveRef}
            />
            <Box paddingX={1}>
              <Text color={theme.textFaint}>
                {"? help  /help  Tab panels  Shift+Tab mode  c chain strip  n/N chain  Space transport  Ctrl+C quit"}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
      {showLog && (
        <ActivityLog
          log={state.log}
          maxVisible={Math.max(10, Math.min(24, Math.max(8, (stdout?.rows ?? 28) - 14)))}
          width={termCols}
        />
      )}
    </Box>
  );
}
