"use client";

import { useState } from "react";
import Image from "next/image";
import { Flame, Plus, Sparkles, X } from "lucide-react";
import BadgePill, { AchievementBadgeArtwork, achievementBadgeSrc, iconForBadge } from "@/components/reputation/BadgePill";
import BadgeProgressPill from "@/components/reputation/BadgeProgressPill";
import type {
  BadgeProgress,
  PermanentBadge,
  TemporaryBadge,
  UserProfileReputation,
  UserTier,
} from "@/lib/reputation";

type Detail =
  | { kind: "tier" }
  | { kind: "permanent"; item: PermanentBadge }
  | { kind: "temporary"; item: TemporaryBadge }
  | { kind: "progress"; item: BadgeProgress };

type LockedAchievement = {
  badgeId: string;
  badgeName: string;
  badgeDescription: string;
  badgeIcon: string;
};

const LOCKED_ACHIEVEMENT_CATALOG: LockedAchievement[] = [
  {
    badgeId: "first_bite",
    badgeName: "First Bite",
    badgeDescription: "Post your first food review.",
    badgeIcon: "utensils",
  },
  {
    badgeId: "photo_first",
    badgeName: "Photo First",
    badgeDescription: "Add a photo or video to a review.",
    badgeIcon: "camera",
  },
  {
    badgeId: "good_call",
    badgeName: "Good Call",
    badgeDescription: "Get one Agree or Strongly Agree.",
    badgeIcon: "badge-check",
  },
  {
    badgeId: "food_explorer",
    badgeName: "Food Explorer",
    badgeDescription: "Post three reviews.",
    badgeIcon: "compass",
  },
  {
    badgeId: "area_explorer",
    badgeName: "Area Explorer",
    badgeDescription: "Post three reviews in one area.",
    badgeIcon: "map-pin",
  },
  {
    badgeId: "cuisine_explorer",
    badgeName: "Cuisine Explorer",
    badgeDescription: "Post three reviews in one cuisine.",
    badgeIcon: "chef-hat",
  },
  {
    badgeId: "cuisine_expert",
    badgeName: "Cuisine Expert",
    badgeDescription: "Build a trusted track record in one cuisine.",
    badgeIcon: "award",
  },
  {
    badgeId: "crowd_approved",
    badgeName: "Crowd Approved",
    badgeDescription: "Get ten agrees on one post.",
    badgeIcon: "users",
  },
  {
    badgeId: "hidden_gem_finder",
    badgeName: "Hidden Gem Finder",
    badgeDescription: "Get ten agrees for a lesser-known place.",
    badgeIcon: "gem",
  },
  {
    badgeId: "visit_driver",
    badgeName: "Visit Driver",
    badgeDescription: "Drive 25 unique visits through your posts.",
    badgeIcon: "route",
  },
];

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

function earnedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function HScrollRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        paddingBottom: 2,
        scrollbarWidth: "none",
      }}
    >
      {children}
    </div>
  );
}

function badgeBaseId(badgeId: string) {
  return badgeId.split(":")[0];
}

function motivationalText(tier: UserTier): string {
  if (tier.isMaxTier) return "You've reached the top. Culinary Legend!";
  if (tier.progressPercent >= 75) return "Almost at the next tier — keep it going!";
  if (tier.progressPercent >= 40) return "Solid progress — keep exploring and reviewing!";
  return "Keep sharing great food and level up!";
}

const TIER_BADGE_SRC_BY_MIN_SCORE: Record<number, string> = {
  0: "/badges/tiers-transparent-ui/tier-01-new-taster.png",
  11: "/badges/tiers-transparent-ui/tier-02-rising-taster.png",
  21: "/badges/tiers-transparent-ui/tier-03-food-regular.png",
  41: "/badges/tiers-transparent-ui/tier-04-known-regular.png",
  76: "/badges/tiers-transparent-ui/tier-05-trusted-palate.png",
  126: "/badges/tiers-transparent-ui/tier-06-sharp-palate.png",
  201: "/badges/tiers-transparent-ui/tier-07-tastemaker.png",
  351: "/badges/tiers-transparent-ui/tier-08-local-tastemaker.png",
  601: "/badges/tiers-transparent-ui/tier-09-food-authority.png",
  1001: "/badges/tiers-transparent-ui/tier-10-top-food-authority.png",
  1501: "/badges/tiers-transparent-ui/tier-11-culinary-legend.png",
};

function tierBadgeSrc(tier: UserTier) {
  return TIER_BADGE_SRC_BY_MIN_SCORE[tier.minScore] ?? TIER_BADGE_SRC_BY_MIN_SCORE[0];
}

function TierBadgeArtwork({
  tier,
  size,
}: {
  tier: UserTier;
  size: number;
}) {
  return (
    <Image
      src={tierBadgeSrc(tier)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
        filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.26))",
      }}
    />
  );
}

/* ─── Tier achievement pill ──────────────────────────────────────────────── */

function TierAchievementPill({
  tier,
  onClick,
}: {
  tier: UserTier;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 88,
        flexShrink: 0,
        padding: "12px 8px 10px",
        borderRadius: 16,
        border: "1.5px solid rgba(240,96,48,0.36)",
        background: "rgba(240,96,48,0.10)",
        cursor: "pointer",
        textAlign: "center",
      }}
    >
      <div style={{ margin: "-2px 0 1px" }}>
        <TierBadgeArtwork tier={tier} size={62} />
      </div>
      <span
        style={{
          color: "var(--cream)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1.25,
        }}
      >
        {tier.displayName}
      </span>
    </button>
  );
}

function StreakAchievementPill({
  badge,
  label,
  hint,
  onClick,
}: {
  badge?: TemporaryBadge;
  label: string;
  hint: string;
  onClick?: () => void;
}) {
  const active = Boolean(badge);
  const icon = badge?.badgeIcon;
  const Icon = icon === "sparkles" ? Sparkles : icon === "flame" ? Flame : Plus;
  const artworkBadgeId = badge?.badgeId ?? (label.toLowerCase().includes("monthly") ? "monthly_explorer" : label.toLowerCase().includes("weekly") ? "weekly_explorer" : undefined);
  const hasArtwork = Boolean(achievementBadgeSrc(artworkBadgeId));
  const accent = icon === "sparkles" ? "#FACC15" : active ? "#F97316" : "rgba(255,255,255,0.28)";
  const border = active
    ? icon === "sparkles" ? "rgba(250,204,21,0.32)" : "rgba(249,115,22,0.36)"
    : "rgba(255,255,255,0.14)";
  const background = active
    ? icon === "sparkles" ? "rgba(250,204,21,0.10)" : "rgba(249,115,22,0.10)"
    : "rgba(255,255,255,0.03)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!active}
      aria-label={badge ? `${badge.badgeName}, ${badge.streakLabel}` : `${label}, ${hint}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 88,
        flexShrink: 0,
        padding: "12px 8px 10px",
        borderRadius: 16,
        border: `1.5px ${active ? "solid" : "dashed"} ${border}`,
        background,
        cursor: active ? "pointer" : "default",
        textAlign: "center",
      }}
    >
      {hasArtwork ? (
        <AchievementBadgeArtwork badgeId={artworkBadgeId} icon={icon} size={62} />
      ) : (
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: 16,
            background: active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={26} strokeWidth={2.2} color={accent} />
        </div>
      )}
      <span
        style={{
          color: active ? "var(--cream)" : "rgba(255,255,255,0.42)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1.2,
        }}
      >
        {badge?.badgeName ?? label}
      </span>
    </button>
  );
}

function LockedAchievementPill({ item }: { item: LockedAchievement }) {
  return (
    <div
      title={item.badgeDescription}
      aria-label={`${item.badgeName}, not earned yet`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 88,
        minHeight: 106,
        padding: "12px 8px 10px",
        borderRadius: 16,
        border: "1px dashed rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.025)",
        textAlign: "center",
      }}
    >
      <div style={{ opacity: 0.42, filter: "grayscale(0.55)" }}>
        <AchievementBadgeArtwork badgeId={item.badgeId} icon={item.badgeIcon} size={62} />
      </div>
      <span
        style={{
          color: "rgba(255,255,255,0.48)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1.25,
        }}
      >
        {item.badgeName}
      </span>
    </div>
  );
}

/* ─── Tier detail bottom-sheet ───────────────────────────────────────────── */

function TierDetailSheet({
  tier,
  profileScore,
  onClose,
}: {
  tier: UserTier;
  profileScore?: number;
  onClose: () => void;
}) {
  const score =
    profileScore ??
    Math.round(
      tier.minScore +
        (tier.progressPercent / 100) *
          ((tier.maxScore ?? tier.minScore + 1) - tier.minScore)
    );
  const scoreLabel = tier.isMaxTier ? `${score}` : `${score} / ${tier.maxScore}`;

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.52)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 16px 24px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 20,
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "20px 18px 18px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Icon + name + score */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <TierBadgeArtwork tier={tier} size={84} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "var(--cream)",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 17,
                  fontWeight: 800,
                }}
              >
                {tier.displayName}
              </p>
              <p
                style={{
                  margin: 0,
                  color: "var(--orange)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                {scoreLabel}
              </p>
            </div>
            <p
              style={{
                margin: "3px 0 0",
                color: "var(--muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {tier.isMaxTier
                ? "Top tier achieved"
                : `${tier.progressPercent}% to ${tier.nextTierName}`}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 5,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${tier.progressPercent}%`,
              height: "100%",
              borderRadius: 999,
              background: "linear-gradient(90deg, #F97316, #FBBF24)",
              boxShadow: "0 0 8px rgba(249,115,22,0.45)",
              transition: "width 0.6s ease",
            }}
          />
        </div>

        {/* Motivational text */}
        <p
          style={{
            margin: 0,
            color: "rgba(255,255,255,0.38)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {motivationalText(tier)}
        </p>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            height: 42,
            borderRadius: 13,
            border: "1px solid rgba(240,96,48,0.30)",
            background: "rgba(240,96,48,0.10)",
            color: "var(--orange)",
            fontFamily: "'Syne', sans-serif",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ─── Generic badge detail sheet ─────────────────────────────────────────── */

function BadgeDetailSheet({
  detail,
  onClose,
}: {
  detail: Exclude<Detail, { kind: "tier" }>;
  onClose: () => void;
}) {
  const name = detail.item.badgeName;
  const description =
    "badgeDescription" in detail.item ? detail.item.badgeDescription : "";
  const footer =
    detail.kind === "permanent"
      ? `Earned ${earnedDate(detail.item.earnedAt)}`
      : detail.kind === "temporary"
        ? detail.item.streakLabel
        : detail.item.label;
  const Icon = iconForBadge(
    "badgeIcon" in detail.item ? detail.item.badgeIcon : undefined
  );

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.52)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 16px 24px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 20,
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "20px 18px 18px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "rgba(240,96,48,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={22} strokeWidth={2} color="var(--orange)" />
        </div>
        <p
          style={{
            margin: 0,
            color: "var(--cream)",
            fontFamily: "'Syne', sans-serif",
            fontSize: 16,
            fontWeight: 800,
          }}
        >
          {name}
        </p>
        {description && (
          <p
            style={{
              margin: 0,
              color: "var(--muted)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        )}
        <p
          style={{
            margin: 0,
            color: "var(--orange)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {footer}
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 4,
            width: "100%",
            height: 42,
            borderRadius: 13,
            border: "1px solid rgba(240,96,48,0.30)",
            background: "rgba(240,96,48,0.10)",
            color: "var(--orange)",
            fontFamily: "'Syne', sans-serif",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ─── "View All" full achievements sheet ─────────────────────────────────── */

function AllAchievementsSheet({
  tier,
  weeklyBadge,
  monthlyBadge,
  badges,
  progress,
  onClose,
  onTierClick,
  onTemporaryClick,
  onBadgeClick,
  onProgressClick,
}: {
  tier: UserTier;
  weeklyBadge?: TemporaryBadge;
  monthlyBadge?: TemporaryBadge;
  badges: PermanentBadge[];
  progress: BadgeProgress[];
  onClose: () => void;
  onTierClick: () => void;
  onTemporaryClick: (badge: TemporaryBadge) => void;
  onBadgeClick: (badge: PermanentBadge) => void;
  onProgressClick: (item: BadgeProgress) => void;
}) {
  const earnedBaseIds = new Set(badges.map((badge) => badgeBaseId(badge.badgeId)));
  const progressBaseIds = new Set(progress.map((item) => badgeBaseId(item.badgeId)));
  const lockedAchievements = LOCKED_ACHIEVEMENT_CATALOG.filter((item) => {
    const baseId = badgeBaseId(item.badgeId);
    return !earnedBaseIds.has(baseId) && !progressBaseIds.has(baseId);
  });

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.60)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="All achievements"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "88dvh",
          borderRadius: "20px 20px 0 0",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderBottom: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 18px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <p
            style={{
              margin: 0,
              color: "var(--cream)",
              fontFamily: "'Syne', sans-serif",
              fontSize: 16,
              fontWeight: 800,
            }}
          >
            Achievements
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "none",
              borderRadius: 999,
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={15} strokeWidth={2.5} color="var(--muted)" />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          style={{
            overflowY: "auto",
            flex: 1,
            padding: "18px 18px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            scrollbarWidth: "none",
          }}
        >
          {/* Tier status */}
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontFamily: "'Syne', sans-serif",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              Status
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <TierAchievementPill tier={tier} onClick={onTierClick} />
              <StreakAchievementPill
                badge={monthlyBadge}
                label="Monthly badge"
                hint="Post 4+ times"
                onClick={monthlyBadge ? () => onTemporaryClick(monthlyBadge) : undefined}
              />
              <StreakAchievementPill
                badge={weeklyBadge}
                label="Weekly badge"
                hint="Post this week"
                onClick={weeklyBadge ? () => onTemporaryClick(weeklyBadge) : undefined}
              />
            </div>
          </section>

          {/* Earned badges */}
          {badges.length > 0 ? (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                Earned
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                  gap: 10,
                }}
              >
                {badges.map((badge) => (
                  <BadgePill
                    key={badge.badgeId}
                    badgeId={badge.badgeId}
                    name={badge.badgeName}
                    icon={badge.badgeIcon}
                    description={badge.badgeDescription}
                    earnedAt={badge.earnedAt}
                    onClick={() => onBadgeClick(badge)}
                  />
                ))}
              </div>
            </section>
          ) : (
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              No badges earned yet — keep reviewing!
            </p>
          )}

          {/* Almost There */}
          {progress.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                Almost There
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                  gap: 10,
                }}
              >
                {progress.map((item) => (
                  <BadgeProgressPill
                    key={item.badgeId}
                    badgeId={item.badgeId}
                    name={item.badgeName}
                    label={item.label}
                    progressPercent={item.progressPercent}
                    icon={item.badgeIcon}
                    description={item.badgeDescription}
                    onClick={() => onProgressClick(item)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Yet to earn */}
          {lockedAchievements.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                Yet To Earn
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                  gap: 10,
                }}
              >
                {lockedAchievements.map((item) => (
                  <LockedAchievementPill key={item.badgeId} item={item} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main section ───────────────────────────────────────────────────────── */

export default function ProfileReputationSection({
  reputation,
}: {
  reputation: UserProfileReputation;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showAll, setShowAll] = useState(false);

  const weeklyBadge = reputation.temporaryBadges.find(
    (b) => b.badgeId === "weekly_explorer"
  );
  const monthlyBadge = reputation.temporaryBadges.find(
    (b) => b.badgeId === "monthly_explorer"
  );

  const previewBadges = reputation.permanentBadges.slice(0, 3);
  const hiddenCount = Math.max(0, reputation.permanentBadges.length - previewBadges.length);
  const hasContent =
    reputation.permanentBadges.length > 0 ||
    reputation.badgeProgress.length > 0 ||
    reputation.temporaryBadges.length > 0;

  return (
    <div
      style={{
        padding: "0 16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* ── Achievements preview ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: -4,
        }}
      >
        <p
          style={{
            margin: 0,
            color: "var(--muted)",
            fontFamily: "'Syne', sans-serif",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          Achievements
        </p>
        {hasContent && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--orange)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            View All
          </button>
        )}
      </div>

      <HScrollRow>
        <TierAchievementPill
          tier={reputation.tier}
          onClick={() => setDetail({ kind: "tier" })}
        />
        <StreakAchievementPill
          badge={monthlyBadge}
          label="Monthly badge"
          hint="Post 4+ times"
          onClick={monthlyBadge ? () => setDetail({ kind: "temporary", item: monthlyBadge }) : undefined}
        />
        <StreakAchievementPill
          badge={weeklyBadge}
          label="Weekly badge"
          hint="Post this week"
          onClick={weeklyBadge ? () => setDetail({ kind: "temporary", item: weeklyBadge }) : undefined}
        />
        {previewBadges.map((badge) => (
          <BadgePill
            key={badge.badgeId}
            badgeId={badge.badgeId}
            name={badge.badgeName}
            icon={badge.badgeIcon}
            description={badge.badgeDescription}
            earnedAt={badge.earnedAt}
            onClick={() => setDetail({ kind: "permanent", item: badge })}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              width: 88,
              flexShrink: 0,
              borderRadius: 16,
              border: "1px dashed rgba(255,255,255,0.14)",
              background: "none",
              color: "rgba(255,255,255,0.32)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              padding: "12px 8px",
            }}
          >
            <Plus size={14} color="rgba(255,255,255,0.32)" />
            <span>+{hiddenCount} more</span>
          </button>
        )}
      </HScrollRow>

      {/* View All sheet */}
      {showAll && (
        <AllAchievementsSheet
          tier={reputation.tier}
          monthlyBadge={monthlyBadge}
          weeklyBadge={weeklyBadge}
          badges={reputation.permanentBadges}
          progress={reputation.badgeProgress}
          onClose={() => setShowAll(false)}
          onTierClick={() => {
            setShowAll(false);
            setDetail({ kind: "tier" });
          }}
          onTemporaryClick={(badge) => {
            setShowAll(false);
            setDetail({ kind: "temporary", item: badge });
          }}
          onBadgeClick={(badge) => {
            setShowAll(false);
            setDetail({ kind: "permanent", item: badge });
          }}
          onProgressClick={(item) => {
            setShowAll(false);
            setDetail({ kind: "progress", item });
          }}
        />
      )}

      {/* Detail sheets */}
      {detail?.kind === "tier" && (
        <TierDetailSheet
          tier={reputation.tier}
          onClose={() => setDetail(null)}
        />
      )}
      {detail && detail.kind !== "tier" && (
        <BadgeDetailSheet
          detail={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
