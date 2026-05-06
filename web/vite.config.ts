import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/state": "http://localhost:8000",
      "/generate": "http://localhost:8000",
      "/play": "http://localhost:8000",
      "/stop": "http://localhost:8000",
      "/bpm": "http://localhost:8000",
      "/swing": "http://localhost:8000",
      "/prob": "http://localhost:8000",
      "/vel": "http://localhost:8000",
      "/gate": "http://localhost:8000",
      "/note": "http://localhost:8000",
      "/cond": "http://localhost:8000",
      "/cc": "http://localhost:8000",
      "/mute": "http://localhost:8000",
      "/mute-queued": "http://localhost:8000",
      "/midi": "http://localhost:8000",
      "/patterns": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
});
