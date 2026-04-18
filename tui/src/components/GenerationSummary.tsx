import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface GenerationSummaryProps {
  summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
    producer_notes?: string;
  } | null;
  generationStatus: "idle" | "generating" | "failed";
  lastPrompt: string | null | undefined;
}

const NOTES_WRAP = 76;
const NOTES_MAX_LINES = 8;

function wrapParagraph(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (test.length <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      if (w.length > maxWidth) {
        for (let i = 0; i < w.length; i += maxWidth) {
          lines.push(w.slice(i, i + maxWidth));
        }
        line = "";
      } else {
        line = w;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapProducerNotes(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const t = para.trim();
    if (!t) continue;
    out.push(...wrapParagraph(t, NOTES_WRAP));
  }
  return out;
}

export function GenerationSummary({
  summary,
  generationStatus,
  lastPrompt,
}: GenerationSummaryProps) {
  if (generationStatus === "generating") {
    return (
      <Box borderStyle="single" borderColor={theme.border} paddingX={1} flexShrink={0}>
        <Text bold color={theme.textDim}>RUN </Text>
        <Text color={theme.accent}>GEN</Text>
        <Text color={theme.textDim}> generating pattern...</Text>
      </Box>
    );
  }

  if (generationStatus === "failed") {
    return (
      <Box borderStyle="single" borderColor={theme.border} paddingX={1} flexShrink={0}>
        <Text bold color={theme.error}>RUN FAIL</Text>
        <Text color={theme.textDim}> generation error</Text>
      </Box>
    );
  }

  if (!summary && !lastPrompt) return null;

  const displayPrompt = summary?.prompt ?? lastPrompt ?? "";
  const truncated = displayPrompt.length > 56 ? `${displayPrompt.slice(0, 55)}\u2026` : displayPrompt;

  const rawNotes = summary?.producer_notes?.trim();
  const noteLines = rawNotes ? wrapProducerNotes(rawNotes) : [];
  const truncatedNotes =
    noteLines.length > NOTES_MAX_LINES
      ? [...noteLines.slice(0, NOTES_MAX_LINES), "\u2026"]
      : noteLines;

  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      flexShrink={0}
      flexDirection="column"
    >
      <Box>
        <Text bold color={theme.textDim}>LAST </Text>
        <Text color={theme.text}>&quot;{truncated}&quot;</Text>
        {summary && (
          <>
            <Text color={theme.textFaint}>{"  \u2192  "}</Text>
            <Text color={theme.accentMuted}>{summary.track_summary}</Text>
            <Text color={theme.textFaint}>{"  \u00B7  "}</Text>
            <Text color={theme.textDim}>{summary.latency_ms}ms</Text>
          </>
        )}
      </Box>
      {truncatedNotes.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text bold color={theme.textDim}>
            NOTES{" "}
          </Text>
          {truncatedNotes.map((ln, i) => (
            <Text key={i} color={theme.textDim}>
              {ln}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
