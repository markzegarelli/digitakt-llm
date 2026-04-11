import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";

const HELP_LINES = [
  "── Playback & Pattern ─────────────────────────────────────────",
  "  play / stop                          start or stop playback",
  "  bpm <n>                              set BPM (20–400)",
  "  swing <n>                            set swing 0–100",
  "  length [8|16|32]                     set pattern step count",
  "  prob <track> <step> <value>          step probability 0–100 (1-indexed)",
  "  vel <track> <step> <value>           step velocity 0–127 (1-indexed)",
  "  gate <track> <step> <0-100>          note gate length (% of step duration)",
  "  pitch <track> <0-127>                MIDI note number for track",
  "  cond <track> <step> <1:2|not:2|fill|clear>  conditional trig",
  "  random <track|all> <vel|prob> [lo-hi]  randomize",
  "  randbeat                             random techno beat",
  "  cc <track> <param> <value>           CC 0–127 globally",
  "  cc-step <track> <param> <step> <v>  per-step CC override (-1 to clear)",
  "  save <name> [#tag1 #tag2]            save pattern with optional tags",
  "  load <name>                          queue saved pattern for next loop",
  "  patterns [#tag]                      list saved patterns (filter by tag)",
  "  fill <name>                          one-shot fill (plays once, reverts)",
  "  log                                  toggle activity log",
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
  "  m (Pattern panel)                    toggle mute on selected track",
  "  M (Pattern panel)                    stage track for queued mute (Shift+M, toggle)",
  "  Shift+Enter (Pattern panel)          fire all staged mutes at next bar boundary",
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
  historyItems: Array<{ prompt: string; timestamp: number; bpm?: number; length?: number; swing?: number }>;
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
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const genStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (generationStatus === "generating" || askPending) {
      if (genStartRef.current === null) genStartRef.current = Date.now();
      const id = setInterval(() => {
        setElapsedSecs(Math.floor((Date.now() - (genStartRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      genStartRef.current = null;
      setElapsedSecs(0);
    }
  }, [generationStatus, askPending]);

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
          const meta: string[] = [];
          if (entry.bpm    !== undefined) meta.push(`BPM:${entry.bpm}`);
          if (entry.length !== undefined) meta.push(`Len:${entry.length}`);
          if (entry.swing  !== undefined) meta.push(`Swing:${entry.swing}`);
          const metaStr = meta.length > 0 ? ` | ${meta.join(" ")}` : "";
          return `${i + 1}. [${time}] ${entry.prompt}${metaStr}`;
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
    askPending                           ? `⟳ asking… (${elapsedSecs}s)`
    : generationStatus === "generating" ? `⟳ generating… (${elapsedSecs}s)`
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
        : <Text color="gray">{"type a prompt · /help for commands · Shift+Tab: toggle mode"}</Text>
      }
    </Box>
  );
}
