import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "../theme.js";
import type { PatternModalState, PatternListEntry } from "../types.js";

const HELP_LINES = [
  "── Playback & Pattern ─────────────────────────────────────────",
  "  play / stop                          start or stop playback",
  "  bpm <n>                              set BPM (20–400)",
  "  swing <n>                            set swing 0–100",
  "  length [8|16|32]                     set pattern step count",
  "  prob <track> <value>                 set probability 0–100 on every step for a track",
  "  vel <track> <value>                  set velocity 0–127 on every step for a track",
  "  gate <track> <0-100>                 set gate length on every step for a track",
  "  pitch <track> <0-127>                MIDI note number for track",
  "  cond <track> <step> <1:2|not:2|fill|clear>  conditional trig",
  "  random <track|all> <vel|prob> [lo-hi]  randomize",
  "  randbeat                             random techno beat",
  "  cc <track> <param> <value>           CC 0–127 globally",
  "  cc-step <track> <param> <step> <v>  per-step CC override (-1 to clear)",
  "  save <name> [#tag1 #tag2]            save pattern with optional tags",
  "  load [name]                          pick saved pattern (↑↓ Enter) or queue by name for next loop",
  "  delete [name]                        delete a saved pattern (confirmation)",
  "  patterns [#tag]                      list saved patterns (filter by tag)",
  "  fill <name>                          one-shot fill (plays once, reverts)",
  "  chain <p1> <p2> ... [--auto]         define setlist",
  "  chain next                           queue next pattern in chain",
  "  chain fire                           arm queued chain pattern for next 1",
  "  chain status                         show chain position",
  "  chain clear                          clear chain state",
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
  "  fresh <prompt>                       generate ignoring prior pattern (no variation context)",
  "  gen                                  generate from last /ask response",
  "  Ctrl+G                               generate while viewing an /ask answer",
  "                                       or any time after an /ask (hint shown)",
  "  mode [chat|beat]                     switch input mode",
  "  next [section]                       context-aware next pattern",
  "  vary [light|medium|heavy]            variation of current pattern",
  "  read                                 Claude describes current pattern",
  "",
  "── App ────────────────────────────────────────────────────────",
  "  help                                 show this help",
  "  ?                                    open help (SEQ/MIX/LOG) or empty CMD line",
  "  quit / q                             exit",
  "  Tab                                  focus rail: SEQ → MIX → CMD (+ LOG if log is on)",
  "  Shift+Tab                            toggle Chat/Beat mode",
  "  m (Pattern panel)                    toggle mute on selected track",
  "  q (Pattern panel)                    stage selected track for queued mute (toggle)",
  "  Q (Pattern panel)                    fire all staged mutes at next bar boundary (Shift+Q)",
  "  c (when chain active)                focus chain strip (←/→ highlight, Esc back)",
  "  n / N (pattern or chain strip)       chain next / arm fire (same as /chain …)",
  "",
  "CC / MIX panel: Tab to focus · Enter on param = step edit · Esc to exit",
  "  Value bar: █ filled / ░ empty (0–127), width scales with terminal size",
  "",
  "── SEQ step grid (blocks + ruler) ────────────────────────────",
  "  Enter (in SEQ)                       toggle SEQ step edit mode",
  "  Space (SEQ step edit)                toggle selected step on/off",
  "  ←/→ or [ / ] (SEQ step edit)         move selected step",
  "  ↑/↓ (SEQ)                            move selected track",
  "  Tab (while SEQ step edit)            open/close TRIG side panel (same as plain t)",
  "  SEQ / MIX                            selected track stays in sync between panels",
  "",
  "TRIG side panel (from SEQ step edit):",
  "  t (SEQ step edit)                    open TRIG if closed; close TRIG if open",
  "  Shift+T (SEQ, any row)               jump into step edit + TRIG + ALL (playhead step when playing)",
  "  Shift+T (TRIG open)                  toggle ALL for prob/vel/gate; if TRIG closed in step edit, opens TRIG + ALL",
  "  ↑/↓                                  navigate trig rows",
  "  ←/→                                  adjust selected value",
  "  Shift+←/→                            adjust selected numeric value by ±10",
  "  [ / ]                                move step (TRIG open or closed in step edit)",
  "  0-9 then Enter                       type/apply numeric value directly",
  "  Esc                                  close TRIG side panel",
  "",
  "LOG panel:",
  "  /log                                 toggle activity log",
  "  ↑/↓ (when LOG focused)               scroll log entries",
  "  Layout: rail + column: SEQ full width; MIX and TRIG share one row below;",
  "          LOG column on the right when /log is on.",
  "",
  "Per-step settings visible/editable from generation output:",
  "  probability (prob), velocity (vel), note/pitch, length (gate), condition (cond)",
  "  ↑↓ PgUp PgDn scroll   Esc or any other key closes",
];

// All slash commands for autocomplete
const COMMANDS = [
  "ask", "bpm", "cc", "cc-step", "clear", "cond", "delete", "fill", "fresh", "gate",
  "gen", "help", "history", "length", "load", "log", "mode", "mute",
  "new", "patterns", "pitch", "play", "prob", "quit", "random",
  "randbeat", "save", "stop", "swing", "undo", "vel",
  "chain", "next", "vary", "read",
];

/** Legend blocks below HELP_LINES (each counts as one scroll row). */
const HELP_LEGEND_ROW_COUNT = 3;

function helpTotalRows(): number {
  return HELP_LINES.length + HELP_LEGEND_ROW_COUNT;
}

function getSuggestions(text: string): string[] {
  if (!text.startsWith("/")) return [];
  const query = text.slice(1);
  if (query.includes(" ")) return [];  // past the command name
  return COMMANDS.filter((c) => c.startsWith(query)).slice(0, 7);
}

function shapePreviewForEntry(entry: PatternListEntry): string {
  const steps = entry.pattern_length ?? 16;
  let seed = 0;
  for (const c of entry.name) seed += c.charCodeAt(0);
  const rows = ["K", "S", "H", "O"];
  return rows
    .map((r) => {
      let line = `${r}  `;
      for (let i = 0; i < steps; i++) {
        const on = ((seed * (r.charCodeAt(0) + 1) + i * 3) % 5) < 2;
        line += on ? "\u2588" : "\u00B7";
        if (i % 4 === 3 && i < steps - 1) line += " ";
      }
      return line;
    })
    .join("\n");
}

function formatTags(tags: string[], maxLen: number): string {
  if (tags.length === 0) return "";
  const s = tags.map((t) => `#${t}`).join(" ");
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}\u2026`;
}

interface PromptProps {
  isFocused: boolean;
  generationStatus: "idle" | "generating" | "failed";
  generationError: string | null;
  onCommand(cmd: string): void;
  patternModal: PatternModalState | null;
  onPatternModalClose(): void;
  onPatternModalNav(dir: number): void;
  onPatternModalPick(): void;
  onDeleteConfirmYes(): void;
  showHelp: boolean;
  onClearHelp(): void;
  onOpenHelp(): void;
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
  patternModal,
  onPatternModalClose,
  onPatternModalNav,
  onPatternModalPick,
  onDeleteConfirmYes,
  showHelp,
  onClearHelp,
  onOpenHelp,
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
  const { stdout } = useStdout();
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);
  const [acIdx, setAcIdx] = useState(-1);
  const [helpScroll, setHelpScroll] = useState(0);
  const genStartRef = useRef<number | null>(null);

  const termRows = stdout?.rows ?? 24;
  const panelBudget = Math.max(8, termRows - 8);
  const totalHelpRows = helpTotalRows();
  const helpNeedsScroll = totalHelpRows > panelBudget;
  const helpChromeLines = helpNeedsScroll ? 1 : 0;
  const helpViewLines = helpNeedsScroll ? Math.max(1, panelBudget - helpChromeLines) : totalHelpRows;
  const helpMaxScroll = Math.max(0, totalHelpRows - helpViewLines);

  useEffect(() => {
    if (!showHelp) return;
    setHelpScroll(0);
  }, [showHelp]);

  useEffect(() => {
    if (!showHelp) return;
    setHelpScroll((s) => Math.min(s, helpMaxScroll));
  }, [showHelp, helpMaxScroll]);

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

    if (patternModal) {
      if (patternModal.phase === "pick") {
        if (key.escape) {
          onPatternModalClose();
          return;
        }
        if (key.upArrow) {
          onPatternModalNav(-1);
          return;
        }
        if (key.downArrow) {
          onPatternModalNav(1);
          return;
        }
        if (key.return) {
          onPatternModalPick();
          return;
        }
        return;
      }
      if (patternModal.phase === "delete-confirm") {
        if (key.escape || input === "n" || input === "N") {
          onPatternModalClose();
          return;
        }
        if (input === "y" || input === "Y") {
          onDeleteConfirmYes();
          return;
        }
        return;
      }
    }

    if (answerText !== null) {
      onClearAnswer();
      return;
    }

    if (showHistory) {
      onClearHistory();
      return;
    }

    if (input === "?" && text.trim() === "" && !showHelp) {
      onOpenHelp();
      return;
    }

    if (showHelp) {
      if (key.upArrow) {
        setHelpScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setHelpScroll((s) => Math.min(helpMaxScroll, s + 1));
        return;
      }
      if (key.pageUp) {
        setHelpScroll((s) => Math.max(0, s - helpViewLines));
        return;
      }
      if (key.pageDown) {
        setHelpScroll((s) => Math.min(helpMaxScroll, s + helpViewLines));
        return;
      }
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

  if (patternModal) {
    if (patternModal.phase === "delete-confirm") {
      return (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.error} paddingX={1}>
          <Text bold color={theme.error}>DELETE PATTERN</Text>
          <Text color={theme.text}>{`Permanently delete "${patternModal.name}"?`}</Text>
          <Text color={theme.textDim}>Y confirm  N or Esc cancel</Text>
        </Box>
      );
    }
    const title = patternModal.intent === "load" ? "LOAD PATTERN" : "DELETE PATTERN";
    const enterHint = patternModal.intent === "load" ? "load selected" : "confirm selection (then Y/N)";
    const entries = patternModal.entries;
    const sel = entries[patternModal.idx];
    const tc = stdout?.columns ?? 100;
    const leftW = Math.max(28, Math.min(52, Math.floor(tc * 0.42)));
    const bpmStr = (e: PatternListEntry) => (e.bpm != null ? e.bpm.toFixed(1) : "—").padStart(6);
    const stpStr = (e: PatternListEntry) => (e.pattern_length != null ? String(e.pattern_length) : "—").padStart(3);
    const swgStr = (e: PatternListEntry) => (e.swing != null ? String(e.swing) : "—").padStart(3);
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.borderActive} paddingX={1}>
        <Text bold color={theme.accent}>{title}</Text>
        <Text color={theme.textDim}>{`↑↓ select · Enter ${enterHint} · Esc cancel`}</Text>
        <Box flexDirection="row" marginTop={1}>
          <Box flexDirection="column" width={leftW}>
            <Text color={theme.textGhost}>
              {`${"NAME".padEnd(14)} ${"BPM".padStart(6)} STP SWG  TAGS`}
            </Text>
            {entries.map((e, i) => {
              const tagStr = formatTags(e.tags, 18);
              const line = `${(i === patternModal.idx ? ">" : " ")} ${e.name.padEnd(12).slice(0, 12)} ${bpmStr(e)} ${stpStr(e)} ${swgStr(e)}  ${tagStr}`;
              return (
                <Text key={`${e.name}-${i}`} color={i === patternModal.idx ? theme.accent : theme.text}>
                  {line.length > leftW ? `${line.slice(0, leftW - 1)}\u2026` : line}
                </Text>
              );
            })}
          </Box>
          <Box flexDirection="column" marginLeft={1} flexGrow={1} minWidth={22}>
            <Text bold color={theme.textDim}>PREVIEW</Text>
            {sel ? (
              <>
                <Text bold color={theme.accent}>{sel.name}</Text>
                <Text color={theme.textFaint}>
                  {`BPM ${sel.bpm?.toFixed(1) ?? "—"}  SWG ${sel.swing ?? "—"}  steps ${sel.pattern_length ?? "—"}`}
                </Text>
                {sel.tags.length > 0 && (
                  <Text color={theme.textDim}>{formatTags(sel.tags, 40)}</Text>
                )}
                <Box marginTop={1} flexDirection="column">
                  <Text color={theme.textGhost}>SHAPE</Text>
                  <Text color={theme.textDim}>{shapePreviewForEntry(sel)}</Text>
                </Box>
              </>
            ) : (
              <Text color={theme.textFaint}>—</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (answerText !== null) {
    const lines = answerText.split("\n");
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.borderActive} paddingX={1}>
        <Text bold color={theme.accent}>{"REPLY  Ctrl+G apply  any key close"}</Text>
        {lines.map((line, i) => (
          <Text key={i} color={theme.text}>{line || " "}</Text>
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
      <Box flexDirection="column" borderStyle="single" borderColor={theme.borderActive} paddingX={1}>
        <Text bold color={theme.accent}>HISTORY  any key close</Text>
        {lines.map((line, i) => (
          <Text key={i} color={theme.text}>{line}</Text>
        ))}
      </Box>
    );
  }

  if (showHelp) {
    const rows: React.ReactNode[] = [];
    if (helpNeedsScroll) {
      rows.push(
        <Text key="help-chrome" color={theme.textDim}>
          {`  ${helpScroll + 1}–${helpScroll + helpViewLines} of ${totalHelpRows}  ·  ↑↓ PgUp/PgDn  ·  Esc closes`}
        </Text>,
      );
    }
    for (let i = 0; i < helpViewLines; i++) {
      const ri = helpScroll + i;
      if (ri < HELP_LINES.length) {
        const line = HELP_LINES[ri] ?? "";
        rows.push(
          <Text
            key={`h-${ri}`}
            color={
              line.startsWith("──") ? theme.accent
                : line.startsWith("  ") ? theme.text
                : theme.textDim
            }
          >{line || " "}</Text>,
        );
        continue;
      }
      const leg = ri - HELP_LINES.length;
      if (leg === 0) {
        rows.push(
          <Box key={`h-${ri}`}>
            <Text>{"  "}</Text>
            <Text color={theme.textFaint}>{"\u00B7 "}</Text><Text color={theme.text}>{"vel 0   "}</Text>
            <Text color={theme.accentSubtle}>{"\u2591\u2592\u2593\u2588 "}</Text><Text color={theme.text}>{"vel tiers"}</Text>
            <Text color={theme.textFaint}>{"   (prob 100%)"}</Text>
          </Box>,
        );
      } else if (leg === 1) {
        rows.push(
          <Box key={`h-${ri}`}>
            <Text>{"  "}</Text>
            <Text color={theme.accentMuted}>{"\u25CF "}</Text><Text color={theme.text}>{"prob 75-99%   "}</Text>
            <Text color={theme.warn}>{"\u25CF "}</Text><Text color={theme.text}>{"prob 50-74%   "}</Text>
            <Text color={theme.error}>{"\u25CF "}</Text><Text color={theme.text}>{"prob <50%"}</Text>
            <Text color={theme.textFaint}>{"   (step grid)"}</Text>
          </Box>,
        );
      } else {
        rows.push(
          <Box key={`h-${ri}`}>
            <Text>{"  "}</Text>
            <Text color={theme.textDim}>{"\u2591\u2588 "}</Text><Text color={theme.text}>{"muted: dimmer blocks   "}</Text>
            <Text color={theme.accent}>{"\u25BC "}</Text><Text color={theme.text}>{"ruler row = playhead   "}</Text>
            <Text color={theme.warn}>{"\u25C7\u25C6 "}</Text><Text color={theme.text}>{"suffix: prob/cond"}</Text>
          </Box>,
        );
      }
    }
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.borderActive} paddingX={1}>
        {rows}
      </Box>
    );
  }

  const statusLine =
    askPending                           ? `WAIT ask ${elapsedSecs}s`
    : generationStatus === "generating" ? `WAIT gen ${elapsedSecs}s`
    : generationStatus === "failed"     ? `FAIL ${generationError ?? "generation failed"}`
    : "";

  const borderCol = isFocused ? theme.borderActive : theme.border;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={borderCol} paddingX={1}>
      <Box>
        <Text bold color={theme.textDim}>CMD </Text>
        <Text color={theme.textFaint}>{"claude · slash commands · bare text"}</Text>
      </Box>
      {/* Autocomplete suggestions — shown above the input line */}
      {acSuggestions.length > 0 && (
        <Box flexDirection="column">
          {acSuggestions.map((cmd, i) => (
            <Text
              key={cmd}
              color={i === acIdx ? "#0A0A0A" : theme.textDim}
              backgroundColor={i === acIdx ? theme.accent : undefined}
            >{`  /${cmd}`}</Text>
          ))}
        </Box>
      )}
      <Box>
        <Text bold color={inputMode === "beat" ? theme.accent : theme.accentMuted}>
          [{inputMode.toUpperCase()}]
        </Text>
        <Text>{" "}</Text>
        <Text bold color={theme.accent}>{">"}</Text>
        <Text> </Text>
        <Text color={theme.text}>{text}</Text>
        {isFocused && <Text backgroundColor={theme.accent} color="#0A0A0A"> </Text>}
      </Box>
      {statusLine
        ? <Text color={askPending ? theme.warn : generationStatus === "failed" ? theme.error : theme.accentMuted}>{statusLine}</Text>
        : <Text color={theme.textFaint}>{"/help  ?  Tab  Shift+Tab  Space transport"}</Text>
      }
      <Text color={implementableHint ? theme.accent : theme.textFaint}>
        {implementableHint ? "HINT Ctrl+G /gen from last reply" : " "}
      </Text>
    </Box>
  );
}
