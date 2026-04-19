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

test("split stack width plus log equals center budget", () => {
  const out = computeSplitStackLayout({ termCols: 120, showLog: true, showTrig: true });
  expect(out.stackWidth + out.logWidth).toBe(out.centerBudget);
  expect(out.mixWidth + out.trigWidth).toBe(out.stackWidth);
});

test("split stack without trig uses full stack for mix", () => {
  const out = computeSplitStackLayout({ termCols: 100, showLog: false, showTrig: false });
  expect(out.logWidth).toBe(0);
  expect(out.trigWidth).toBe(0);
  expect(out.mixWidth).toBe(out.stackWidth);
});

