/**
 * 16 vertex positions for the 7×7 ring (clockwise from top, radius=3, center=(3,3)).
 * Each entry is [row, col].
 */
export const VERTICES_7x7: [number, number][] = [
  [0, 3], [0, 4], [1, 5], [2, 6], [3, 6],
  [4, 6], [5, 5], [6, 4], [6, 3], [6, 2],
  [5, 1], [4, 0], [3, 0], [2, 0], [1, 1], [0, 2],
];

/**
 * 16 vertex positions for the 9×9 ring (clockwise from top, radius=4, center=(4,4)).
 * Each entry is [row, col].
 */
export const VERTICES_9x9: [number, number][] = [
  [0, 4], [0, 6], [1, 7], [2, 8], [4, 8],
  [6, 8], [7, 7], [8, 6], [8, 4], [8, 2],
  [7, 1], [6, 0], [4, 0], [2, 0], [1, 1], [0, 2],
];

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
 * True if vertex vIdx (0-15) is a Euclidean hit for the given k/n/r.
 *
 * Vertex v maps to step floor(v * n / 16).
 * After rotation r: local = (step + r) % n.
 */
export function isVertexHit(
  vIdx: number,
  k: number,
  n: number,
  r: number
): boolean {
  if (k <= 0) return false;
  if (k >= n) return true;
  const step = Math.floor((vIdx * n) / 16);
  const local = (step + r) % n;
  return bjorklund(k, n)[local];
}

/**
 * Which vertex (0-15) the playhead is on for a given master step and euclidean cycle length n.
 * Wraps via step % n before mapping so the ring loops correctly.
 */
export function stepToVertex(step: number, n: number): number {
  return Math.floor(((step % n) * 16) / n);
}
