import React from "react";

interface Props {
  title: string;
  focused?: boolean;
  right?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Region({ title, focused, right, children, className, style }: Props) {
  const borderColor = focused ? "var(--accent)" : "var(--dim3)";
  const titleColor  = focused ? "var(--accent)" : "var(--dim1)";
  return (
    <div
      className={className}
      style={{
        border: `1px solid ${borderColor}`,
        margin: "6px 8px",
        position: "relative",
        background: "var(--bg)",
        ...style,
      }}
    >
      <div style={{
        position: "absolute",
        top: -10,
        left: 12,
        background: "var(--bg)",
        padding: "0 6px",
        fontSize: 12,
        color: titleColor,
        fontWeight: focused ? 700 : 400,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}>
        {title}
      </div>
      {right && (
        <div style={{
          position: "absolute",
          top: -10,
          right: 12,
          background: "var(--bg)",
          padding: "0 6px",
          fontSize: 12,
          color: "var(--dim2)",
          whiteSpace: "nowrap",
        }}>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
