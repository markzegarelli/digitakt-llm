import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "../theme.js";
import type { PatternModalState, PatternListEntry } from "../types.js";
import { getCommandSpec, parseSlashDraft } from "../commandParsing.js";

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
  "  lfo <t> <shape> <d> <n/m> [ph]        tempo-synced LFO (t=cc:…, trig:…, or pitch:…:main)  or  lfo <t> clear",
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
  "  mode [chat|beat|standard|euclidean]  input mode (chat/beat) or pattern seq mode (standard/euclidean)",
  "  next [section]                       context-aware next pattern",
  "  vary [light|medium|heavy]            variation of current pattern",
  "  read                                 Claude describes current pattern",
  "",
  "── Keyboard shortcuts ─────────────────────────────────────────",
  "Global",
  "  ?                                    help overlay (SEQ/MIX/LOG, or empty CMD line)",
  "  Shift+M                              toggle seq mode standard ↔ euclidean",
  "  m / q / Shift+Q                      mute now / stage mute / fire queued mutes at next bar",
  "  c / n / Shift+N                      if chain exists: focus strip / queue next / arm fire on next 1",
  "",
  "Interaction contract",
  "  Tab                                  focus rail: SEQ → MIX → CMD",
  "  Shift+Tab                            toggle input mode Beat ↔ Chat",
  "  /                                    jump focus to CMD",
  "  Enter / Esc                          enter/exit focused edit context",
  "",
  "SEQ browse",
  "  ↑/↓                                  select track",
  "  Enter                                standard: step edit  |  euclidean: k/n/r edit",
  "  Space                                transport play/stop (outside step edit)",
  "",
  "SEQ step edit",
  "  Space                                toggle selected step on/off",
  "  [ ] or ←/→                           move step (euclidean: pulse steps only)",
  "  t                                    toggle TRIG key focus (panel stays open)",
  "  Shift+t                              open/arm TRIG+ALL (or toggle ALL when TRIG active)",
  "  Tab                                  toggle step/ring keys ↔ TRIG value keys",
  "",
  "Euclidean ring (k/n/r)",
  "  Enter                                open/close k n r boxes",
  "  [ ] or ←/→                           cycle k/n/r field when boxes are open",
  "  ↑/↓                                  track select (closed) or adjust field (open)",
  "  Shift+↑/↓                            adjust k/n/r by ±10",
  "  t / Shift+t                          open step+TRIG at first pulse / playhead pulse",
  "",
  "TRIG panel",
  "  ↑/↓                                  select field: prob vel note gate cond",
  "  ←/→                                  nudge value (Shift+←/→ = ±10 on numeric fields)",
  "  [ ]                                  move steps while TRIG panel stays open",
  "  0-9 then Enter                       type/apply numeric value",
  "  Esc                                  leave TRIG keys (or exit step+TRIG in euclidean)",
  "",
  "MIX/CC normal + per-step",
  "  ↑/↓                                  select CC parameter",
  "  [ ]                                  select track",
  "  ←/→                                  adjust global CC (Shift+←/→ = ±10)",
  "  Enter                                enter per-step CC edit",
  "  per-step: ←/→ step · ↑/↓ value · 0-9 Enter set · Backspace clear · Esc exit",
  "",
  "CMD input",
  "  Enter                                submit command/input (autocomplete may complete first)",
  "  Tab                                  cycle slash command suggestions",
  "  ↑/↓                                  command history (when autocomplete inactive)",
  "  ?                                    open help when CMD is empty",
  "",
  "Pattern picker/delete confirm",
  "  pick list: ↑/↓ select · Enter choose · Esc cancel",
  "  delete confirm: Y yes · N/Esc cancel",
  "",
  "Footer legend",
  "  · off, ○ low vel, ● high vel, dim dots = muted, ▼ ruler playhead, ◆ conditional trig",
  "",
  "Per-step settings visible/editable from generation output:",
  "  probability (prob), velocity (vel), note/pitch, length (gate), condition (cond)",
  "  ↑↓ PgUp PgDn scroll   Esc or any other key closes",
];

// All slash commands for autocomplete
const COMMANDS = [
  "ask", "bpm", "cc", "cc-step", "clear", "cond", "delete", "fill", "fresh", "gate",
  "lfo", "gen", "help", "history", "length", "load", "log", "midi", "mode", "mute",
  "new", "patterns", "pitch", "play", "prob", "quit", "random",
  "randbeat", "save", "stop", "swing", "undo", "vel",
  "chain", "next", "vary", "read",
];

/** Legend blocks below HELP_LINES (each counts as one scroll row). */
const HELP_LEGEND_ROW_COUNT = 3;

function helpTotalRows(): number {
  return HELP_LINES.length + HELP_LEGEND_ROW_COUNT;
}

export function getPromptSuggestions(text: string): string[] {
  if (!text.startsWith("/")) return [];
  const draft = parseSlashDraft(text);
  if (draft.isExactCommand) return [];
  const query = text.slice(1);
  if (query.includes(" ")) return [];  // past the command name
  return COMMANDS.filter((c) => c.startsWith(query)).slice(0, 7);
}

export function getParamHintState(text: string): { active: boolean; paramCount: number } {
  const draft = parseSlashDraft(text);
  if (!draft.command || !draft.isExactCommand) return { active: false, paramCount: 0 };
  const spec = getCommandSpec(draft.command);
  const count = spec?.params.length ?? 0;
  return { active: count > 0, paramCount: count };
}

export function nextParamFocusIndex(current: number, total: number, reverse: boolean): number {
  if (total <= 0) return 0;
  if (reverse) return (current - 1 + total) % total;
  return (current + 1) % total;
}

export function isInputAssistDismissedForText(text: string): boolean {
  return text.trim().length > 0;
}

type InlineEditState = { text: string; cursor: number };

export function moveCursorLeft(state: InlineEditState): InlineEditState {
  return { text: state.text, cursor: Math.max(0, state.cursor - 1) };
}

export function moveCursorRight(state: InlineEditState): InlineEditState {
  return { text: state.text, cursor: Math.min(state.text.length, state.cursor + 1) };
}

export function insertAtCursor(state: InlineEditState, input: string): InlineEditState {
  return {
    text: state.text.slice(0, state.cursor) + input + state.text.slice(state.cursor),
    cursor: state.cursor + input.length,
  };
}

export function backspaceAtCursor(state: InlineEditState): InlineEditState {
  if (state.cursor <= 0) return state;
  return {
    text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
    cursor: state.cursor - 1,
  };
}

export function getFocusedParamSuggestions(text: string, focusIdx: number): string[] {
  const draft = parseSlashDraft(text);
  if (!draft.command || !draft.isExactCommand) return [];
  const spec = getCommandSpec(draft.command);
  const param = spec?.params[focusIdx];
  if (!param) return [];
  const value = draft.args[focusIdx] ?? "";
  return [
    ...(param.defaultValue ? [param.defaultValue] : []),
    ...(param.suggestions ?? []),
  ]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .filter((v) => v.toLowerCase().startsWith(value.toLowerCase()))
    .slice(0, 7);
}

function buildSlashText(command: string, args: string[], focusIdx: number): string {
  const lastNonEmpty = args.reduce((acc, v, i) => (v.trim().length > 0 ? i : acc), -1);
  const visibleCount = Math.max(lastNonEmpty + 1, focusIdx + 1);
  const shownArgs = args.slice(0, visibleCount);
  return `/${command}${shownArgs.length ? ` ${shownArgs.join(" ")}` : " "}`;
}

export function applyParamSuggestionAndAdvance(
  text: string,
  focusIdx: number,
  paramCount: number,
  suggestion: string,
): { text: string; nextFocusIdx: number } {
  const draft = parseSlashDraft(text);
  if (!draft.command) return { text, nextFocusIdx: focusIdx };
  const nextArgs = [...draft.args];
  nextArgs[focusIdx] = suggestion;
  return {
    text: buildSlashText(draft.command, nextArgs, focusIdx),
    nextFocusIdx: Math.min(Math.max(0, paramCount - 1), focusIdx + 1),
  };
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
  /** Shift+M — toggle standard ↔ euclidean (global; CMD focus handled here so “M” is not inserted). */
  onToggleSeqMode(): void;
  patternModal: PatternModalState | null;
  onPatternModalClose(): void;
  onPatternModalNav(dir: number): void;
  onPatternModalPick(): void;
  onDeleteConfirmYes(): void;
  showHelp: boolean;
  /** Max visible help lines (viewport); keeps help inside the live layout without growing the terminal. */
  helpMaxVisibleRows?: number;
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
  tabCaptureRef: React.MutableRefObject<boolean>;
}

export function Prompt({
  isFocused,
  generationStatus,
  generationError,
  onCommand,
  onToggleSeqMode,
  patternModal,
  onPatternModalClose,
  onPatternModalNav,
  onPatternModalPick,
  onDeleteConfirmYes,
  showHelp,
  helpMaxVisibleRows,
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
  tabCaptureRef,
}: PromptProps) {
  const { stdout } = useStdout();
  const [text, setText] = useState("");
  /** Caret index 0…text.length (block cursor sits before the character at this index). */
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);
  const [acIdx, setAcIdx] = useState(-1);
  const [paramFocusIdx, setParamFocusIdx] = useState(0);
  const [paramModeDismissed, setParamModeDismissed] = useState(false);
  const [helpScroll, setHelpScroll] = useState(0);
  const genStartRef = useRef<number | null>(null);
  const slashDraft = parseSlashDraft(text);
  const activeCommandSpec =
    slashDraft.command && slashDraft.isExactCommand ? getCommandSpec(slashDraft.command) : null;
  const commandParams = activeCommandSpec?.params ?? [];
  const paramHintsActive = commandParams.length > 0 && !paramModeDismissed;
  const paramSuggestions = paramHintsActive ? getFocusedParamSuggestions(text, paramFocusIdx) : [];
  const activeSuggestions = paramHintsActive ? paramSuggestions : (paramModeDismissed ? [] : acSuggestions);

  const termRows = stdout?.rows ?? 24;
  const panelBudget =
    helpMaxVisibleRows != null
      ? Math.max(6, helpMaxVisibleRows)
      : Math.max(8, termRows - 8);
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

  // Update text, caret, and autocomplete state atomically
  function applyText(newText: string, nextCursor?: number) {
    const c =
      nextCursor !== undefined
        ? Math.max(0, Math.min(nextCursor, newText.length))
        : newText.length;
    const suggs = getPromptSuggestions(newText);
    const draft = parseSlashDraft(newText);
    const spec = draft.command && draft.isExactCommand ? getCommandSpec(draft.command) : null;
    const paramMode = (spec?.params.length ?? 0) > 0;
    const nextDismissed = paramModeDismissed && isInputAssistDismissedForText(newText);
    setText(newText);
    setCursor(c);
    setAcSuggestions(nextDismissed ? [] : suggs);
    setAcIdx(-1);
    setParamModeDismissed(nextDismissed);
    tabCaptureRef.current = !nextDismissed && (suggs.length > 0 || paramMode);
  }

  function updateText(newText: string) {
    applyText(newText, newText.length);
  }

  useEffect(() => {
    const maxIdx = Math.max(0, commandParams.length - 1);
    if (!paramHintsActive) {
      setParamFocusIdx(0);
      return;
    }
    setParamFocusIdx((idx) => Math.max(0, Math.min(idx, maxIdx)));
  }, [paramHintsActive, commandParams.length]);

  useEffect(() => {
    tabCaptureRef.current = acSuggestions.length > 0 || paramHintsActive;
  }, [acSuggestions.length, paramHintsActive, tabCaptureRef]);

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

    if (key.shift && !key.ctrl && !key.meta && (input === "m" || input === "M")) {
      onToggleSeqMode();
      return;
    }

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
      if (paramHintsActive || acSuggestions.length > 0 || acIdx >= 0) {
        setParamModeDismissed(true);
        setAcSuggestions([]);
        setAcIdx(-1);
        tabCaptureRef.current = false;
        return;
      }
      return;
    }

    // Tab: cycle autocomplete suggestions (App.tsx Tab guard prevents focus switch)
    if (key.tab) {
      if (paramHintsActive) {
        const total = commandParams.length;
        if (total > 0) {
          setParamFocusIdx((idx) => {
            const next = nextParamFocusIndex(idx, total, !!key.shift);
            setAcIdx(-1);
            return next;
          });
        }
        return;
      }
      if (acSuggestions.length > 0) {
        setAcIdx((i) => (i + 1) % acSuggestions.length);
      }
      return;
    }

    if (key.leftArrow || key.rightArrow) {
      if (key.leftArrow) {
        setCursor((c) => moveCursorLeft({ text, cursor: c }).cursor);
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => moveCursorRight({ text, cursor: c }).cursor);
        return;
      }
    }

    if (key.return) {
      if (paramHintsActive && slashDraft.command) {
        if (activeSuggestions.length > 0 && acIdx >= 0) {
          const applied = applyParamSuggestionAndAdvance(
            text,
            paramFocusIdx,
            commandParams.length,
            activeSuggestions[acIdx]!,
          );
          applyText(applied.text);
          setParamFocusIdx(applied.nextFocusIdx);
          setAcIdx(-1);
          return;
        }
      }
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

    // Many terminals (macOS) send 0x7f for the backspace key; Ink maps that to
    // `key.delete`, not `key.backspace`. Treat both as “delete to the left” so
    // the prompt behaves like a normal line editor. (True forward-delete `[3~`
    // also sets `key.delete` in Ink; in CMD we still prefer backward delete.)
    if (key.backspace || key.delete) {
      if (paramHintsActive && slashDraft.command) {
        const nextArgs = [...slashDraft.args];
        const cur = nextArgs[paramFocusIdx] ?? "";
        nextArgs[paramFocusIdx] = cur.slice(0, -1);
        applyText(buildSlashText(slashDraft.command, nextArgs, paramFocusIdx));
        return;
      }
      if (cursor > 0) {
        const next = backspaceAtCursor({ text, cursor });
        applyText(next.text, next.cursor);
      }
      return;
    }

    if (key.upArrow) {
      // Navigate autocomplete suggestions upward
      if (activeSuggestions.length > 0) {
        setAcIdx((i) => Math.max(i - 1, -1));
        return;
      }
      setHistIdx((idx) => {
        const next = Math.min(idx + 1, history.length - 1);
        const line = history[next] ?? "";
        applyText(line);
        return next;
      });
      return;
    }
    if (key.downArrow) {
      // Navigate autocomplete suggestions downward
      if (activeSuggestions.length > 0) {
        setAcIdx((i) => Math.min(i + 1, activeSuggestions.length - 1));
        return;
      }
      setHistIdx((idx) => {
        const next = Math.max(idx - 1, -1);
        const line = next === -1 ? "" : (history[next] ?? "");
        applyText(line);
        return next;
      });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      if (paramHintsActive && slashDraft.command) {
        const nextArgs = [...slashDraft.args];
        const cur = nextArgs[paramFocusIdx] ?? "";
        nextArgs[paramFocusIdx] = `${cur}${input}`;
        applyText(buildSlashText(slashDraft.command, nextArgs, paramFocusIdx));
        return;
      }
      const next = insertAtCursor({ text, cursor }, input);
      applyText(next.text, next.cursor);
      return;
    }
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
            <Text color={theme.textFaint}>{"\u00B7 "}</Text><Text color={theme.text}>{"off  "}</Text>
            <Text color={theme.accentMuted}>{"\u25CB "}</Text><Text color={theme.text}>{"vel low  "}</Text>
            <Text color={theme.accent}>{"\u25CF "}</Text><Text color={theme.text}>{"vel high"}</Text>
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
            <Text color={theme.textDim}>{"\u00B7\u25CB\u25CF "}</Text><Text color={theme.text}>{"muted: dimmer dots   "}</Text>
            <Text color={theme.accent}>{"\u25BC "}</Text><Text color={theme.text}>{"ruler = playhead   "}</Text>
            <Text color={theme.warn}>{"\u25C6 "}</Text><Text color={theme.text}>{"replaces step dot when cond set"}</Text>
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
      {activeSuggestions.length > 0 && (
        <Box flexDirection="column">
          {activeSuggestions.map((item, i) => (
            <Text
              key={`${item}-${i}`}
              color={i === acIdx ? "#0A0A0A" : theme.textDim}
              backgroundColor={i === acIdx ? theme.accent : undefined}
            >{`  ${paramHintsActive ? item : `/${item}`}`}</Text>
          ))}
        </Box>
      )}
      {paramHintsActive && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.textDim}>
            {`/${slashDraft.command ?? ""}${activeCommandSpec?.formHint ? ` ${activeCommandSpec.formHint}` : ""}`}
          </Text>
          <Box flexDirection="row" flexWrap="wrap">
            {commandParams.map((param, i) => {
              const token = param.required ? `<${param.label}>` : `[${param.label}]`;
              const display = slashDraft.args[i] && slashDraft.args[i]!.length > 0
                ? `${token}=${slashDraft.args[i]}`
                : token;
              const color = i === paramFocusIdx ? "#0A0A0A" : param.required ? theme.text : theme.textDim;
              const bg = i === paramFocusIdx ? theme.accent : undefined;
              return (
                <Text key={`${param.label}-${i}`} color={color} backgroundColor={bg}>
                  {` ${display} `}
                </Text>
              );
            })}
          </Box>
        </Box>
      )}
      <Box>
        <Text bold color={inputMode === "beat" ? theme.accent : theme.accentMuted}>
          [{inputMode.toUpperCase()}]
        </Text>
        <Text>{" "}</Text>
        <Text bold color={theme.accent}>{">"}</Text>
        <Text> </Text>
        <Text color={theme.text}>{text.slice(0, cursor)}</Text>
        {isFocused && <Text backgroundColor={theme.accent} color="#0A0A0A"> </Text>}
        <Text color={theme.text}>{text.slice(cursor)}</Text>
      </Box>
      {statusLine
        ? <Text color={askPending ? theme.warn : generationStatus === "failed" ? theme.error : theme.accentMuted}>{statusLine}</Text>
        : <Text color={theme.textFaint}>{"? Help  Tab Focus  Shift+Tab Mode  / Cmd  Enter Edit  t TRIG  Esc Back  Space Play/Stop"}</Text>
      }
      <Text color={implementableHint ? theme.accent : theme.textFaint}>
        {implementableHint ? "HINT Ctrl+G /gen from last reply" : " "}
      </Text>
    </Box>
  );
}
