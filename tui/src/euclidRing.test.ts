import { test, expect } from "bun:test";
import {
  EUCLID_N_MAX,
  EUCLID_RING_PERIMETER_ROTATION,
  VERTICES_9x9,
  VERTICES_11x11,
  advanceEuclideanHitMasterStep,
  bjorklund,
  buildVertexLookup,
  computeRingVertices,
  euclideanMasterStepHit,
  isVertexHit,
  listEuclideanHitMasterSteps,
  logicalVertexToRingSlot,
  ringGridSize,
  snapMasterStepToEuclideanHit,
  stepToPlayheadVertex,
  stepToVertex,
} from "./euclidRing.js";

// ===== bjorklund tests =====

test("bjorklund(0, 8) returns all false", () => {
  expect(bjorklund(0, 8)).toEqual([
    false, false, false, false, false, false, false, false,
  ]);
});

test("bjorklund(8, 8) returns all true", () => {
  expect(bjorklund(8, 8)).toEqual([
    true, true, true, true, true, true, true, true,
  ]);
});

test("bjorklund(3, 8) hits at steps 2, 5, 7", () => {
  const result = bjorklund(3, 8);
  expect(result[2]).toBe(true);
  expect(result[5]).toBe(true);
  expect(result[7]).toBe(true);
  expect(result.filter(Boolean).length).toBe(3);
});

test("bjorklund(5, 16) hits at steps 3, 6, 9, 12, 15", () => {
  const result = bjorklund(5, 16);
  expect(result[3]).toBe(true);
  expect(result[6]).toBe(true);
  expect(result[9]).toBe(true);
  expect(result[12]).toBe(true);
  expect(result[15]).toBe(true);
  expect(result.filter(Boolean).length).toBe(5);
});

// ===== isVertexHit tests =====

test("isVertexHit: k=0 is always false", () => {
  expect(isVertexHit(0, 0, 16, 0)).toBe(false);
  expect(isVertexHit(8, 0, 16, 0)).toBe(false);
});

test("isVertexHit: k>=n is always true", () => {
  expect(isVertexHit(0, 16, 16, 0)).toBe(true);
  expect(isVertexHit(7, 8, 8, 0)).toBe(true);
});

test("isVertexHit uses rhythm_hit mapping for k=5 n=16 r=0", () => {
  expect(isVertexHit(3, 5, 16, 0)).toBe(true);
  expect(isVertexHit(6, 5, 16, 0)).toBe(true);
  expect(isVertexHit(0, 5, 16, 0)).toBe(false);
  expect(isVertexHit(1, 5, 16, 0)).toBe(false);
});

test("isVertexHit respects rotation r=1", () => {
  expect(isVertexHit(2, 5, 16, 1)).toBe(true);
  expect(isVertexHit(3, 5, 16, 1)).toBe(false);
});

// ===== stepToVertex / playhead =====

test("stepToVertex maps step mod n to vertex index (step 0 = top = vertex 0)", () => {
  expect(stepToVertex(0, 16)).toBe(0);
  expect(stepToVertex(15, 16)).toBe(15);
  expect(stepToVertex(0, 8)).toBe(0);
  expect(stepToVertex(7, 8)).toBe(7);
});

test("stepToVertex wraps for step >= n", () => {
  expect(stepToVertex(16, 16)).toBe(0);
  expect(stepToVertex(17, 16)).toBe(1);
});

test("stepToPlayheadVertex matches stepToVertex (rotation is layout-only)", () => {
  for (const n of [1, 4, 8, 16]) {
    for (const s of [0, 1, 7, 15, 16, 31]) {
      expect(stepToPlayheadVertex(s, n)).toBe(stepToVertex(s, n));
    }
  }
});

test("EUCLID_RING_PERIMETER_ROTATION is 15", () => {
  expect(EUCLID_RING_PERIMETER_ROTATION).toBe(15);
});

// ===== logicalVertexToRingSlot =====

test("logicalVertexToRingSlot: n=16 is identity", () => {
  for (let j = 0; j < 16; j++) {
    expect(logicalVertexToRingSlot(j, 16)).toBe(j);
  }
});

test("logicalVertexToRingSlot: n=8 picks even slots", () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7].map((j) => logicalVertexToRingSlot(j, 8))).toEqual([
    0, 2, 4, 6, 8, 10, 12, 14,
  ]);
});

// ===== computeRingVertices / canonical =====

test("EUCLID_N_MAX is 16", () => {
  expect(EUCLID_N_MAX).toBe(16);
});

test("VERTICES_11x11: 16 unique cells in 11×11", () => {
  expect(VERTICES_11x11.length).toBe(16);
  const keys = VERTICES_11x11.map(([r, c]) => `${r},${c}`);
  expect(new Set(keys).size).toBe(16);
  for (const [row, col] of VERTICES_11x11) {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(11);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(11);
  }
});

test("wide ring pushes top cardinal one row out vs embedded 9×9", () => {
  const embTop = VERTICES_9x9[0]![0] + 1;
  expect(VERTICES_11x11[0]![0]).toBe(embTop - 1);
});

test("VERTICES_9x9 has exactly 16 entries, all within 9x9", () => {
  expect(VERTICES_9x9.length).toBe(16);
  for (const [row, col] of VERTICES_9x9) {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(9);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(9);
  }
});

test("VERTICES_9x9 has no duplicate positions", () => {
  const keys = VERTICES_9x9.map(([r, c]) => `${r},${c}`);
  expect(new Set(keys).size).toBe(16);
});

test("computeRingVertices returns n unique cells for all n", () => {
  for (const wide of [false, true]) {
    const gs = ringGridSize(wide);
    for (let n = 1; n <= 16; n++) {
      const verts = computeRingVertices(n, wide);
      expect(verts.length).toBe(n);
      const keys = verts.map(([r, c]) => `${r},${c}`);
      expect(new Set(keys).size).toBe(n);
      for (const [row, col] of verts) {
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(gs);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(gs);
      }
    }
  }
});

test("perimeter rotation: logical vertex 1 uses top canonical cell for n=16", () => {
  expect(computeRingVertices(16, true)[1]).toEqual(VERTICES_11x11[0]);
  expect(computeRingVertices(16, false)[1]).toEqual(VERTICES_9x9[0]);
});

test("buildVertexLookup matches vertex list", () => {
  const n = 5;
  const wide = false;
  const gs = ringGridSize(wide);
  const verts = computeRingVertices(n, wide);
  const lookup = buildVertexLookup(verts, gs);
  for (let i = 0; i < n; i++) {
    const [r, c] = verts[i]!;
    expect(lookup[r][c]).toBe(i);
  }
});

// ===== master-step hit list (matches core/euclidean rhythm_hit) =====

test("euclideanMasterStepHit(3,8,0,s) matches bjorklund ring[(s+r)%n]", () => {
  const ring = bjorklund(3, 8);
  for (let s = 0; s < 24; s++) {
    const local = ((s + 0) % 8 + 8) % 8;
    expect(euclideanMasterStepHit(3, 8, 0, s)).toBe(ring[local] ?? false);
  }
});

test("listEuclideanHitMasterSteps k=3 n=8 length 16", () => {
  expect(listEuclideanHitMasterSteps(3, 8, 0, 16)).toEqual([2, 5, 7, 10, 13, 15]);
});

test("advanceEuclideanHitMasterStep wraps on k=3 n=8", () => {
  expect(advanceEuclideanHitMasterStep(15, 1, 3, 8, 0, 16)).toBe(2);
  expect(advanceEuclideanHitMasterStep(2, -1, 3, 8, 0, 16)).toBe(15);
});

test("snapMasterStepToEuclideanHit picks next hit", () => {
  const hits = listEuclideanHitMasterSteps(3, 8, 0, 16);
  expect(snapMasterStepToEuclideanHit(0, hits, 16)).toBe(2);
  expect(snapMasterStepToEuclideanHit(3, hits, 16)).toBe(5);
  expect(snapMasterStepToEuclideanHit(7, hits, 16)).toBe(7);
});

test("euclideanMasterStepHit k=0 is never true", () => {
  expect(euclideanMasterStepHit(0, 8, 0, 0)).toBe(false);
});

test("euclideanMasterStepHit k=n is always true", () => {
  for (let s = 0; s < 16; s++) {
    expect(euclideanMasterStepHit(8, 8, 0, s)).toBe(true);
  }
});

test("listEuclideanHitMasterSteps is empty when k=0", () => {
  expect(listEuclideanHitMasterSteps(0, 8, 0, 16)).toEqual([]);
});

test("snapMasterStepToEuclideanHit with empty hits clamps step", () => {
  expect(snapMasterStepToEuclideanHit(7, [], 16)).toBe(7);
  expect(snapMasterStepToEuclideanHit(99, [], 8)).toBe(3);
});

test("advanceEuclideanHitMasterStep with empty hits clamps current", () => {
  expect(advanceEuclideanHitMasterStep(3, 1, 0, 8, 0, 16)).toBe(3);
});
