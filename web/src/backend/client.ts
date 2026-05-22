export type AppEvent = Record<string, unknown>;

export interface BackendClient {
  post(path: string, body?: object): Promise<unknown>;
  get(path: string): Promise<unknown>;
  subscribe(handler: (event: AppEvent) => void): () => void;
}

export function createClient(baseUrl = ""): BackendClient {
  const origin = baseUrl || (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");
  const wsUrl = origin.replace(/^http/, "ws") + "/ws";
  const handlers = new Set<(event: AppEvent) => void>();

  function connect() {
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (ev) => {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      // Normalize server format {event, data} → {type, ...data}
      const data: AppEvent =
        typeof raw["event"] === "string"
          ? { type: raw["event"], ...((raw["data"] as Record<string, unknown>) ?? {}) }
          : raw;
      handlers.forEach((h) => h(data));
    };
    socket.onclose = () => setTimeout(connect, 1000);
  }
  connect();

  return {
    async post(path, body = {}) {
      const r = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = (data as { detail?: unknown }).detail;
        const msg =
          typeof detail === "string"
            ? detail
            : detail && typeof detail === "object" && "message" in detail
              ? String((detail as { message: string }).message)
              : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      return data;
    },
    async get(path) {
      const r = await fetch(`${origin}${path}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return data;
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
