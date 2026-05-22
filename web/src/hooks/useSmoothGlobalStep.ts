import { useEffect, useRef, useState } from "react";

/** Seconds per 16th-note step at the given BPM (matches core/player.py). */
export function stepDurationSec(bpm: number): number {
  return 60 / Math.max(20, bpm) / 4;
}

/**
 * Interpolate global_step between engine step_changed events for smooth LFO scroll.
 * Resyncs on each integer globalStep update from the WebSocket.
 */
export function useSmoothGlobalStep(
  playing: boolean,
  globalStep: number | null,
  bpm: number,
): number | null {
  const [smooth, setSmooth] = useState<number | null>(globalStep);
  const anchorRef = useRef({ gs: 0, t0: 0 });

  useEffect(() => {
    if (!playing || globalStep == null) {
      setSmooth(globalStep);
      return;
    }
    anchorRef.current = { gs: globalStep, t0: performance.now() };
    setSmooth(globalStep);
  }, [playing, globalStep]);

  useEffect(() => {
    if (!playing || globalStep == null) return;

    const stepMs = stepDurationSec(bpm) * 1000;
    let raf = 0;

    const tick = () => {
      const { gs, t0 } = anchorRef.current;
      const frac = Math.min((performance.now() - t0) / stepMs, 0.999);
      setSmooth(gs + frac);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, globalStep, bpm]);

  return playing ? smooth : globalStep;
}
