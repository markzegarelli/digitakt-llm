/**
 * LFO shape sampling (align with core/lfo.py) for TUI display only.
 */
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

/** Braille dot bit for sub-cell (0=left column, 1=right) and row 0..3 within one character. */
function brailleDotBit(subX: 0 | 1, subY: number): number {
  if (subX === 0) {
    if (subY === 0) return 0x01;
    if (subY === 1) return 0x02;
    if (subY === 2) return 0x04;
    return 0x40;
  }
  if (subY === 0) return 0x08;
  if (subY === 1) return 0x10;
  if (subY === 2) return 0x20;
  return 0x80;
}

function setBraillePixel(bits: Uint8Array, cols: number, rowCount: number, px: number, py: number): void {
  const widthPx = cols * 2;
  const heightPx = rowCount * 4;
  if (px < 0 || py < 0 || px >= widthPx || py >= heightPx) return;
  const cc = px >> 1;
  const subX = (px & 1) as 0 | 1;
  const cr = py >> 2;
  const subY = py & 3;
  const idx = cr * cols + cc;
  bits[idx] = (bits[idx]! | brailleDotBit(subX, subY)) & 0xff;
}

function drawLine(
  bits: Uint8Array,
  cols: number,
  rowCount: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const widthPx = cols * 2;
  const heightPx = rowCount * 4;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (let n = 0; n < widthPx * heightPx + 8; n++) {
    setBraillePixel(bits, cols, rowCount, x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * btop-style braille waveform: `cols` characters wide, `rowCount` lines tall (4× vertical dots per line).
 * Horizontal span = one full pattern. Faster LFO rates (shorter csn) draw multiple cycles; slower rates
 * show a partial cycle — same sampling as `lfo_w_at_step` / core/lfo.py.
 * `playheadCol` is a braille-cell column index (0..cols-1) or null; draws a full-height emphasis line.
 */
export function lfoBrailleLines(
  shape: string,
  patternLength: number,
  num: number,
  den: number,
  phase: number,
  cols: number,
  rowCount: number,
  playheadCol: number | null,
): string[] {
  const c = Math.max(1, cols);
  const r = Math.max(1, rowCount);
  const csn = cycleSteps(Math.max(1, patternLength), num, den);
  const pl = Math.max(1, patternLength);
  const bits = new Uint8Array(c * r);
  const widthPx = c * 2;
  const heightPx = r * 4;
  const mid = (heightPx - 1) / 2;
  const amp = mid;

  const wAtG = (g: number) => lfoShape(shape, (g % csn) / csn + phase);

  let prevX = 0;
  let prevY = Math.round(mid - wAtG(0) * amp);
  prevY = Math.max(0, Math.min(heightPx - 1, prevY));
  setBraillePixel(bits, c, r, 0, prevY);

  for (let px = 1; px < widthPx; px++) {
    const t = widthPx <= 1 ? 0 : px / (widthPx - 1);
    const g = t * pl;
    const w = wAtG(g);
    const y = Math.round(mid - w * amp);
    const py = Math.max(0, Math.min(heightPx - 1, y));
    drawLine(bits, c, r, prevX, prevY, px, py);
    prevX = px;
    prevY = py;
  }

  if (playheadCol !== null && playheadCol >= 0 && playheadCol < c) {
    const x0 = playheadCol * 2;
    for (let py = 0; py < heightPx; py++) {
      setBraillePixel(bits, c, r, x0, py);
      setBraillePixel(bits, c, r, x0 + 1, py);
    }
  }

  const lines: string[] = [];
  for (let row = 0; row < r; row++) {
    let line = "";
    for (let col = 0; col < c; col++) {
      const v = bits[row * c + col] ?? 0;
      line += String.fromCodePoint(0x2800 + v);
    }
    lines.push(line);
  }
  return lines;
}

/** 0..width-1 playhead from current in-pattern step (one pattern = full width; same speed for every LFO rate). */
export function lfoPlayheadIndex(currentStep: number, patternLength: number, width: number): number {
  const pl = Math.max(1, patternLength);
  const s = currentStep % pl;
  const ph = s / pl;
  return Math.min(width - 1, Math.max(0, Math.floor(ph * width)));
}