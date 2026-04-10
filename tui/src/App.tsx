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
  const [showHelp, setShowHelp]         = useState(false);
  const [showLog, setShowLog]           = useState(false);

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
        break;
      case "bpm": {
        const v = parseFloat(parts[1] ?? "");
        if (!isNaN(v) && v >= 20 && v <= 400) actions.setBpm(v);
        break;
      }
      case "save":
        if (parts[1]) fetch(`${baseUrl}/patterns/${parts[1]}`, { method: "POST" });
        break;
      case "load":
        if (parts[1]) fetch(`${baseUrl}/patterns/${parts[1]}`);
        break;
      case "swing": {
        const amount = parseInt(parts[1] ?? "", 10);
        if (!isNaN(amount) && amount >= 0 && amount <= 100) actions.setSwing(amount);
        break;
      }
      case "prob": {
        const track = parts[1] as TrackName;
        const step = parseInt(parts[2] ?? "", 10);
        const value = parseInt(parts[3] ?? "", 10);
        if (track && !isNaN(step) && !isNaN(value)) actions.setProb(track, step, value);
        break;
      }
      case "vel": {
        const track = parts[1] as TrackName;
        const step = parseInt(parts[2] ?? "", 10);
        const value = parseInt(parts[3] ?? "", 10);
        if (track && !isNaN(step) && !isNaN(value)) actions.setVel(track, step, value);
        break;
      }
      case "random": {
        const track = parts[1] ?? "all";
        const param = parts[2] ?? "velocity";
        const [lo, hi] = parseRange(parts[3], param);
        actions.randomize(track, param, lo, hi);
        break;
      }
      case "randbeat":
        actions.randbeat();
        break;
      case "log":
        setShowLog((v) => !v);
        break;
      case "cc": {
        const track = parts[1] as TrackName;
        const param = parts[2] as CCParam;
        const value = parseInt(parts[3] ?? "", 10);
        if (track && param && !isNaN(value)) actions.setCC(track, param, value);
        break;
      }
      case "help":
        setShowHelp(true);
        setFocus("prompt");
        break;
      default:
        if (stripped.trim()) actions.generate(stripped.trim());
    }
  }, [actions, baseUrl, exit]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") { exit(); return; }
    if (key.tab) {
      setFocus((f) => {
        if (f === "pattern") return "cc";
        if (f === "cc") return showLog ? "log" : "prompt";
        if (f === "log") return "prompt";
        return "pattern";
      });
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
      if (key.upArrow)   setCCParam((p) => clamp(p - 1, 0, CC_PANEL_MAX));
      if (key.downArrow) setCCParam((p) => clamp(p + 1, 0, CC_PANEL_MAX));

      if (input === "[") { setCCTrack((t) => clamp(t - 1, 0, 7)); return; }
      if (input === "]") { setCCTrack((t) => clamp(t + 1, 0, 7)); return; }

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
      />
      <PatternGrid
        pattern={state.current_pattern}
        trackMuted={state.track_muted}
        selectedTrack={patternTrack}
        isFocused={focus === "pattern"}
      />
      <CCPanel
        trackCC={state.track_cc}
        trackVelocity={state.track_velocity}
        selectedTrack={ccTrack}
        selectedParam={ccParam}
        isFocused={focus === "cc"}
      />
      {showLog && (
        <ActivityLog
          log={state.log}
          isFocused={focus === "log"}
        />
      )}
      <Prompt
        isFocused={focus === "prompt"}
        generationStatus={state.generation_status}
        generationError={state.generation_error}
        onCommand={handleCommand}
        showHelp={showHelp}
        onClearHelp={() => setShowHelp(false)}
      />
      <Box paddingX={1}>
        <Text color="gray">
          {"Tab/'/': panel · ↑↓: navigate · m: mute · ←→: adjust · [/]: CC track · Space: play/stop · +/-: BPM · Ctrl+C: quit"}
        </Text>
      </Box>
    </Box>
  );
}
