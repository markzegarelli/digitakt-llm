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
  "  randbeat                             random techno beat (BPM + CC randomized)",
  "  cc <track> <param> <value>           send CC 0–127 globally",
  "  cc-step <track> <param> <step> <v>  per-step CC override (-1 to clear)",
  "  mute <track>                         toggle mute (use /mute via CLI only)",
  "  log                                  toggle activity log panel",
  "  save <name> / load <name>            pattern persistence",
  "  ask <question>                       ask Claude about the tool",
  "  help                                 show this help",
  "  quit / q                             exit",
  "  <bare text>                          send to Claude LLM",
  "  ?<question>                          shorthand for /ask",
  "",
  "CC panel: Tab to focus · Enter on param = step edit mode · Esc to exit",
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
  answerText: string | null;
  askPending: boolean;
  onClearAnswer(): void;
}

export function Prompt({
  isFocused,
  generationStatus,
  generationError,
  onCommand,
  showHelp,
  onClearHelp,
  answerText,
  askPending,
  onClearAnswer,
}: PromptProps) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  useInput((input, key) => {
    if (!isFocused) return;

    if (answerText !== null) {
      onClearAnswer();
      return;
    }

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

  if (answerText !== null) {
    const lines = answerText.split("\n");
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Answer  (press any key to dismiss)</Text>
        {lines.map((line, i) => (
          <Text key={i} color="white">{line || " "}</Text>
        ))}
      </Box>
    );
  }

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
    askPending                           ? "⟳ asking…"
    : generationStatus === "generating" ? "⟳ generating…"
    : generationStatus === "failed"     ? `✗ ${generationError ?? "generation failed"}`
    : "";

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? "cyan" : "gray"} paddingX={1}>
      <Box>
        <Text bold color="cyan">› </Text>
        <Text>{text}</Text>
        {isFocused && <Text backgroundColor="white" color="black"> </Text>}
      </Box>
      {statusLine
        ? <Text color={askPending ? "yellow" : generationStatus === "failed" ? "red" : "yellow"}>{statusLine}</Text>
        : <Text color="gray">{"type a prompt · or: prob/vel/swing/random/randbeat/cc/cc-step/bpm/play/stop/log/ask/help/quit"}</Text>
      }
    </Box>
  );
}
