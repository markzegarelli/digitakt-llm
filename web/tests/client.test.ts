import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "../src/backend/client.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 1;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  close() {}
}
vi.stubGlobal("WebSocket", MockWebSocket);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  MockWebSocket.instances = [];
  mockFetch.mockReset();
});

describe("createClient", () => {
  it("connects to WebSocket on creation", () => {
    createClient("http://localhost:8000");
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:8000/ws");
  });

  it("subscribe handler receives parsed WebSocket messages", () => {
    const client = createClient("http://localhost:8000");
    const handler = vi.fn();
    client.subscribe(handler);
    const ws = MockWebSocket.instances[0];
    ws.onmessage!({ data: JSON.stringify({ type: "bpm_changed", bpm: 140 }) });
    expect(handler).toHaveBeenCalledWith({ type: "bpm_changed", bpm: 140 });
  });

  it("subscribe returns unsubscribe fn that stops delivery", () => {
    const client = createClient("http://localhost:8000");
    const handler = vi.fn();
    const unsub = client.subscribe(handler);
    unsub();
    const ws = MockWebSocket.instances[0];
    ws.onmessage!({ data: JSON.stringify({ type: "test" }) });
    expect(handler).not.toHaveBeenCalled();
  });

  it("post sends JSON body to correct URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const client = createClient("http://localhost:8000");
    await client.post("/bpm", { bpm: 130 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/bpm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ bpm: 130 }),
      })
    );
  });

  it("get fetches from correct URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ bpm: 120 }) });
    const client = createClient("http://localhost:8000");
    const result = await client.get("/state");
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/state");
    expect(result).toEqual({ bpm: 120 });
  });
});
