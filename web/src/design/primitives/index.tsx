import React from "react";

interface KnobProps {
  value?: number;
  min?: number;
  max?: number;
  label?: string;
  size?: number;
  active?: boolean;
  dim?: boolean;
  accent?: string;
}

export function Knob({
  value = 0,
  min = 0,
  max = 127,
  label = "",
  size = 38,
  active = false,
  dim = false,
  accent = "var(--yellow)",
}: KnobProps) {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const norm = (value - min) / (max - min);
  const startA = -225;
  const endA = 45;
  const a = startA + (endA - startA) * norm;
  const rad = (a * Math.PI) / 180;
  const handX = cx + Math.cos(rad) * (r - 3);
  const handY = cy + Math.sin(rad) * (r - 3);

  function arc(fromDeg: number, toDeg: number, radius: number) {
    const f = (fromDeg * Math.PI) / 180;
    const t = (toDeg * Math.PI) / 180;
    const x1 = cx + Math.cos(f) * radius;
    const y1 = cy + Math.sin(f) * radius;
    const x2 = cx + Math.cos(t) * radius;
    const y2 = cy + Math.sin(t) * radius;
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        padding: 2,
        background: active ? "rgba(240,160,32,0.06)" : "transparent",
        outline: active ? "1px solid var(--yellow)" : "none",
      }}
    >
      <svg width={size} height={size} style={{ display: "block" }}>
        <path d={arc(startA, endA, r)} stroke="#1d1407" strokeWidth="3" fill="none" />
        <path
          d={arc(startA, a, r)}
          stroke={dim ? "#5a3a08" : accent}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r - 6}
          fill="var(--bg-panel-2)"
          stroke={active ? "var(--yellow-bright)" : "var(--border)"}
          strokeWidth="1"
        />
        <line
          x1={cx}
          y1={cy}
          x2={handX}
          y2={handY}
          stroke={active ? "var(--yellow-bright)" : dim ? "#5a3a08" : accent}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {label ? (
        <div
          style={{
            fontSize: 9,
            color: active ? "var(--yellow-bright)" : dim ? "var(--text-faint)" : "var(--text-dim)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      ) : null}
      <div
        style={{
          fontSize: 11,
          color: active ? "var(--yellow-bright)" : dim ? "var(--text-faint)" : "var(--text)",
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function Bar({ value, max = 127, width = "100%", active = false }: {
  value: number;
  max?: number;
  width?: string;
  active?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div style={{ display: "inline-block", width, height: 10, background: "var(--bar-track)", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct * 100}%`,
          background: active ? "var(--yellow)" : "var(--yellow-dim)",
        }}
      />
    </div>
  );
}

export function StepNumberRow({ playing, playhead }: { playing: boolean; playhead: number }) {
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const n = i + 1;
    const isMajor = i % 4 === 0;
    const isHead = playing && Math.floor(playhead) === i;
    cells.push(
      <span
        key={i}
        style={{
          textAlign: "center",
          color: isHead ? "var(--yellow-bright)" : isMajor ? "var(--yellow-dim)" : "var(--text-faint)",
          fontWeight: isHead ? 700 : 500,
        }}
      >
        {isMajor ? n : "·"}
      </span>,
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(16, minmax(0, 1fr))", fontSize: 11, flex: 1, minWidth: 0 }}>
      {cells}
    </div>
  );
}
