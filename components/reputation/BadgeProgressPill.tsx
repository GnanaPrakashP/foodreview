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
  const hasArtwork = Boolean(achievementBadgeSrc(badgeId));

  return (
    <button
      type="button"
      title={description}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        width: 88,
        height: 116,
        flexShrink: 0,
        padding: "12px 8px 10px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.04)",
        cursor: "pointer",
        textAlign: "center",
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
          <Icon size={26} strokeWidth={2} color="var(--orange)" />
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
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {name}
      </span>

    </button>
  );
}
