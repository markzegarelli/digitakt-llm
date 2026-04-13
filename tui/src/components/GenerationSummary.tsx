import React from "react";
import { Box, Text } from "ink";

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
      <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
        <Text color="#FFD700">{"-> "} </Text>
        <Text color="#555555">generating...</Text>
      </Box>
    );
  }

  if (generationStatus === "failed") {
    return (
      <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
        <Text color="#FF3366">{"-> generation failed"}</Text>
      </Box>
    );
  }

  if (!summary && !lastPrompt) return null;

  const displayPrompt = summary?.prompt ?? lastPrompt ?? "";
  const truncated = displayPrompt.length > 50 ? `${displayPrompt.slice(0, 50)}...` : displayPrompt;

  return (
    <Box borderStyle="single" borderColor="#333333" paddingX={1} flexShrink={0}>
      <Text color="#444444">{"-> \""}</Text>
      <Text color="#CCCCCC">{truncated}</Text>
      <Text color="#444444">"</Text>
      {summary && (
        <>
          <Text color="#333333">{"  ->  "}</Text>
          <Text color="#555555">{summary.track_summary}</Text>
          <Text color="#333333">  .  </Text>
          <Text color="#333333">{summary.latency_ms}ms</Text>
        </>
      )}
    </Box>
  );
}
