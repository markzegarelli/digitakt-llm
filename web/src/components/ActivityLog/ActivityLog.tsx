import React, { useEffect, useRef } from "react";
import { Region } from "../Region.js";
import "./ActivityLog.css";

interface Props { log: string[]; className?: string; }

export function ActivityLog({ log, className }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  return (
    <Region title="LOG" className={`activity-log${className ? ` ${className}` : ""}`}>
      <div className="log-body">
        {log.map((entry, i) => (
          <pre key={i} className="log-entry">{entry}</pre>
        ))}
        <div ref={bottomRef} />
      </div>
    </Region>
  );
}
