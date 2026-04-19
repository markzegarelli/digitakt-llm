export interface PanelLayoutInput {
  termCols: number;
  focusRailOuter?: number;
  showLog: boolean;
  showTrig: boolean;
}

export interface PanelLayout {
  centerBudget: number;
  mainWidth: number;
  trigWidth: number;
  logWidth: number;
}

/**
 * Split layout: SEQ and TRIG share the top row (`seqGridWidth` + `trigWidth` = `stackWidth`);
 * MIX uses the full `stackWidth` on the row below. Activity log is outside this budget.
 */
export interface SplitStackLayout {
  centerBudget: number;
  stackWidth: number;
  /** Inner width for the step grid (stack minus TRIG column). */
  seqGridWidth: number;
  trigWidth: number;
  /** Full stack width for the MIX row. */
  mixWidth: number;
  logWidth: number;
}

function clampMin(v: number, min: number): number {
  return Math.max(min, v);
}

/** Deterministic width allocator for [main | trig? | log?] within center budget. */
export function computePanelLayout({
  termCols,
  focusRailOuter = 14,
  showLog,
  showTrig,
}: PanelLayoutInput): PanelLayout {
  const centerBudget = Math.max(0, termCols - focusRailOuter);

  const MAIN_MIN = 36;
  const TRIG_MIN = 24;
  const LOG_MIN = 24;

  let mainWidth = centerBudget;
  let trigWidth = 0;
  let logWidth = 0;

  // Main only
  if (!showLog && !showTrig) {
    return { centerBudget, mainWidth: Math.max(0, mainWidth), trigWidth, logWidth };
  }

  // Main + log
  if (showLog && !showTrig) {
    logWidth = Math.round(centerBudget * 0.28);
    logWidth = Math.min(centerBudget, clampMin(logWidth, LOG_MIN));
    mainWidth = Math.max(0, centerBudget - logWidth);
    if (mainWidth < MAIN_MIN) {
      const deficit = MAIN_MIN - mainWidth;
      logWidth = Math.max(0, logWidth - deficit);
      mainWidth = centerBudget - logWidth;
    }
    return { centerBudget, mainWidth, trigWidth, logWidth };
  }

  // Main + trig
  if (!showLog && showTrig) {
    trigWidth = Math.round(centerBudget * 0.26);
    trigWidth = Math.min(centerBudget, clampMin(trigWidth, TRIG_MIN));
    mainWidth = Math.max(0, centerBudget - trigWidth);
    if (mainWidth < MAIN_MIN) {
      const deficit = MAIN_MIN - mainWidth;
      trigWidth = Math.max(0, trigWidth - deficit);
      mainWidth = centerBudget - trigWidth;
    }
    return { centerBudget, mainWidth, trigWidth, logWidth };
  }

  // Main + trig + log
  mainWidth = Math.round(centerBudget * 0.56);
  const rightCol = Math.max(0, centerBudget - mainWidth);
  trigWidth = Math.round(rightCol * 0.48);
  trigWidth = clampMin(trigWidth, TRIG_MIN);
  logWidth = rightCol - trigWidth;

  if (logWidth < LOG_MIN) {
    const need = LOG_MIN - logWidth;
    trigWidth = Math.max(0, trigWidth - need);
    logWidth = rightCol - trigWidth;
  }
  if (trigWidth < TRIG_MIN) {
    const need = TRIG_MIN - trigWidth;
    logWidth = Math.max(0, logWidth - need);
    trigWidth = rightCol - logWidth;
  }

  // Ensure a usable main column by borrowing from right side.
  if (mainWidth < MAIN_MIN) {
    const need = MAIN_MIN - mainWidth;
    let borrow = Math.min(need, Math.max(0, logWidth - LOG_MIN));
    logWidth -= borrow;
    mainWidth += borrow;
    if (mainWidth < MAIN_MIN) {
      borrow = Math.min(MAIN_MIN - mainWidth, Math.max(0, trigWidth - TRIG_MIN));
      trigWidth -= borrow;
      mainWidth += borrow;
    }
  }

  // Final normalization (sum exactly equals budget).
  const total = mainWidth + trigWidth + logWidth;
  if (total !== centerBudget) {
    mainWidth += centerBudget - total;
  }

  return {
    centerBudget,
    mainWidth: Math.max(0, mainWidth),
    trigWidth: Math.max(0, trigWidth),
    logWidth: Math.max(0, logWidth),
  };
}

const RAIL_OUTER = 14;

/**
 * Widths for the split layout: rail row uses full `centerBudget` for the main stack
 * (SEQ+TRIG row, then MIX). Activity log is rendered **below** the rail row at full terminal width,
 * so `showLog` does not reduce `stackWidth`. `logWidth` is always 0 (reserved for callers).
 */
export function computeSplitStackLayout({
  termCols,
  focusRailOuter = RAIL_OUTER,
  showLog: _showLog,
  showTrig,
}: PanelLayoutInput): SplitStackLayout {
  const centerBudget = Math.max(0, termCols - focusRailOuter);
  const stackWidth = centerBudget;
  const logWidth = 0;
  if (!showTrig) {
    return {
      centerBudget,
      stackWidth: Math.max(0, stackWidth),
      seqGridWidth: Math.max(0, stackWidth),
      trigWidth: 0,
      mixWidth: Math.max(0, stackWidth),
      logWidth,
    };
  }
  const MIN_SEQ_WIDTH = 24;
  const MIN_TRIG_WIDTH = 22;
  let seqGridWidth = stackWidth;
  let trigWidth = 0;

  if (stackWidth > MIN_SEQ_WIDTH) {
    if (stackWidth < MIN_SEQ_WIDTH + MIN_TRIG_WIDTH) {
      seqGridWidth = MIN_SEQ_WIDTH;
      trigWidth = stackWidth - seqGridWidth;
    } else {
      trigWidth = Math.round(stackWidth * 0.42);
      trigWidth = Math.min(Math.max(MIN_TRIG_WIDTH, trigWidth), stackWidth - MIN_SEQ_WIDTH);
      seqGridWidth = stackWidth - trigWidth;
    }
  }
  return {
    centerBudget,
    stackWidth: Math.max(0, stackWidth),
    seqGridWidth: Math.max(0, seqGridWidth),
    trigWidth: Math.max(0, trigWidth),
    mixWidth: Math.max(0, stackWidth),
    logWidth,
  };
}
