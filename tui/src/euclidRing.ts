/**
 * Euclidean ring layout and Bjorklund logic.
 * Ring has `n` vertices (1–EUCLID_N_MAX), clockwise from top in **computational** order.
 * Perimeter drawing rotates slots by {@link EUCLID_RING_PERIMETER_ROTATION} so pattern **step 1**
 * (0-based index 1, first downbeat after step 0) sits at the visual top for n=16.
 * Matches core/euclidean.py for rhythm_hit / bjorklund.
 */

export const EUCLID_N_MAX = 16;

/**
 * Added to every 16-slot ring index before looking up coordinates (mod 16).
 * Default 15 (≡ −1): master step 1 lines up with the top cell for a full 16-slot ring.
 */
export const EUCLID_RING_PERIMETER_ROTATION = 15;

/**
 * 16 vertex positions for the 9×9 ring (clockwise from top, center=(4,4)).
 */
export const VERTICES_9x9: [number, number][] = [
  [0, 4], [0, 6], [1, 7], [2, 8], [4, 8],
  [6, 8], [7, 7], [8, 6], [8, 4], [8, 2],
  [7, 1], [6, 0], [4, 0], [2, 0], [1, 1], [0, 2],
];

/**
 * 16 slots on an 11×11 grid: 9×9 ring embedded at +1 offset, then the four
 * cardinal edge-centres (indices 0,4,8,12) pushed one cell outward (N/E/S/W).
 */
export const VERTICES_11x11: [number, number][] = (() => {
  const emb = VERTICES_9x9.map(([r, c]): [number, number] => [r + 1, c + 1]);
  const cardinals: [number, number][] = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
  ];
  const idx = [0, 4, 8, 12];
  const out = emb.map((p) => [...p] as [number, number]);
  for (let i = 0; i < 4; i++) {
    const j = idx[i]!;
    const [dr, dc] = cardinals[i]!;
    out[j] = [out[j][0] + dr, out[j][1] + dc];
  }
  return out;
})();

/**
 * Bjorklund / Bresenham bucket accumulator.
 * Returns a length-n boolean array with k True values, evenly distributed.
 * Matches the Python core/euclidean.py implementation exactly.
 */
export function bjorklund(k: number, n: number): boolean[] {
  if (k <= 0) return new Array(n).fill(false) as boolean[];
  if (k >= n) return new Array(n).fill(true) as boolean[];
  const out = new Array(n).fill(false) as boolean[];
  let bucket = 0;
  for (let i = 0; i < n; i++) {
    bucket += k;
    if (bucket >= n) {
      bucket -= n;
      out[i] = true;
    }
  }
  return out;
}

/**
 * True if ring vertex `vIdx` (0..n-1, clockwise from top) is a Euclidean pulse.
 * Same as rhythm_hit(k, n, r, vIdx) for static display on vertex vIdx.
 */
export function isVertexHit(vIdx: number, k: number, n: number, r: number): boolean {
  if (n < 1 || vIdx < 0 || vIdx >= n) return false;
  if (k <= 0) return false;
  if (k >= n) return true;
  const ring = bjorklund(k, n);
  const local = (((vIdx + r) % n) + n) % n;
  return ring[local] ?? false;
}

/** Matches `core.euclidean.clamp_euclid_triplet` (n capped to EUCLID_N_MAX). */
export function clampEuclidTriplet(k: number, n: number, r: number): [number, number, number] {
  const nClamped = Math.max(1, Math.min(Math.floor(n), EUCLID_N_MAX));
  const kClamped = Math.max(0, Math.min(Math.floor(k), nClamped));
  let rClamped = Math.floor(r);
  if (nClamped) {
    rClamped = ((rClamped % nClamped) + nClamped) % nClamped;
  } else {
    rClamped = 0;
  }
  return [kClamped, nClamped, rClamped];
}

/**
 * True if master pattern step `step` (0-based) is a Euclidean pulse for k/n/r.
 * Matches `core.euclidean.rhythm_hit` + `track_euclidean_hit` edge cases (k=0 → false, k≥n → all on).
 */
export function euclideanMasterStepHit(k: number, n: number, r: number, step: number): boolean {
  const [kc, nc, rc] = clampEuclidTriplet(k, n, r);
  if (kc <= 0) return false;
  if (kc >= nc) return true;
  const v = stepToVertex(step, nc);
  return isVertexHit(v, kc, nc, rc);
}

/** Sorted master steps in `[0, patternLength)` where {@link euclideanMasterStepHit} is true. */
export function listEuclideanHitMasterSteps(
  k: number,
  n: number,
  r: number,
  patternLength: number,
): number[] {
  const pl = Math.max(0, Math.floor(patternLength));
  const out: number[] = [];
  for (let s = 0; s < pl; s++) {
    if (euclideanMasterStepHit(k, n, r, s)) out.push(s);
  }
  return out;
}

/**
 * Snap `step` to a hit step: unchanged if already a hit; else smallest hit ≥ step, else first hit.
 */
export function snapMasterStepToEuclideanHit(
  step: number,
  hits: readonly number[],
  patternLength: number,
): number {
  const pl = Math.max(0, Math.floor(patternLength));
  if (pl === 0) return 0;
  const s = ((Math.floor(step) % pl) + pl) % pl;
  if (hits.length === 0) return clampStepToPattern(s, pl);
  if (hits.includes(s)) return s;
  const next = hits.find((h) => h >= s);
  return next ?? hits[0]!;
}

function clampStepToPattern(s: number, pl: number): number {
  const hi = Math.max(0, pl - 1);
  return Math.max(0, Math.min(Math.floor(s), hi));
}

/**
 * Next/previous hit step along the cyclic hit list (`delta` = +1 or −1).
 */
export function advanceEuclideanHitMasterStep(
  current: number,
  delta: 1 | -1,
  k: number,
  n: number,
  r: number,
  patternLength: number,
): number {
  const pl = Math.max(0, Math.floor(patternLength));
  const hits = listEuclideanHitMasterSteps(k, n, r, pl);
  if (hits.length === 0) return clampStepToPattern(current, pl);
  if (hits.length === 1) return hits[0]!;
  let s = snapMasterStepToEuclideanHit(current, hits, pl);
  let idx = hits.indexOf(s);
  if (idx < 0) idx = 0;
  const len = hits.length;
  const ni = (((idx + delta) % len) + len) % len;
  return hits[ni]!;
}

/**
 * Which ring vertex (0..n-1) the master step maps to (no UI rotation).
 * Step 0 → vertex 0.
 */
export function stepToVertex(step: number, n: number): number {
  if (n < 1) return 0;
  const s = Math.floor(step);
  return ((s % n) + n) % n;
}

/** Playhead uses the same logical ring index as {@link stepToVertex} (layout rotation is visual only). */
export function stepToPlayheadVertex(step: number, n: number): number {
  return stepToVertex(step, n);
}

/**
 * Map logical vertex j (0..n-1) to a slot on the 16-position perimeter ring.
 * Even spacing around the ring; n=16 is identity 0..15.
 */
export function logicalVertexToRingSlot(j: number, n: number): number {
  if (n < 1) return 0;
  if (n === 1) return 0;
  return Math.min(15, Math.floor((j * 16) / n));
}

/**
 * Discrete [row, col] for each logical vertex j in 0..n-1.
 */
export function computeRingVertices(n: number, wide: boolean): [number, number][] {
  const canonical = wide ? VERTICES_11x11 : VERTICES_9x9;
  const rot = ((EUCLID_RING_PERIMETER_ROTATION % 16) + 16) % 16;
  const out: [number, number][] = [];
  for (let j = 0; j < n; j++) {
    const slot = logicalVertexToRingSlot(j, n);
    out.push(canonical[(slot + rot) % 16]!);
  }
  return out;
}

export function ringGridSize(wide: boolean): number {
  return wide ? 11 : 9;
}

export function buildVertexLookup(
  vertices: [number, number][],
  size: number
): number[][] {
  const lookup = Array.from({ length: size }, () => new Array(size).fill(-1) as number[]);
  vertices.forEach(([row, col], idx) => {
    lookup[row][col] = idx;
  });
  return lookup;
}
