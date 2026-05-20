/** LFO shape sampling for web waveform display (align with core/lfo.py / TUI). */
const PI = Math.PI;

export function normP(p: number): number {
  let x = p % 1;
  if (x < 0) x += 1;
  return x;
}

export function lfoShape(shape: string, p: number): number {
  p = normP(p);
  switch (shape) {
    case "sine":
      return Math.sin(2 * PI * p);
    case "triangle":
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case "square":
      return p < 0.5 ? 1 : -1;
    case "ramp":
      return 2 * p - 1;
    case "saw":
      return 1 - 2 * p;
    default:
      return 0;
  }
}

export function cycleSteps(patternLength: number, num: number, den: number): number {
  return Math.max(1, Math.floor((patternLength * num) / den));
}

const STRIP = "▁▂▃▄▅▆▇█";

export function lfoStrip(shape: string, phase: number, width: number): string {
  let s = "";
  for (let i = 0; i < width; i++) {
    const p = i / width;
    const w = lfoShape(shape, p + phase);
    const u = (w + 1) / 2;
    const idx = Math.min(STRIP.length - 1, Math.max(0, Math.round(u * (STRIP.length - 1))));
    s += STRIP[idx]!;
  }
  return s;
}

export function lfoPlayheadIndex(currentStep: number, patternLength: number, width: number): number {
  const pl = Math.max(1, patternLength);
  const s = currentStep % pl;
  const ph = s / pl;
  return Math.min(width - 1, Math.max(0, Math.floor(ph * width)));
}

/** Map web LFO shape index to core shape name for graph sampling. */
export function lfoShapeNameFromIndex(shapeIdx: number): string | null {
  const map: Record<number, string> = {
    1: "triangle",
    2: "sine",
    3: "saw",
    4: "square",
    5: "ramp",
    6: "ramp",
  };
  return map[shapeIdx] ?? null;
}
