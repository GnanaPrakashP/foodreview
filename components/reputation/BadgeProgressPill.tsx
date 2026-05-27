"use client";

import { AchievementBadgeArtwork, achievementBadgeSrc, iconForBadge } from "@/components/reputation/BadgePill";

type BadgeProgressPillProps = {
  badgeId?: string;
  name: string;
  label: string;
  progressPercent: number;
  icon?: string;
  description?: string;
  onClick?: () => void;
};

function barColor(pct: number) {
  if (pct >= 66) return "#22C55E";
  if (pct >= 33) return "#F59E0B";
  return "#F97316";
}

export default function BadgeProgressPill({
  badgeId,
  name,
  label,
  progressPercent,
  icon,
  description,
  onClick,
}: BadgeProgressPillProps) {
  const Icon = iconForBadge(icon);
  const color = barColor(progressPercent);
  const hasArtwork = Boolean(achievementBadgeSrc(badgeId));

  return (
    <button
      type="button"
      title={description}
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        width: 88,
        flexShrink: 0,
        padding: "12px 8px 14px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.04)",
        cursor: "pointer",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      {hasArtwork ? (
        <AchievementBadgeArtwork badgeId={badgeId} icon={icon} size={62} />
      ) : (
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: 16,
            background: "rgba(255,255,255,0.07)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={26} strokeWidth={2} color={color} />
        </div>
      )}

      {/* Badge name */}
      <span
        style={{
          color: "var(--cream)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1.2,
        }}
      >
        {name}
      </span>

      {/* Progress label e.g. "2 / 3" */}
      <span
        style={{
          color: "var(--muted)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {label}
      </span>

      {/* Colored strip at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: "rgba(255,255,255,0.07)",
        }}
      >
        <div
          style={{
            width: `${progressPercent}%`,
            height: "100%",
            background: color,
            borderRadius: "0 2px 0 0",
            transition: "width 0.5s ease",
          }}
        />
      </div>
    </button>
  );
}
