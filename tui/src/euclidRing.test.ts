import { test, expect } from "bun:test";
import {
  bjorklund,
  isVertexHit,
  stepToVertex,
  VERTICES_7x7,
  VERTICES_9x9,
} from "./euclidRing";

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
  expect(isVertexHit(15, 8, 8, 0)).toBe(true);
});

test("isVertexHit uses n=16 1:1 mapping for k=5 r=0", () => {
  // bjorklund(5,16) hits at steps 3,6,9,12,15 → vertices 3,6,9,12,15 for n=16
  expect(isVertexHit(3, 5, 16, 0)).toBe(true);
  expect(isVertexHit(6, 5, 16, 0)).toBe(true);
  expect(isVertexHit(0, 5, 16, 0)).toBe(false);
  expect(isVertexHit(1, 5, 16, 0)).toBe(false);
});

test("isVertexHit respects rotation r=1", () => {
  // with r=1 step for vertex v is (floor(v*n/16) + 1) % n
  // vertex 2, k=5, n=16, r=1: step=floor(2*16/16)=2, local=(2+1)%16=3, bjorklund(5,16)[3]=true
  expect(isVertexHit(2, 5, 16, 1)).toBe(true);
  // vertex 3, r=1: step=3, local=4, bjorklund(5,16)[4]=false
  expect(isVertexHit(3, 5, 16, 1)).toBe(false);
});

// ===== stepToVertex tests =====

test("stepToVertex maps step to vertex index", () => {
  expect(stepToVertex(0, 16)).toBe(0);
  expect(stepToVertex(15, 16)).toBe(15);
  // n=8: each step spans 2 vertices
  expect(stepToVertex(0, 8)).toBe(0); // floor(0*16/8)=0
  expect(stepToVertex(1, 8)).toBe(2); // floor(1*16/8)=2
  expect(stepToVertex(7, 8)).toBe(14); // floor(7*16/8)=14
});

test("stepToVertex wraps via modulo for step >= n", () => {
  expect(stepToVertex(16, 16)).toBe(0); // (16%16)*16/16=0
  expect(stepToVertex(17, 16)).toBe(1);
});

// ===== vertex constant tests =====

test("VERTICES_7x7 has exactly 16 entries, all within 7x7", () => {
  expect(VERTICES_7x7.length).toBe(16);
  for (const [row, col] of VERTICES_7x7) {
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(7);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(7);
  }
});

test("VERTICES_7x7 has no duplicate positions", () => {
  const keys = VERTICES_7x7.map(([r, c]) => `${r},${c}`);
  expect(new Set(keys).size).toBe(16);
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
