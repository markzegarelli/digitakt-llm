import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDigitakt } from "../src/hooks/useDigitakt.js";
import type { BackendClient, AppEvent } from "../src/backend/client.js";

function makeMockClient() {
  let handler: ((e: AppEvent) => void) | null = null;
  const client: BackendClient = {
    post: vi.fn().mockResolvedValue({ ok: true }),
    get: vi.fn().mockResolvedValue({}),
    subscribe: vi.fn().mockImplementation((h) => {
      handler = h;
      return () => { handler = null; };
    }),
  };
  return {
    client,
    emit: (event: AppEvent) => act(() => { handler?.(event); }),
  };
}

describe("useDigitakt", () => {
  it("initializes with default state", () => {
    const { client } = makeMockClient();
    const { result } = renderHook(() => useDigitakt(client));
    expect(result.current.state.bpm).toBe(120);
    expect(result.current.state.is_playing).toBe(false);
    expect(result.current.state.connected).toBe(false);
  });

  it("updates bpm on bpm_changed event", async () => {
    const { client, emit } = makeMockClient();
    const { result } = renderHook(() => useDigitakt(client));
    await emit({ type: "bpm_changed", bpm: 140 });
    expect(result.current.state.bpm).toBe(140);
  });

  it("marks connected=true on state_snapshot event", async () => {
    const { client, emit } = makeMockClient();
    const { result } = renderHook(() => useDigitakt(client));
    await emit({ type: "state_snapshot", bpm: 128, is_playing: true, swing: 0, pattern_length: 16 });
    expect(result.current.state.connected).toBe(true);
    expect(result.current.state.bpm).toBe(128);
  });

  it("actions.play posts to /play", async () => {
    const { client } = makeMockClient();
    const { result } = renderHook(() => useDigitakt(client));
    await act(async () => { result.current.actions.play(); });
    expect(client.post).toHaveBeenCalledWith("/play");
  });

  it("actions.stop posts to /stop", async () => {
    const { client } = makeMockClient();
    const { result } = renderHook(() => useDigitakt(client));
    await act(async () => { result.current.actions.stop(); });
    expect(client.post).toHaveBeenCalledWith("/stop");
  });

  it("actions.generate posts prompt to /generate", async () => {
    const { client } = makeMockClient();
    const { result } = renderHook(() => useDigitakt(client));
    await act(async () => { result.current.actions.generate("heavy kick pattern"); });
    expect(client.post).toHaveBeenCalledWith("/generate", { prompt: "heavy kick pattern" });
  });
});
