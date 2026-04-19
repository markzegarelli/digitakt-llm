import { test, expect } from "bun:test";
import { computePanelLayout, computeSplitStackLayout } from "./layout.js";

test("layout main-only uses full center budget", () => {
  const out = computePanelLayout({ termCols: 120, showLog: false, showTrig: false });
  expect(out.centerBudget).toBe(106); // 120 - focus rail outer(14)
  expect(out.mainWidth).toBe(out.centerBudget);
  expect(out.trigWidth).toBe(0);
  expect(out.logWidth).toBe(0);
});

test("layout log-only keeps non-negative widths and exact sum", () => {
  const out = computePanelLayout({ termCols: 140, showLog: true, showTrig: false });
  expect(out.mainWidth).toBeGreaterThanOrEqual(0);
  expect(out.logWidth).toBeGreaterThanOrEqual(0);
  expect(out.trigWidth).toBe(0);
  expect(out.mainWidth + out.logWidth + out.trigWidth).toBe(out.centerBudget);
});

test("layout trig-only keeps non-negative widths and exact sum", () => {
  const out = computePanelLayout({ termCols: 140, showLog: false, showTrig: true });
  expect(out.mainWidth).toBeGreaterThanOrEqual(0);
  expect(out.trigWidth).toBeGreaterThanOrEqual(0);
  expect(out.logWidth).toBe(0);
  expect(out.mainWidth + out.logWidth + out.trigWidth).toBe(out.centerBudget);
});

test("layout split mode keeps non-negative widths and exact sum", () => {
  const out = computePanelLayout({ termCols: 180, showLog: true, showTrig: true });
  expect(out.mainWidth).toBeGreaterThanOrEqual(0);
  expect(out.trigWidth).toBeGreaterThanOrEqual(0);
  expect(out.logWidth).toBeGreaterThanOrEqual(0);
  expect(out.mainWidth + out.logWidth + out.trigWidth).toBe(out.centerBudget);
});

test("layout remains stable for narrow windows (no negative widths)", () => {
  const out = computePanelLayout({ termCols: 70, showLog: true, showTrig: true });
  expect(out.mainWidth).toBeGreaterThanOrEqual(0);
  expect(out.trigWidth).toBeGreaterThanOrEqual(0);
  expect(out.logWidth).toBeGreaterThanOrEqual(0);
  expect(out.mainWidth + out.logWidth + out.trigWidth).toBe(out.centerBudget);
});

test("split stack uses full center budget; log is bottom full width (logWidth 0)", () => {
  const out = computeSplitStackLayout({ termCols: 120, showLog: true, showTrig: true });
  expect(out.stackWidth).toBe(out.centerBudget);
  expect(out.logWidth).toBe(0);
  expect(out.seqGridWidth + out.trigWidth).toBe(out.stackWidth);
  expect(out.mixWidth).toBe(out.stackWidth);
});

test("split stack without trig uses full stack for mix", () => {
  const out = computeSplitStackLayout({ termCols: 100, showLog: false, showTrig: false });
  expect(out.logWidth).toBe(0);
  expect(out.trigWidth).toBe(0);
  expect(out.seqGridWidth).toBe(out.stackWidth);
  expect(out.mixWidth).toBe(out.stackWidth);
});

test("split stack with trig stays bounded on very narrow windows", () => {
  const out = computeSplitStackLayout({ termCols: 24, showLog: false, showTrig: true });
  expect(out.seqGridWidth).toBeGreaterThanOrEqual(0);
  expect(out.trigWidth).toBeGreaterThanOrEqual(0);
  expect(out.seqGridWidth).toBeLessThanOrEqual(out.stackWidth);
  expect(out.trigWidth).toBeLessThanOrEqual(out.stackWidth);
  expect(out.seqGridWidth + out.trigWidth).toBe(out.stackWidth);
  expect(out.mixWidth).toBe(out.stackWidth);
});

