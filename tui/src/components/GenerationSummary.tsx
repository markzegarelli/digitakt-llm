import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface GenerationSummaryProps {
  summary: {
    prompt: string;
    track_summary: string;
    latency_ms: number;
  } | null;
  generationStatus: "idle" | "generating" | "failed";
  lastPrompt: string | null | undefined;
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

  return (
    <Box borderStyle="single" borderColor={theme.border} paddingX={1} flexShrink={0}>
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
  );
}
