"use client";

import { Flame, Plus, Sparkles } from "lucide-react";

type TemporaryBadgePillProps = {
  name: string;
  streakLabel: string;
  icon?: string;
  description?: string;
  onClick?: () => void;
};

/** Shown when a streak badge hasn't been earned yet */
export function LockedStreakCard({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px dashed rgba(255,255,255,0.16)",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        gap: 9,
      }}
    >
      <Plus size={15} strokeWidth={2} color="rgba(255,255,255,0.25)" style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            color: "rgba(255,255,255,0.40)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: "1px 0 0",
            color: "rgba(255,255,255,0.25)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {hint}
        </p>
      </div>
    </div>
  );
}

export default function TemporaryBadgePill({
  name,
  streakLabel,
  icon,
  description,
  onClick,
}: TemporaryBadgePillProps) {
  const isSparkles = icon === "sparkles";
  const Icon = isSparkles ? Sparkles : Flame;
  const accent = isSparkles ? "#FACC15" : "#F97316";
  const bg = isSparkles ? "rgba(250,204,21,0.10)" : "rgba(249,115,22,0.10)";
  const border = isSparkles ? "rgba(250,204,21,0.32)" : "rgba(249,115,22,0.36)";

  return (
    <button
      type="button"
      title={description}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: 14,
        border: `1.5px solid ${border}`,
        background: bg,
        display: "flex",
        alignItems: "center",
        gap: 9,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <Icon size={16} strokeWidth={2.2} color={accent} style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            color: "var(--cream)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </p>
        <p
          style={{
            margin: "1px 0 0",
            color: accent,
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {streakLabel}
        </p>
      </div>
    </button>
  );
}
