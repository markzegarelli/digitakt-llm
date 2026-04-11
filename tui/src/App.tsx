import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useDigitakt } from "./hooks/useDigitakt.js";
import { Header } from "./components/Header.js";
import { PatternGrid } from "./components/PatternGrid.js";
import { CCPanel } from "./components/CCPanel.js";
import { ActivityLog } from "./components/ActivityLog.js";
import { Prompt } from "./components/Prompt.js";
import type { FocusPanel, TrackName, CCParam } from "./types.js";
import { TRACK_NAMES, CC_PARAMS } from "./types.js";

// CC panel row indices: 0 = velocity, 1–8 = CC_PARAMS
const CC_PANEL_MAX = CC_PARAMS.length; // 8, so valid range is 0–8

interface AppProps { baseUrl: string; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Map UI display labels → canonical API track names
const TRACK_ALIASES: Record<string, TrackName> = {
  ophat:  "openhat",
  cymbl:  "cymbal",
};

function normalizeTrack(raw: string): string {
  const lower = raw.toLowerCase();
  return TRACK_ALIASES[lower] ?? lower;
}

// Accept common shorthand for the two /random param values
function normalizeRandomParam(raw: string): string {
  if (raw === "vel" || raw === "v" || raw === "velocity") return "velocity";
  if (raw === "p")                                         return "prob";
  return raw;
}

function parseRange(rangeStr: string | undefined, param: string): [number, number] {
  if (!rangeStr) {
    return param === "prob" ? [0, 100] : [0, 127];
  }
  // Strip optional brackets and parse "lo-hi" format
  const cleaned = rangeStr.replace(/^\[|\]$/g, "");
  const dashIdx = cleaned.indexOf("-");
  if (dashIdx > 0) {
    const lo = parseInt(cleaned.slice(0, dashIdx), 10);
    const hi = parseInt(cleaned.slice(dashIdx + 1), 10);
    if (!isNaN(lo) && !isNaN(hi)) return [lo, hi];
  }
  const single = parseInt(cleaned, 10);
  if (!isNaN(single)) return [single, param === "prob" ? 100 : 127];
  return param === "prob" ? [0, 100] : [0, 127];
}

export function App({ baseUrl }: AppProps) {
  const { exit } = useApp();
  const [state, actions] = useDigitakt(baseUrl);

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
  const [askPending, setAskPending]     = useState(false);
  const [inputMode, setInputMode]       = useState<"beat" | "chat">("beat");
  const [showHistory, setShowHistory]   = useState(false);

  const handleCommand = useCallback((cmd: string) => {
    const stripped = cmd.startsWith("/") ? cmd.slice(1) : cmd;
    const parts = stripped.trim().split(/\s+/);
    const verb = parts[0]?.toLowerCase();

    switch (verb) {
      case "play":
        actions.play();
        break;
      case "stop":
        actions.stop();
        break;
      case "quit":
      case "q":
        exit();
        setTimeout(() => process.exit(0), 50);
        break;
      case "bpm": {
        const v = parseFloat(parts[1] ?? "");
        if (!isNaN(v) && v >= 20 && v <= 400) actions.setBpm(v);
        else actions.addLog("Usage: /bpm <20-400>");
        break;
      }
      case "save": {
        const name = parts[1];
        if (!name) {
          actions.addLog("Usage: /save <name> [#tag1 #tag2]");
          return;
        }
        const tags = parts.slice(2)
          .filter(p => p.startsWith("#"))
          .map(p => p.slice(1));
        fetch(`${baseUrl}/patterns/${encodeURIComponent(name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags }),
        }).then(() => actions.addLog(`Saved "${name}"${tags.length ? `  [${tags.join(", ")}]` : ""}`));
        break;
      }
      case "load": {
        if (parts[1]) {
          fetch(`${baseUrl}/patterns/${encodeURIComponent(parts[1])}`)
            .then(r => { if (!r.ok) actions.addLog(`Pattern "${parts[1]}" not found`); });
        }
        break;
      }
      case "patterns": {
        const filterTag = parts[1]?.startsWith("#") ? parts[1].slice(1) : null;
        fetch(`${baseUrl}/patterns`)
          .then(r => r.json())
          .then((d: { patterns: Array<{ name: string; tags: string[] }> }) => {
            const list = filterTag
              ? d.patterns.filter(p => p.tags.includes(filterTag))
              : d.patterns;
            if (list.length === 0) {
              actions.addLog(filterTag ? `No patterns tagged #${filterTag}.` : "No saved patterns.");
            } else {
              list.forEach(p =>
                actions.addLog(`  ${p.name}${p.tags.length ? `  [${p.tags.join(", ")}]` : ""}`)
              );
            }
          });
        break;
      }
      case "fill": {
        const name = parts[1];
        if (!name) {
          actions.addLog("Usage: /fill <pattern-name>");
          return;
        }
        actions.queueFill(name).catch((err: Error) => actions.addLog(`Error: ${err.message}`));
        break;
      }
      case "swing": {
        const amount = parseInt(parts[1] ?? "", 10);
        if (!isNaN(amount) && amount >= 0 && amount <= 100) actions.setSwing(amount);
        break;
      }
      case "length": {
        const steps = parseInt(parts[1] ?? "", 10);
        if (![8, 16, 32].includes(steps)) {
          actions.addLog("Usage: /length [8|16|32]");
          return;
        }
        fetch(`${baseUrl}/length`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps }),
        });
        break;
      }
      case "prob": {
        const track = normalizeTrack(parts[1] ?? "") as TrackName;
        const step = parseInt(parts[2] ?? "", 10);
        const value = parseInt(parts[3] ?? "", 10);
        if (track && !isNaN(step) && !isNaN(value)) actions.setProb(track, step, value);
        else actions.addLog("Usage: /prob <track> <step 1-16> <0-100>");
        break;
      }
      case "vel": {
        const track = normalizeTrack(parts[1] ?? "") as TrackName;
        const step = parseInt(parts[2] ?? "", 10);
        const value = parseInt(parts[3] ?? "", 10);
        if (track && !isNaN(step) && !isNaN(value)) actions.setVel(track, step, value);
        else actions.addLog("Usage: /vel <track> <step 1-16> <0-127>");
        break;
      }
      case "gate": {
        // /gate <track> <step 1-32> <0-100>
        const [, trackArg, stepArg, valArg] = parts;
        const stepN = parseInt(stepArg ?? "", 10);
        const valN = parseInt(valArg ?? "", 10);
        if (!trackArg || isNaN(stepN) || isNaN(valN)) {
          actions.addLog("Usage: /gate <track> <step> <0-100>");
          return;
        }
        actions.setGate(normalizeTrack(trackArg), stepN, valN)
          .catch(() => actions.addLog("Error setting gate"));
        break;
      }
      case "pitch": {
        // /pitch <track> <0-127>
        const [, trackArg, valArg] = parts;
        const valN = parseInt(valArg ?? "", 10);
        if (!trackArg || isNaN(valN) || valN < 0 || valN > 127) {
          actions.addLog("Usage: /pitch <track> <0-127>");
          return;
        }
        actions.setPitch(normalizeTrack(trackArg), valN)
          .catch(() => actions.addLog("Error setting pitch"));
        break;
      }
      case "cond": {
        // /cond <track> <step 1-32> <1:2|not:2|fill|clear>
        const [, trackArg, stepArg, condArg] = parts;
        const stepN = parseInt(stepArg ?? "", 10);
        if (!trackArg || isNaN(stepN) || !condArg) {
          actions.addLog("Usage: /cond <track> <step> <1:2|not:2|fill|clear>");
          return;
        }
        const condValue = condArg === "clear" ? null : condArg;
        if (condValue !== null && !["1:2", "not:2", "fill"].includes(condValue)) {
          actions.addLog("Condition must be: 1:2, not:2, fill, or clear");
          return;
        }
        actions.setCond(normalizeTrack(trackArg), stepN, condValue)
          .catch(() => actions.addLog("Error setting condition"));
        break;
      }
      case "random": {
        const track = normalizeTrack(parts[1] ?? "all");
        const param = normalizeRandomParam(parts[2] ?? "velocity");
        const [lo, hi] = parseRange(parts[3], param);
        if (param === "velocity" || param === "prob") {
          actions.randomize(track, param, lo, hi);
        }
        break;
      }
      case "randbeat":
        actions.randbeat();
        break;
      case "log":
        setShowLog((v) => !v);
        break;
      case "cc": {
        const track = normalizeTrack(parts[1] ?? "") as TrackName;
        const param = parts[2] as CCParam;
        const value = parseInt(parts[3] ?? "", 10);
        if (track && param && !isNaN(value)) actions.setCC(track, param, value);
        else actions.addLog("Usage: /cc <track> <param> <0-127>");
        break;
      }
      case "help":
        setShowHelp(true);
        setFocus("prompt");
        break;
      case "new":
        actions.callNew();
        break;
      case "undo":
        actions.callUndo();
        break;
      case "clear":
        actions.clearLog();
        break;
      case "history":
        setShowHistory(true);
        setFocus("prompt");
        break;
      case "mode": {
        const m = parts[1]?.toLowerCase();
        if (m === "chat" || m === "beat") setInputMode(m);
        break;
      }
      case "gen": {
        if (answerText) {
          actions.generate(answerText);
        } else {
          actions.addLog("✗ No ask response to generate from. Use /ask first.");
        }
        break;
      }
      case "ask": {
        const question = parts.slice(1).join(" ");
        if (question) {
          setAskPending(true);
          setFocus("prompt");
          actions.ask(question).then((answer) => {
            setAskPending(false);
            setAnswerText(answer);
          }).catch(() => {
            setAskPending(false);
            setAnswerText("Error: could not get answer. Check your API key and connection.");
          });
        }
        break;
      }
      case "cc-step": {
        const track = normalizeTrack(parts[1] ?? "") as TrackName;
        const param = parts[2] as CCParam;
        const step = parseInt(parts[3] ?? "", 10);
        const value = parseInt(parts[4] ?? "", 10);
        if (track && param && !isNaN(step) && !isNaN(value)) {
          actions.setCCStep(track, param, step, value === -1 ? null : value);
        } else {
          actions.addLog("Usage: /cc-step <track> <param> <step 1-16> <0-127|-1>");
        }
        break;
      }
      default:
        if (cmd.startsWith("/")) {
          actions.addLog(`✗ Unknown command: "/${verb}". Type /help for commands.`);
          return;
        }
        if (stripped.trim()) {
          if (inputMode === "chat") {
            const question = stripped.trim();
            setAskPending(true);
            setFocus("prompt");
            actions.ask(question).then((answer) => {
              setAskPending(false);
              setAnswerText(answer);
            }).catch(() => {
              setAskPending(false);
              setAnswerText("Error: could not get answer. Check your API key and connection.");
            });
          } else {
            actions.generate(stripped.trim());
          }
        }
    }
  }, [actions, baseUrl, exit, inputMode]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      setTimeout(() => process.exit(0), 50);
      return;
    }
    if (key.tab) {
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
      return;
    }

    if (focus === "cc") {
      if (ccStepMode) {
        const track = TRACK_NAMES[ccTrack] as TrackName;
        const param = CC_PARAMS[ccParam - 1] as CCParam;

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
            const sign = key.upArrow ? 1 : -1;
            actions.setCCStep(track, param, ccSelectedStep + 1, clamp(current + sign, 0, 127));
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
      if (key.upArrow)   setCCParam((p) => clamp(p - 1, 0, CC_PANEL_MAX));
      if (key.downArrow) setCCParam((p) => clamp(p + 1, 0, CC_PANEL_MAX));

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
        const sign = key.rightArrow ? 1 : -1;
        const track = TRACK_NAMES[ccTrack];
        if (ccParam === 0) {
          // velocity row
          if (track) {
            const current = state.track_velocity[track] ?? 127;
            actions.setVelocity(track, clamp(current + sign, 0, 127));
          }
        } else {
          const param = CC_PARAMS[ccParam - 1];
          if (track && param) {
            const current = state.track_cc[track][param as CCParam];
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
        connected={state.connected}
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
          />
          <CCPanel
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
          />
          <Box paddingX={1}>
            <Text color="gray">
              {"Tab/'/': panel · ↑↓: navigate · m: mute · ←→: adjust · [/]: CC track · Space: play/stop · +/-: BPM · Ctrl+C: quit"}
            </Text>
          </Box>
        </Box>
        {showLog && (
          <Box width={44}>
            <ActivityLog
              log={state.log}
              isFocused={focus === "log"}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
