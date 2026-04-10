import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

const HELP_LINES = [
  "Commands (slash prefix optional):",
  "  play / stop                          start or stop playback",
  "  bpm <n>                              set BPM (20–400)",
  "  swing <n>                            set swing 0–100",
  "  prob <track> <step> <value>          step probability 0–100 (step 1-indexed)",
  "  vel <track> <step> <value>           step velocity 0–127 (step 1-indexed)",
  "  random <track|all> <velocity|prob> [lo-hi]  randomize",
  "  cc <track> <param> <value>           send CC 0–127",
  "  mute <track>                         toggle mute (use /mute via CLI only)",
  "  save <name> / load <name>            pattern persistence",
  "  help                                 show this help",
  "  quit / q                             exit",
  "  <bare text>                          send to Claude LLM",
  "",
  "Press any key to dismiss.",
];

interface PromptProps {
  isFocused: boolean;
  generationStatus: "idle" | "generating" | "failed";
  generationError: string | null;
  onCommand(cmd: string): void;
  showHelp: boolean;
  onClearHelp(): void;
}

export function Prompt({ isFocused, generationStatus, generationError, onCommand, showHelp, onClearHelp }: PromptProps) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  useInput((input, key) => {
    if (!isFocused) return;

    if (showHelp) {
      onClearHelp();
      return;
    }

    if (key.return) {
      const trimmed = text.trim();
      if (!trimmed) return;
      setHistory((h) => [trimmed, ...h].slice(0, 50));
      setHistIdx(-1);
      setText("");
      onCommand(trimmed);
      return;
    }
    if (key.backspace || key.delete) { setText((t) => t.slice(0, -1)); return; }
    if (key.upArrow) {
      setHistIdx((idx) => {
        const next = Math.min(idx + 1, history.length - 1);
        setText(history[next] ?? "");
        return next;
      });
      return;
    }
    if (key.downArrow) {
      setHistIdx((idx) => {
        const next = Math.max(idx - 1, -1);
        setText(next === -1 ? "" : (history[next] ?? ""));
        return next;
      });
      return;
    }
    if (input && !key.ctrl && !key.meta) setText((t) => t + input);
  }, { isActive: isFocused });

  if (showHelp) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {HELP_LINES.map((line, i) => (
          <Text key={i} color={i === 0 ? "cyan" : line.startsWith("  ") ? "white" : "gray"}>{line || " "}</Text>
        ))}
      </Box>
    );
  }

  const statusLine =
    generationStatus === "generating" ? "⟳ generating…"
    : generationStatus === "failed"   ? `✗ ${generationError ?? "generation failed"}`
    : "";

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Box>
        <Text bold color="cyan">› </Text>
        <Text>{text}</Text>
        {isFocused && <Text backgroundColor="white" color="black"> </Text>}
      </Box>
      {statusLine
        ? <Text color={generationStatus === "failed" ? "red" : "yellow"}>{statusLine}</Text>
        : <Text color="gray">{"type a prompt · or: prob/vel/swing/random/cc/bpm/play/stop/save/load/help/quit"}</Text>
      }
    </Box>
  );
}
