import React, { useState, useEffect } from "react";
import { createClient } from "./backend/client.js";
import { useDigitakt } from "./hooks/useDigitakt.js";
import { SeqPanel } from "./components/SeqPanel/SeqPanel.js";
import { MixPanel } from "./components/MixPanel/MixPanel.js";
import { TrigPanel } from "./components/TrigPanel/TrigPanel.js";
import { CmdPanel } from "./components/CmdPanel/CmdPanel.js";
import { ActivityLog } from "./components/ActivityLog/ActivityLog.js";
import { StatusBar } from "./components/StatusBar/StatusBar.js";

export type FocusZone = "seq" | "mix" | "trig" | "cmd";

const BASE_URL = (import.meta as Record<string, unknown>)["env"]
  ? ((import.meta as unknown as { env: Record<string, string> }).env["VITE_API_URL"] ?? "http://localhost:8000")
  : "http://localhost:8000";

const client = createClient(BASE_URL);

export function App() {
  const { state, actions } = useDigitakt(client);
  const [focus, setFocus] = useState<FocusZone>("cmd");
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        setFocus((f) => f === "seq" ? "mix" : f === "mix" ? "cmd" : "seq");
        return;
      }
      if (e.key === "/" && focus !== "cmd") {
        setFocus("cmd");
        return;
      }
      if (e.key === " " && focus !== "cmd") {
        e.preventDefault();
        state.is_playing ? actions.stop() : actions.play();
        return;
      }
      if (e.key === "l" && e.altKey) {
        e.preventDefault();
        setShowLog((v) => !v);
        return;
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [focus, state.is_playing, actions]);

  return (
    <div className="app-layout">
      <StatusBar state={state} className="status-bar" />
      <SeqPanel
        state={state} actions={actions}
        focused={focus === "seq"} className="seq-panel"
        onFocus={() => setFocus("seq")}
      />
      <MixPanel
        state={state} actions={actions}
        focused={focus === "mix"} className="mix-panel"
        onFocus={() => setFocus("mix")}
      />
      <TrigPanel
        state={state} actions={actions}
        focused={focus === "trig"} className="trig-panel"
        onFocus={() => setFocus("trig")}
      />
      <CmdPanel
        state={state} actions={actions}
        focused={focus === "cmd"} className="cmd-panel"
        onFocus={() => setFocus("cmd")}
      />
      {showLog && <ActivityLog log={state.log} className="activity-log" />}
    </div>
  );
}
