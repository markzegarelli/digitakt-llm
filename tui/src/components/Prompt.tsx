import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface PromptProps {
  isFocused: boolean;
  generationStatus: "idle" | "generating" | "failed";
  generationError: string | null;
  onCommand(cmd: string): void;
}

export function Prompt({ isFocused, generationStatus, generationError, onCommand }: PromptProps) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  useInput((input, key) => {
    if (!isFocused) return;

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
        : <Text color="gray">{"type a prompt · or: bpm <n>  play  stop  save <name>  load <name>  (↑↓ history)"}</Text>
      }
    </Box>
  );
}
