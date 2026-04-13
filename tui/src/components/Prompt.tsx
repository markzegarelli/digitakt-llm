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
  "  gen                                  generate from last /ask response",
  "  Ctrl+G                               generate while viewing an /ask answer",
  "                                       or any time after an /ask (hint shown)",
  "  mode [chat|beat]                     switch input mode",
  "",
  "── App ────────────────────────────────────────────────────────",
  "  help                                 show this help",
  "  quit / q                             exit",
  "  Shift+Tab                            toggle Chat/Beat mode",
  "  m (Pattern panel)                    toggle mute on selected track",
  "  q (Pattern panel)                    stage selected track for queued mute (toggle)",
  "  Q (Pattern panel)                    fire all staged mutes at next bar boundary (Shift+Q)",
  "",
  "CC panel: Tab to focus · Enter on param = step edit · Esc to exit",
  "",
  "── Trig Dot Shapes & Colors ───────────────────────────────────",
  "",
  "Press any key to dismiss.",
];

// All slash commands for autocomplete
const COMMANDS = [
  "ask", "bpm", "cc", "cc-step", "clear", "cond", "fill", "gate",
  "gen", "help", "history", "length", "load", "log", "mode", "mute",
  "new", "patterns", "pitch", "play", "prob", "quit", "random",
  "randbeat", "save", "stop", "swing", "undo", "vel",
];

function getSuggestions(text: string): string[] {
  if (!text.startsWith("/")) return [];
  const query = text.slice(1);
  if (query.includes(" ")) return [];  // past the command name
  return COMMANDS.filter((c) => c.startsWith(query)).slice(0, 7);
}

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
  implementableHint: boolean;
  onDismissHint(): void;
  acActiveRef: React.MutableRefObject<boolean>;
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
  implementableHint,
  onDismissHint,
  acActiveRef,
}: PromptProps) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);
  const [acIdx, setAcIdx] = useState(-1);
  const genStartRef = useRef<number | null>(null);

  // Update text + autocomplete state atomically
  function updateText(newText: string) {
    const suggs = getSuggestions(newText);
    setText(newText);
    setAcSuggestions(suggs);
    setAcIdx(-1);
    acActiveRef.current = suggs.length > 0;
  }

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

    // Escape: dismiss autocomplete
    if (key.escape) {
      if (acSuggestions.length > 0) {
        setAcSuggestions([]);
        setAcIdx(-1);
        acActiveRef.current = false;
      }
      return;
    }

    // Tab: cycle autocomplete suggestions (App.tsx Tab guard prevents focus switch)
    if (key.tab) {
      if (acSuggestions.length > 0) {
        setAcIdx((i) => (i + 1) % acSuggestions.length);
      }
      return;
    }

    if (key.return) {
      // If a suggestion is highlighted, complete the command (don't submit yet)
      if (acSuggestions.length > 0 && acIdx >= 0) {
        const chosen = acSuggestions[acIdx]!;
        updateText(`/${chosen} `);
        return;
      }
      // If there's exactly one suggestion and user presses Enter, auto-complete it
      if (acSuggestions.length === 1 && acIdx === -1) {
        updateText(`/${acSuggestions[0]!} `);
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;
      setHistory((h) => [trimmed, ...h].slice(0, 50));
      setHistIdx(-1);
      updateText("");
      onCommand(trimmed);
      return;
    }

    if (key.backspace || key.delete) {
      updateText(text.slice(0, -1));
      return;
    }

    if (key.upArrow) {
      // Navigate autocomplete suggestions upward
      if (acSuggestions.length > 0) {
        setAcIdx((i) => Math.max(i - 1, -1));
        return;
      }
      setHistIdx((idx) => {
        const next = Math.min(idx + 1, history.length - 1);
        setText(history[next] ?? "");
        return next;
      });
      return;
    }
    if (key.downArrow) {
      // Navigate autocomplete suggestions downward
      if (acSuggestions.length > 0) {
        setAcIdx((i) => Math.min(i + 1, acSuggestions.length - 1));
        return;
      }
      setHistIdx((idx) => {
        const next = Math.max(idx - 1, -1);
        setText(next === -1 ? "" : (history[next] ?? ""));
        return next;
      });
      return;
    }
    if (input && !key.ctrl && !key.meta) { updateText(text + input); return; }
  }, { isActive: isFocused });

  if (answerText !== null) {
    const lines = answerText.split("\n");
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">{"Answer — Ctrl+G to generate · any key to dismiss"}</Text>
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
        <Box>
          <Text>{"  "}</Text>
          <Text color="blue">{"· "}</Text><Text color="white">{"vel 0 (empty)   "}</Text>
          <Text color="blue">{"○ "}</Text><Text color="white">{"vel 1–63 (low)   "}</Text>
          <Text color="cyan">{"● "}</Text><Text color="white">{"vel 64–127 (high)"}</Text>
          <Text color="gray">{"   (shapes, prob 100%)"}</Text>
        </Box>
        <Box>
          <Text>{"  "}</Text>
          <Text color="yellow">{"● "}</Text><Text color="white">{"prob 75-99%   "}</Text>
          <Text color="magenta">{"● "}</Text><Text color="white">{"prob 50-74%   "}</Text>
          <Text color="red">{"● "}</Text><Text color="white">{"prob <50%"}</Text>
          <Text color="gray">{"   (colors apply to ○ and ● alike)"}</Text>
        </Box>
        <Box>
          <Text>{"  "}</Text>
          <Text color="gray">{"● "}</Text><Text color="white">{"muted/off   "}</Text>
          <Text color="yellow">{"● "}</Text><Text color="white">{"active (playhead)   "}</Text>
          <Text color="magenta">{"◆ "}</Text><Text color="white">{"conditional trig (◇ for low vel)"}</Text>
        </Box>
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
      {/* Autocomplete suggestions — shown above the input line */}
      {acSuggestions.length > 0 && (
        <Box flexDirection="column">
          {acSuggestions.map((cmd, i) => (
            <Text
              key={cmd}
              color={i === acIdx ? "black" : "gray"}
              backgroundColor={i === acIdx ? "cyan" : undefined}
            >{`  /${cmd}`}</Text>
          ))}
        </Box>
      )}
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
      {/* Always rendered to keep prompt height stable — green when active */}
      <Text color={implementableHint ? "green" : undefined}>
        {implementableHint ? "→ Ctrl+G or /gen · generate from last answer" : " "}
      </Text>
    </Box>
  );
}
