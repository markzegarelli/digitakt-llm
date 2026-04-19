/**
 * OLED-style palette (design handoff): near-black field + amber accent.
 * Used across Ink <Text color="..." /> (hex supported by Ink).
 */
export const theme = {
  accent: "#FFB020",
  accentInk: "#0A0B0A",
  accentMuted: "#C49A40",
  accentSubtle: "#8A6A28",
  text: "#E4E7DE",
  textDim: "#9FA39A",
  textFaint: "#6B6E66",
  textGhost: "#3A3C38",
  border: "#1F221E",
  borderActive: "#FFB020",
  /** Semantic escape hatches — keep for scanability. */
  error: "#FF5D5D",
  warn: "#FFB020",
  good: "#7BB26A",
  surface: "#0A0B0A",
} as const;

export type Theme = typeof theme;
