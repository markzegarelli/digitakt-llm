import React from "react";

interface Props { log: string[]; className?: string; }

export function ActivityLog({ log, className }: Props) {
  return (
    <div className={`activity-log panel ${className ?? ""}`}>
      {log.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}
