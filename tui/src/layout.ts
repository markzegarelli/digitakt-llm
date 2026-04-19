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

/** Split layout: SEQ uses full `stackWidth`; MIX + TRIG share one row below (`mixWidth` + `trigWidth`). */
export interface SplitStackLayout {
  centerBudget: number;
  stackWidth: number;
  mixWidth: number;
  trigWidth: number;
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
 * Widths for the split handoff layout: left stack (SEQ + MIX/TRIG row + CMD) and optional LOG column.
 * `stackWidth` + `logWidth` === `centerBudget`.
 */
export function computeSplitStackLayout({
  termCols,
  focusRailOuter = RAIL_OUTER,
  showLog,
  showTrig,
}: PanelLayoutInput): SplitStackLayout {
  const centerBudget = Math.max(0, termCols - focusRailOuter);
  let logWidth = 0;
  let stackWidth = centerBudget;
  if (showLog) {
    logWidth = Math.min(centerBudget, Math.max(24, Math.round(centerBudget * 0.28)));
    stackWidth = Math.max(28, centerBudget - logWidth);
  }
  let mixWidth = stackWidth;
  let trigWidth = 0;
  if (showTrig) {
    trigWidth = Math.round(stackWidth * 0.42);
    trigWidth = Math.min(Math.max(22, trigWidth), stackWidth - 24);
    mixWidth = Math.max(22, stackWidth - trigWidth);
  }
  const total = stackWidth + logWidth;
  if (total !== centerBudget) {
    stackWidth += centerBudget - total;
    if (showTrig) {
      mixWidth = stackWidth - trigWidth;
    } else {
      mixWidth = stackWidth;
    }
  }
  return {
    centerBudget,
    stackWidth: Math.max(0, stackWidth),
    mixWidth: Math.max(0, mixWidth),
    trigWidth: Math.max(0, trigWidth),
    logWidth: Math.max(0, logWidth),
  };
}
