import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useDigitakt } from "./hooks/useDigitakt.js";
import { Header } from "./components/Header.js";
import { PatternGrid } from "./components/PatternGrid.js";
import { CCPanel } from "./components/CCPanel.js";
import { Prompt } from "./components/Prompt.js";
import type { FocusPanel, TrackName, CCParam } from "./types.js";
import { TRACK_NAMES, CC_PARAMS } from "./types.js";

interface AppProps { baseUrl: string; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function App({ baseUrl }: AppProps) {
  const { exit } = useApp();
  const [state, actions] = useDigitakt(baseUrl);

  const [focus, setFocus]               = useState<FocusPanel>("pattern");
  const [patternTrack, setPatternTrack] = useState(0);
  const [ccTrack, setCCTrack]           = useState(0);
  const [ccParam, setCCParam]           = useState(0);

  const handleCommand = useCallback((cmd: string) => {
    const parts = cmd.trim().split(/\s+/);
    const verb = parts[0]?.toLowerCase();
    switch (verb) {
      case "play":  actions.play(); break;
      case "stop":  actions.stop(); break;
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
      default:
        if (cmd.trim()) actions.generate(cmd.trim());
    }
  }, [actions, baseUrl]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") { exit(); return; }
    if (key.tab) {
      setFocus((f) => f === "pattern" ? "cc" : f === "cc" ? "prompt" : "pattern");
      return;
    }
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
      if (key.upArrow)   setCCParam((p) => clamp(p - 1, 0, 7));
      if (key.downArrow) setCCParam((p) => clamp(p + 1, 0, 7));

      if (input === "[") { setCCTrack((t) => clamp(t - 1, 0, 7)); return; }
      if (input === "]") { setCCTrack((t) => clamp(t + 1, 0, 7)); return; }

      if (key.leftArrow || key.rightArrow) {
        const sign = key.rightArrow ? 1 : -1;
        const track = TRACK_NAMES[ccTrack];
        const param = CC_PARAMS[ccParam];
        if (track && param) {
          const current = state.track_cc[track][param as CCParam];
          actions.setCC(track, param as CCParam, clamp(current + sign, 0, 127));
        }
      }
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        bpm={state.bpm}
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
        selectedTrack={ccTrack}
        selectedParam={ccParam}
        isFocused={focus === "cc"}
      />
      <Prompt
        isFocused={focus === "prompt"}
        generationStatus={state.generation_status}
        generationError={state.generation_error}
        onCommand={handleCommand}
      />
      <Box paddingX={1}>
        <Text color="gray">
          {"Tab: switch panel · ↑↓: navigate · m: mute (pattern) · ←→: adjust CC · [/]: track · Space: play/stop · +/-: BPM · Ctrl+C: quit"}
        </Text>
      </Box>
    </Box>
  );
}
