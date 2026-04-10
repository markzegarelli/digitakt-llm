import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

const HELP_LINES = [
  "── Playback & Pattern ─────────────────────────────────────────",
  "  play / stop                          start or stop playback",
  "  bpm <n>                              set BPM (20–400)",
  "  swing <n>                            set swing 0–100",
  "  prob <track> <step> <value>          step probability 0–100 (1-indexed)",
  "  vel <track> <step> <value>           step velocity 0–127 (1-indexed)",
  "  random <track|all> <vel|prob> [lo-hi]  randomize",
  "  randbeat                             random techno beat",
  "  cc <track> <param> <value>           CC 0–127 globally",
  "  cc-step <track> <param> <step> <v>  per-step CC override (-1 to clear)",
  "  mute <track>                         toggle track mute",
  "  log                                  toggle activity log",
  "  save <name> / load <name>            pattern persistence",
  "  new                                  reset to empty pattern",
  "  undo                                 revert to previous pattern",
  "  history                              show pattern history",
  "  clear                                clear activity log",
  "",
  "── Chat & Generation ──────────────────────────────────────────",
  "  <bare text>                          generate beat (BEAT mode)",
  "                                       or ask Claude (CHAT mode)",
  "  ask <question>                       ask Claude (any mode)",
  "  mode [chat|beat]                     switch input mode",
  "",
  "── App ────────────────────────────────────────────────────────",
  "  help                                 show this help",
  "  quit / q                             exit",
  "  Shift+Tab                            toggle Chat/Beat mode",
  "",
  "CC panel: Tab to focus · Enter on param = step edit · Esc to exit",
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
  inputMode: "beat" | "chat";
  showHistory: boolean;
  historyItems: Array<{ prompt: string; timestamp: number }>;
  onClearHistory(): void;
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
  inputMode,
  showHistory,
  historyItems,
  onClearHistory,
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

    if (showHistory) {
      onClearHistory();
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

  if (showHistory) {
    const lines = historyItems.length === 0
      ? ["No pattern history."]
      : historyItems.map((entry, i) => {
          const d = new Date(entry.timestamp * 1000);
          const time = d.toLocaleTimeString();
          return `${i + 1}. [${time}] ${entry.prompt}`;
        });
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Pattern History  (press any key to dismiss)</Text>
        {lines.map((line, i) => (
          <Text key={i} color="white">{line}</Text>
        ))}
      </Box>
    );
  }

  if (showHelp) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        {HELP_LINES.map((line, i) => (
          <Text key={i} color={line.startsWith("──") ? "cyan" : line.startsWith("  ") ? "white" : "gray"}>{line || " "}</Text>
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
        <Text bold color={inputMode === "beat" ? "magenta" : "cyan"}>
          [{inputMode.toUpperCase()}]{" "}
        </Text>
        <Text bold color="cyan">› </Text>
        <Text>{text}</Text>
        {isFocused && <Text backgroundColor="white" color="black"> </Text>}
      </Box>
      {statusLine
        ? <Text color={askPending ? "yellow" : generationStatus === "failed" ? "red" : "yellow"}>{statusLine}</Text>
        : <Text color="gray">{"type a prompt · or: prob/vel/swing/random/randbeat/cc/bpm/play/stop/new/undo/history/log/ask/help/quit · Shift+Tab: toggle mode"}</Text>
      }
    </Box>
  );
}
