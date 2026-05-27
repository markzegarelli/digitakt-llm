import type { DigitaktState } from "../backend/types.js";

/** Format generation telemetry + parsed LLM metadata for the chat log. */
export function formatGenerationReply(
  summary: NonNullable<DigitaktState["generation_summary"]>,
): string {
  const lines: string[] = [];
  const tracks = summary.track_summary?.trim();
  if (tracks && tracks !== "empty") {
    lines.push(`Pattern: ${tracks} · ${summary.latency_ms}ms`);
  } else if (summary.latency_ms > 0) {
    lines.push(`Generated in ${summary.latency_ms}ms`);
  }
  const parsed = summary.parsed_response?.trim();
  if (parsed) {
    if (lines.length) lines.push("");
    lines.push(parsed);
    return lines.join("\n");
  }
  const notes = summary.producer_notes?.trim();
  if (notes) {
    if (lines.length) lines.push("");
    lines.push(notes);
  }
  return lines.length ? lines.join("\n") : "Pattern ready.";
}
