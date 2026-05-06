export type AppEvent = Record<string, unknown>;

export interface BackendClient {
  post(path: string, body?: object): Promise<unknown>;
  get(path: string): Promise<unknown>;
  subscribe(handler: (event: AppEvent) => void): () => void;
}

export function createClient(baseUrl = "http://localhost:8000"): BackendClient {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws";
  const handlers = new Set<(event: AppEvent) => void>();

  function connect() {
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (ev) => {
      let data: AppEvent;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      handlers.forEach((h) => h(data));
    };
    socket.onclose = () => setTimeout(connect, 1000);
  }
  connect();

  return {
    post(path, body = {}) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    },
    get(path) {
      return fetch(`${baseUrl}${path}`).then((r) => r.json());
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
