import React, { useEffect, useRef } from "react";
import "./ActivityLog.css";

interface Props { log: string[]; className?: string; }

export function ActivityLog({ log, className }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  return (
    <div className={`activity-log panel ${className ?? ""}`}>
      <div className="panel-header">LOG</div>
      <div className="log-body">
        {log.map((entry, i) => (
          <div key={i} className="log-entry">{entry}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
