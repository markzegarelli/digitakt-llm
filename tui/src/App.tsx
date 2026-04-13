import React, { useState, useCallback, useRef, useEffect, useReducer } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useDigitakt } from "./hooks/useDigitakt.js";
import { Header } from "./components/Header.js";
import { PatternGrid } from "./components/PatternGrid.js";
import { CCPanel } from "./components/CCPanel.js";
import { ActivityLog } from "./components/ActivityLog.js";
import { Prompt } from "./components/Prompt.js";
import type { FocusPanel, TrackName, CCParam } from "./types.js";
import { TRACK_NAMES } from "./types.js";

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
  const acActiveRef = useRef(false);

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
      case "vel":
        actions.setVel(normalizeTrack(parts[1] ?? "") as TrackName, parseInt(parts[2] ?? "", 10), parseInt(parts[3] ?? "", 10))
          .catch(dispatchError); break;
      case "gate":
        actions.setGate(normalizeTrack(parts[1] ?? ""), parseInt(parts[2] ?? "", 10), parseInt(parts[3] ?? "", 10))
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
      case "load":
        if (parts[1]) fetch(`${baseUrl}/patterns/${encodeURIComponent(parts[1])}`)
          .then(r => { if (!r.ok) actions.addLog(`Pattern "${parts[1]}" not found`); });
        break;
      case "fill":
        if (parts[1]) actions.queueFill(parts[1]).catch((err: Error) => actions.addLog(`Error: ${err.message}`));
        break;
      case "patterns": {
        const filterTag = parts[1]?.startsWith("#") ? parts[1].slice(1) : null;
        fetch(`${baseUrl}/patterns`).then(r => r.json())
          .then((d: { patterns: Array<{ name: string; tags: string[] }> }) => {
            const list = filterTag ? d.patterns.filter(p => p.tags.includes(filterTag)) : d.patterns;
            if (list.length === 0) actions.addLog(filterTag ? `No patterns tagged #${filterTag}.` : "No saved patterns.");
            else list.forEach(p => actions.addLog(`  ${p.name}${p.tags.length ? `  [${p.tags.join(", ")}]` : ""}`));
          });
        break;
      }
      case "chain": {
        const autoFlag = parts.includes("--auto");
        const names = parts.slice(1).filter((p) => p !== "--auto");
        if (names.length === 0) {
          actions.addLog("usage: /chain <p1> <p2> ... [--auto]  — define a setlist");
          return;
        }
        try {
          actions.setChain(names, autoFlag).then(() => {
            actions.addLog(
              `chain set: ${names.join(" → ")}${autoFlag ? "  (auto)" : ""}`
            );
          }).catch(() => {
            actions.addLog("chain: one or more patterns not found in library");
          });
        } catch {
          actions.addLog("chain: one or more patterns not found in library");
        }
        return;
      }
      case "chain-next":
        actions.chainNext().then(() => {
          actions.addLog("chain: queuing next pattern at bar boundary");
        }).catch(() => {
          actions.addLog("chain: end of chain (use --auto to loop)");
        });
        return;
      case "chain-status": {
        const { chain, chain_index, chain_auto } = state;
        if (chain.length === 0) {
          actions.addLog("no chain defined — use /chain <p1> <p2> ...");
        } else {
          const pos = chain_index < 0 ? "unstarted" : `${chain_index + 1}/${chain.length}`;
          actions.addLog(
            `chain [${pos}]: ${chain.join(" → ")}${chain_auto ? "  (auto)" : ""}`
          );
        }
        return;
      }
      case "chain-clear":
        actions.chainClear().then(() => {
          actions.addLog("chain cleared");
        });
        return;
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
  }, [actions, baseUrl, exit, inputMode, state.track_muted]);

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
      state.is_playing ? actions.stop() : actions.play();
      return;
    }
    if (input === "+") { actions.setBpm(Math.min(400, state.bpm + 1)); return; }
    if (input === "-") { actions.setBpm(Math.max(20,  state.bpm - 1)); return; }

    if (focus === "pattern") {
      if (key.upArrow)   setPatternTrack((t) => clamp(t - 1, 0, 7));
      if (key.downArrow) setPatternTrack((t) => clamp(t + 1, 0, 7));
      if (input === "m") {
        const track = TRACK_NAMES[patternTrack];
        if (track) actions.setMute(track, !state.track_muted[track]);
      }
      // q: stage selected track for queued mute (toggle)
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
      // Q (Shift+Q): fire all staged mutes via /mute-queued
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
        const param = state.ccParams[ccParam - 1]?.name ?? "";

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
          setCCSelectedStep((s) => clamp(s + (key.rightArrow ? 1 : -1), 0, 15));
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
      if (key.upArrow)   setCCParam((p) => clamp(p - 1, 0, state.ccParams.length));
      if (key.downArrow) setCCParam((p) => clamp(p + 1, 0, state.ccParams.length));

      if (input === "[") { setCCTrack((t) => clamp(t - 1, 0, 7)); return; }
      if (input === "]") { setCCTrack((t) => clamp(t + 1, 0, 7)); return; }

      // Enter step-edit mode for the selected CC param (not velocity row)
      if ((input === "e" || key.return) && ccParam > 0) {
        setCCStepMode(true);
        setCCSelectedStep(0);
        setCCStepInputBuffer("");
        return;
      }

      if (key.leftArrow || key.rightArrow) {
        const sign = (key.rightArrow ? 1 : -1) * (key.shift ? 10 : 1);
        const track = TRACK_NAMES[ccTrack];
        if (ccParam === 0) {
          // velocity row
          if (track) {
            const current = state.track_velocity[track] ?? 127;
            actions.setVelocity(track, clamp(current + sign, 0, 127));
          }
        } else {
          const param = state.ccParams[ccParam - 1]?.name;
          if (track && param) {
            const current = state.track_cc[track][param] ?? 64;
            actions.setCC(track, param as CCParam, clamp(current + sign, 0, 127));
          }
        }
      }
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        bpm={state.bpm}
        swing={state.swing}
        isPlaying={state.is_playing}
        midiPort={state.midi_port_name}
        midiConnected={state.midi_connected}
        generationStatus={state.generation_status}
        fillActive={state.fill_active}
        fillQueued={state.fill_queued}
        muteCount={Object.values(state.track_muted).filter(Boolean).length}
      />
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          <PatternGrid
            pattern={state.current_pattern}
            trackMuted={state.track_muted}
            selectedTrack={patternTrack}
            isFocused={focus === "pattern"}
            currentStep={state.current_step}
            patternLength={state.pattern_length}
            condMap={(state.current_pattern as Record<string, unknown>)["cond"] as Record<string, (string | null)[]> | undefined}
            probMap={(state.current_pattern as Record<string, unknown>)["prob"] as Record<string, number[]> | undefined}
            pendingMuteTracks={pendingMuteTracks}
          />
          <CCPanel
            ccParams={state.ccParams}
            trackCC={state.track_cc}
            trackVelocity={state.track_velocity}
            stepCC={state.step_cc}
            selectedTrack={ccTrack}
            selectedParam={ccParam}
            isFocused={focus === "cc"}
            stepMode={ccStepMode}
            selectedStep={ccSelectedStep}
            stepInputBuffer={ccStepInputBuffer}
          />
          <Prompt
            isFocused={focus === "prompt"}
            generationStatus={state.generation_status}
            generationError={state.generation_error}
            onCommand={handleCommand}
            showHelp={showHelp}
            onClearHelp={() => setShowHelp(false)}
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
            <Text color="gray">
              {"Tab/'/': panel · ↑↓: navigate · m: mute · q/Q: queue/fire · ←→: adjust · [ ]: CC track · Space: play/stop · +/-: BPM · Ctrl+C: quit"}
            </Text>
          </Box>
        </Box>
        {showLog && (
          <Box width={Math.max(44, Math.round((stdout?.columns ?? 120) * 0.33))}>
            <ActivityLog
              log={state.log}
              isFocused={focus === "log"}
              maxVisible={Math.max(8, 17 + state.ccParams.length)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
