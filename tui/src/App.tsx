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
import { computePanelLayout } from "./layout.js";
import type { FocusPanel, TrackName, CCParam } from "./types.js";
import { TRACK_NAMES } from "./types.js";
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

  const [patternStepEdit, setPatternStepEdit] = useState(false);
  const [patternSelectedStep, setPatternSelectedStep] = useState(0);
  const [showTrigPanel, setShowTrigPanel] = useState(false);
  const [trigField, setTrigField] = useState(0);
  const [trigInputBuffer, setTrigInputBuffer] = useState("");
  const [trigTrackWide, setTrigTrackWide] = useState(false);

  useEffect(() => {
    setPatternSelectedStep((s) => clamp(s, 0, Math.max(0, state.pattern_length - 1)));
  }, [state.pattern_length]);

  /** Option B: keep SEQ selected track and MIX selected track in lockstep. */
  useEffect(() => {
    setCCTrack(patternTrack);
  }, [patternTrack]);

  useEffect(() => {
    setPatternTrack(ccTrack);
  }, [ccTrack]);

  useEffect(() => {
    if (trigField === 4) setTrigTrackWide(false);
  }, [trigField]);

  useEffect(() => {
    const maxParam = Math.max(0, state.ccParams.length - 1);
    setCCParam((p) => clamp(p, 0, maxParam));
  }, [state.ccParams.length]);

  useEffect(() => {
    if (focus !== "pattern") {
      setPatternStepEdit(false);
      setShowTrigPanel(false);
      setTrigTrackWide(false);
    }
  }, [focus]);

  useEffect(() => {
    setTrigInputBuffer("");
  }, [showTrigPanel, patternSelectedStep, patternTrack]);

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
        if (m === "chat" || m === "beat") setInputMode(m);
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
      case "bpm":   actions.setBpm(parseFloat(parts[1] ?? "")).catch(dispatchError); break;
      case "swing": actions.setSwing(parseInt(parts[1] ?? "", 10)).catch(dispatchError); break;
      case "length":
        fetch(`${baseUrl}/length`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: parseInt(parts[1] ?? "", 10) }),
        }).then(async r => { if (!r.ok) { const b = await r.json().catch(() => ({})) as { detail?: unknown }; actions.addLog(`✗ ${b.detail ?? r.status}`); } });
        break;
      case "prob":
        actions.setProb(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10), parseInt(parts[3] ?? "", 10))
          .catch(dispatchError); break;
      case "prob-track":
        actions.setProbTrack(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10))
          .catch(dispatchError); break;
      case "vel":
        actions.setVel(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10), parseInt(parts[3] ?? "", 10))
          .catch(dispatchError); break;
      case "vel-track":
        actions.setVelTrack(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10))
          .catch(dispatchError); break;
      case "gate":
        actions.setGate(normalizeTrack(parts[1] ?? ""), parseInt(parts[2] ?? "", 10), parseInt(parts[3] ?? "", 10))
          .catch(dispatchError); break;
      case "gate-track":
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
        if (!name) break;
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
        break;
      }
      case "fill":
        if (parts[1]) actions.queueFill(parts[1]).catch((err: Error) => actions.addLog(`Error: ${err.message}`));
        break;
      case "chain": {
        const autoFlag = parts.includes("--auto");
        const names = parts.slice(1).filter((p) => p !== "--auto");
        if (names.length === 0) {
          actions.addLog("usage: /chain <p1> <p2> ... [--auto]");
          return;
        }
        actions.setChain(names, autoFlag)
          .then(() => actions.addLog(`chain set: ${names.join(" -> ")}${autoFlag ? " (auto)" : ""}`))
          .catch(dispatchError);
        break;
      }
      case "chain-next":
        actions.chainNext()
          .then(() => actions.addLog("chain: queueing next pattern"))
          .catch(dispatchError);
        break;
      case "chain-status": {
        const { chain, chain_index, chain_auto } = state;
        if (chain.length === 0) actions.addLog("no chain defined");
        else {
          const pos = chain_index < 0 ? "unstarted" : `${chain_index + 1}/${chain.length}`;
          actions.addLog(`chain [${pos}]: ${chain.join(" -> ")}${chain_auto ? " (auto)" : ""}`);
        }
        break;
      }
      case "chain-clear":
        actions.chainClear().then(() => actions.addLog("chain cleared")).catch(dispatchError);
        break;
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
      default:
        if (cmd.startsWith("/")) { actions.addLog(`✗ Unknown command: "/${verb}". Type /help for commands.`); return; }
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
  }, [actions, baseUrl, exit, inputMode, setShowLog, state.is_playing, state.track_muted, state.chain, state.chain_index, state.chain_auto]);

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
    if (key.tab) {
      if (acActiveRef.current) return;  // let Prompt handle Tab for autocomplete
      if (key.shift) {
        setInputMode((m) => m === "beat" ? "chat" : "beat");
      } else {
        if (focus === "pattern" && patternStepEdit) {
          if (showTrigPanel) {
            setShowTrigPanel(false);
            setTrigTrackWide(false);
          } else {
            setShowTrigPanel(true);
          }
          return;
        }
        setFocus((f) => {
          if (f === "pattern") return "cc";
          if (f === "cc") return showLog ? "log" : "prompt";
          if (f === "log") return "prompt";
          return "pattern";
        });
      }
      return;
    }
    if (input === "/" && focus !== "prompt") { setFocus("prompt"); return; }
    if (focus === "prompt") return;  // Prompt handles its own keys

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

    if (focus === "pattern") {
      const plen = state.pattern_length;
      const maxStep = Math.max(0, plen - 1);

      if (showTrigPanel) {
        const track = TRACK_NAMES[patternTrack] as TrackName;
        const stepIdx = patternSelectedStep;
        const prob = state.pattern_trig.prob[track]?.[stepIdx] ?? 100;
        const vel = state.current_pattern[track]?.[stepIdx] ?? 0;
        const pitch = state.track_pitch[track] ?? 60;
        const gate = state.pattern_trig.gate[track]?.[stepIdx] ?? 100;
        const cond = state.pattern_trig.cond[track]?.[stepIdx] ?? null;
        const err = (e: Error) => actions.addLog(`✗ ${e.message}`);

        const commitTrigBuffer = (buf: string) => {
          if (buf.length === 0 || trigField === 4) return;
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
            actions.setPitch(track, clamp(raw, 0, 127)).catch(() => {});
          } else if (trigField === 3) {
            if (trigTrackWide) {
              actions.setGateTrack(track, clamp(raw, 0, 100)).catch(err);
            } else {
              actions.setGate(track, stepIdx + 1, clamp(raw, 0, 100)).catch(() => {});
            }
          }
        };

        if (key.escape) {
          setTrigInputBuffer("");
          setShowTrigPanel(false);
          setTrigTrackWide(false);
          return;
        }

        if (input === "t" && trigField !== 4) {
          setTrigTrackWide((w) => !w);
          return;
        }

        if (key.return) {
          commitTrigBuffer(trigInputBuffer);
          setTrigInputBuffer("");
          return;
        }

        if (key.upArrow || key.downArrow) {
          commitTrigBuffer(trigInputBuffer);
          setTrigInputBuffer("");
          setTrigField((f) => clamp(f + (key.downArrow ? 1 : -1), 0, 4));
          return;
        }

        if (trigField === 4 && (key.leftArrow || key.rightArrow)) {
          const order: (string | null)[] = [null, "1:2", "not:2", "fill"];
          const curI = Math.max(0, order.indexOf(cond));
          const nextI = (curI + (key.rightArrow ? 1 : -1) + order.length) % order.length;
          actions.setCond(track, stepIdx + 1, order[nextI] ?? null).catch(() => {});
          return;
        }

        if (input === "[" || input === "]") {
          commitTrigBuffer(trigInputBuffer);
          setTrigInputBuffer("");
          setPatternSelectedStep((s) => clamp(s + (input === "]" ? 1 : -1), 0, maxStep));
          return;
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
            actions.setPitch(track, clamp(pitch + delta, 0, 127)).catch(() => {});
          } else if (trigField === 3) {
            if (trigTrackWide) {
              actions.setGateTrack(track, clamp(gate + delta, 0, 100)).catch(err);
            } else {
              actions.setGate(track, stepIdx + 1, clamp(gate + delta, 0, 100)).catch(() => {});
            }
          }
          return;
        }

        if (trigField !== 4 && (key.backspace || key.delete)) {
          if (trigInputBuffer.length > 0) {
            setTrigInputBuffer((b) => b.slice(0, -1));
          }
          return;
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
          return;
        }
        return;
      }

      if (patternStepEdit) {
        if (key.escape) {
          setPatternStepEdit(false);
          setShowTrigPanel(false);
          setTrigTrackWide(false);
          return;
        }
        if (key.return) {
          setPatternStepEdit(false);
          setShowTrigPanel(false);
          setTrigTrackWide(false);
          return;
        }
        if (input === "[" || input === "]") {
          setPatternSelectedStep((s) => clamp(s + (input === "]" ? 1 : -1), 0, maxStep));
          return;
        }
        if (key.leftArrow || key.rightArrow) {
          setPatternSelectedStep((s) => clamp(s + (key.rightArrow ? 1 : -1), 0, maxStep));
          return;
        }
        if (key.upArrow)   setPatternTrack((t) => clamp(t - 1, 0, 7));
        if (key.downArrow) setPatternTrack((t) => clamp(t + 1, 0, 7));
        return;
      }

      if (key.upArrow)   setPatternTrack((t) => clamp(t - 1, 0, 7));
      if (key.downArrow) setPatternTrack((t) => clamp(t + 1, 0, 7));
      if (key.return) {
        setPatternStepEdit(true);
        setPatternSelectedStep(0);
        setShowTrigPanel(false);
        setTrigField(0);
        setTrigTrackWide(false);
        return;
      }
      if (input === "m") {
        const track = TRACK_NAMES[patternTrack];
        if (track) actions.setMute(track, !state.track_muted[track]);
      }
      if (input === "q") {
        const track = TRACK_NAMES[patternTrack];
        if (track) {
          setPendingMuteTracks((prev) => {
            const next = new Set(prev);
            if (next.has(track)) { next.delete(track); } else { next.add(track); }
            return next;
          });
        }
      }
      if (input === "Q" && pendingMuteTracks.size > 0) {
        const tracksToQueue = Array.from(pendingMuteTracks) as TrackName[];
        setPendingMuteTracks(new Set());
        for (const track of tracksToQueue) {
          actions.setMuteQueued(track, !state.track_muted[track]);
        }
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

      if (input === "[") { setCCTrack((t) => clamp(t - 1, 0, 7)); return; }
      if (input === "]") { setCCTrack((t) => clamp(t + 1, 0, 7)); return; }

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
  const trigOpen = patternStepEdit && showTrigPanel;
  const { centerBudget, mainWidth: mainContentWidth, trigWidth: trigPanelW, logWidth: logPanelW } = computePanelLayout({
    termCols,
    showLog,
    showTrig: trigOpen,
  });

  return (
    <Box flexDirection="column" width={termCols}>
      <StatusBar
        bpm={state.bpm}
        swing={state.swing}
        isPlaying={state.is_playing}
        midiConnected={state.midi_connected}
        patternName={state.last_prompt}
        patternLength={state.pattern_length}
        barCount={barCount}
      />
      <ChainPanel chain={state.chain} chainIndex={state.chain_index} chainAuto={state.chain_auto} />
      <Box flexDirection="row" width={termCols}>
        <FocusRail focus={focus} showLog={showLog} />
        <Box flexDirection="row" flexGrow={1} width={centerBudget}>
        <Box flexDirection="column" width={mainContentWidth}>
          <StepGrid
            contentWidth={mainContentWidth}
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
          <CCPanel
            contentWidth={mainContentWidth}
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
            showHelp={showHelp}
            onClearHelp={() => {
              setShowHelp(false);
              stdout?.write("\x1b[2J\x1b[3J\x1b[H");
              setTimeout(() => forceRedraw(), 0);
            }}
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
              {"/ prompt  Tab panels  Enter step  Tab TRIG  [ ] step  t all-tracks in TRIG  Space  m mute  +/- BPM  Ctrl+C quit"}
            </Text>
          </Box>
        </Box>
        {trigPanelW > 0 && (
          <TrigEditPanel
            width={trigPanelW}
            track={TRACK_NAMES[patternTrack] as TrackName}
            stepIndex={patternSelectedStep}
            prob={state.pattern_trig.prob[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 100}
            velocity={state.current_pattern[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 0}
            pitch={state.track_pitch[TRACK_NAMES[patternTrack] as TrackName] ?? 60}
            gate={state.pattern_trig.gate[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? 100}
            cond={state.pattern_trig.cond[TRACK_NAMES[patternTrack] as TrackName]?.[patternSelectedStep] ?? null}
            selectedField={trigField}
            inputBuffer={trigInputBuffer}
            trackWide={trigTrackWide}
          />
        )}
        {showLog && logPanelW > 0 && (
          <ActivityLog
            log={state.log}
            isFocused={focus === "log"}
            maxVisible={Math.max(8, 17 + state.ccParams.length)}
            width={logPanelW}
          />
        )}
        </Box>
      </Box>
    </Box>
  );
}
