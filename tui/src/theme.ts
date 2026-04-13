/**
 * Elektron-inspired OLED palette: near-black field + single high-luminance accent.
 * Used across Ink <Text color="..." /> (hex supported by Ink).
 */
export const theme = {
  accent: "#D4EE00",
  accentMuted: "#8F9F2A",
  accentSubtle: "#5C6620",
  text: "#C8C8C8",
  textDim: "#6B6B6B",
  textFaint: "#4A4A4A",
  border: "#353535",
  borderActive: "#4F4F4F",
  /** Semantic escape hatches (log, FAIL, MIDI off, etc.) — keep for scanability; not strict monochrome. */
  error: "#C75C5C",
  warn: "#BFA243",
  surface: "#121212",
} as const;

export type Theme = typeof theme;
