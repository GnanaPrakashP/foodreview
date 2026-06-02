"use client";

import { useState } from "react";
import Image from "next/image";
import { Plus, X } from "lucide-react";
import BadgePill, { AchievementBadgeArtwork, iconForBadge } from "@/components/reputation/BadgePill";
import BadgeProgressPill from "@/components/reputation/BadgeProgressPill";
import type {
  BadgeProgress,
  PermanentBadge,
  UserProfileReputation,
  UserTier,
} from "@/lib/reputation";

type Detail =
  | { kind: "tier" }
  | { kind: "permanent"; item: PermanentBadge }
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
  // Volume milestones
  {
    badgeId: "dozen_reviews",
    badgeName: "Hungry Dozen",
    badgeDescription: "Post ten food reviews.",
    badgeIcon: "layers",
  },
  {
    badgeId: "twenty_five_reviews",
    badgeName: "Quarter Century",
    badgeDescription: "Post twenty-five reviews.",
    badgeIcon: "trophy",
  },
  {
    badgeId: "hundred_reviews",
    badgeName: "Centurion",
    badgeDescription: "Post one hundred reviews.",
    badgeIcon: "crown",
  },
  // Saves & influence
  {
    badgeId: "save_magnet",
    badgeName: "Save Magnet",
    badgeDescription: "Collect 25 saves across all posts.",
    badgeIcon: "bookmark",
  },
  {
    badgeId: "must_try",
    badgeName: "Must Try",
    badgeDescription: "Get a single post saved ten times.",
    badgeIcon: "star",
  },
  // Discovery & loyalty
  {
    badgeId: "taste_pioneer",
    badgeName: "Taste Pioneer",
    badgeDescription: "Review a restaurant among its first three posts.",
    badgeIcon: "flag",
  },
  {
    badgeId: "regular",
    badgeName: "Regular",
    badgeDescription: "Review the same restaurant three or more times.",
    badgeIcon: "coffee",
  },
  // Diversity
  {
    badgeId: "neighborhood_guide",
    badgeName: "Neighborhood Guide",
    badgeDescription: "Post reviews across five different areas.",
    badgeIcon: "map",
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


function badgeBaseId(badgeId: string) {
  return badgeId.split(":")[0];
}

function motivationalText(tier: UserTier): string {
  if (tier.isMaxTier) return "You've reached the top. Culinary Legend!";
  if (tier.progressPercent >= 75) return "Almost there — post useful reviews, get saves, and stay active!";
  if (tier.progressPercent >= 40) return "Keep it up — try new cuisines and places for a boost!";
  return "Post useful reviews, get saves, and confirm others to level up.";
}

const TIER_BADGE_SRC_BY_MIN_SCORE: Record<number, string> = {
  0:    "/badges/tiers-transparent-ui/tier-01-new-taster.png",
  5:    "/badges/tiers-transparent-ui/tier-02-rising-taster.png",
  13:   "/badges/tiers-transparent-ui/tier-03-food-regular.png",
  29:   "/badges/tiers-transparent-ui/tier-04-known-regular.png",
  56:   "/badges/tiers-transparent-ui/tier-05-trusted-palate.png",
  101:  "/badges/tiers-transparent-ui/tier-06-sharp-palate.png",
  176:  "/badges/tiers-transparent-ui/tier-07-tastemaker.png",
  321:  "/badges/tiers-transparent-ui/tier-08-local-tastemaker.png",
  581:  "/badges/tiers-transparent-ui/tier-09-food-authority.png",
  1001: "/badges/tiers-transparent-ui/tier-10-top-food-authority.png",
  1701: "/badges/tiers-transparent-ui/tier-11-culinary-legend.png",
};

const TIER_ROADMAP = [
  { name: "New Taster",        minScore: 0,    maxScore: 4 },
  { name: "Rising Taster",     minScore: 5,    maxScore: 12 },
  { name: "Food Regular",      minScore: 13,   maxScore: 28 },
  { name: "Known Regular",     minScore: 29,   maxScore: 55 },
  { name: "Trusted Palate",    minScore: 56,   maxScore: 100 },
  { name: "Sharp Palate",      minScore: 101,  maxScore: 175 },
  { name: "Tastemaker",        minScore: 176,  maxScore: 320 },
  { name: "Local Tastemaker",  minScore: 321,  maxScore: 580 },
  { name: "Food Authority",    minScore: 581,  maxScore: 1000 },
  { name: "Top Food Authority",minScore: 1001, maxScore: 1700 },
  { name: "Culinary Legend",   minScore: 1701, maxScore: null },
];

function tierBadgeSrc(tier: UserTier) {
  return TIER_BADGE_SRC_BY_MIN_SCORE[tier.minScore] ?? TIER_BADGE_SRC_BY_MIN_SCORE[0];
}

function tierBadgeSrcForMinScore(minScore: number) {
  return TIER_BADGE_SRC_BY_MIN_SCORE[minScore] ?? TIER_BADGE_SRC_BY_MIN_SCORE[0];
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

function TierRoadmapArtwork({
  minScore,
  size,
  muted = false,
}: {
  minScore: number;
  size: number;
  muted?: boolean;
}) {
  return (
    <Image
      src={tierBadgeSrcForMinScore(minScore)}
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
        opacity: muted ? 0.34 : 1,
        filter: muted
          ? "grayscale(0.75) drop-shadow(0 5px 10px rgba(0,0,0,0.18))"
          : "drop-shadow(0 8px 16px rgba(0,0,0,0.26))",
      }}
    />
  );
}

/* ─── Tier achievement pill ──────────────────────────────────────────────── */

function TierAchievementPill({
  tier,
  onClick,
  stretch = false,
}: {
  tier: UserTier;
  onClick: () => void;
  stretch?: boolean;
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
        ...(stretch ? { flex: 1, minWidth: 0 } : { width: 88, flexShrink: 0 }),
        height: 120,
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
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {tier.displayName}
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
        height: 120,
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
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
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
  const currentTierIndex = TIER_ROADMAP.findIndex((item) => item.minScore === tier.minScore);

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
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 512,
          maxHeight: "88dvh",
          overflowY: "auto",
          borderRadius: "20px 20px 0 0",
          border: "1px solid var(--border)",
          borderBottom: "none",
          background: "var(--card)",
          padding: "20px 18px 32px",
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
                  fontFamily: "'DM Sans', sans-serif",
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

        <div
          style={{
            maxHeight: "42vh",
            overflowY: "auto",
            paddingRight: 2,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            scrollbarWidth: "none",
          }}
        >
          {TIER_ROADMAP.map((item, index) => {
            const isCurrent = index === currentTierIndex;
            const isCompleted = index < currentTierIndex;
            const isFuture = index > currentTierIndex;
            const rangeLabel = item.maxScore === null
              ? `${item.minScore}+`
              : `${item.minScore}-${item.maxScore}`;
            return (
              <div
                key={item.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px 8px 8px",
                  borderRadius: 14,
                  border: isCurrent ? "1px solid rgba(240,96,48,0.42)" : "1px solid rgba(255,255,255,0.07)",
                  background: isCurrent ? "rgba(240,96,48,0.12)" : "rgba(255,255,255,0.035)",
                }}
              >
                <TierRoadmapArtwork minScore={item.minScore} size={48} muted={isFuture} />
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      color: isFuture ? "rgba(255,255,255,0.42)" : "var(--cream)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      fontWeight: 800,
                      lineHeight: 1.15,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.name}
                  </p>
                  <p
                    style={{
                      margin: "3px 0 0",
                      color: isFuture ? "rgba(255,255,255,0.26)" : "var(--muted)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {rangeLabel} points
                  </p>
                </div>
                <span
                  style={{
                    color: isCurrent ? "var(--orange)" : isCompleted ? "#22C55E" : "rgba(255,255,255,0.28)",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 11,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isCurrent ? "Now" : isCompleted ? "Done" : "Locked"}
                </span>
              </div>
            );
          })}
        </div>

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
            fontFamily: "'DM Sans', sans-serif",
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
  detail: Extract<Detail, { kind: "permanent" }>;
  onClose: () => void;
}) {
  const name = detail.item.badgeName;
  const description = detail.item.badgeDescription;
  const footer = `Earned ${earnedDate(detail.item.earnedAt)}`;
  const Icon = iconForBadge(
    detail.item.badgeIcon
  );

  // Explorer breakdown (area_explorer or cuisine_explorer)
  const meta = detail.item.metadata ?? {};
  const areas = meta.areas as Array<{ name: string; count: number }> | undefined;
  const cuisines = meta.cuisines as Array<{ name: string; count: number }> | undefined;
  const breakdownItems = areas ?? cuisines;
  const breakdownLabel = areas ? "Areas" : cuisines ? "Cuisines" : null;

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
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 512,
          maxHeight: "88dvh",
          overflowY: "auto",
          borderRadius: "20px 20px 0 0",
          border: "1px solid var(--border)",
          borderBottom: "none",
          background: "var(--card)",
          padding: "20px 18px 32px",
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
            fontFamily: "'DM Sans', sans-serif",
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

        {/* Area / Cuisine breakdown list */}
        {breakdownItems && breakdownItems.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              {breakdownLabel}
            </p>
            <div
              style={{
                maxHeight: "30vh",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                scrollbarWidth: "none",
              }}
            >
              {breakdownItems.map((item) => (
                <div
                  key={item.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(255,255,255,0.035)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--cream)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {item.name}
                  </span>
                  <span
                    style={{
                      color: "var(--orange)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 12,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.count} {item.count === 1 ? "review" : "reviews"}
                  </span>
                </div>
              ))}
            </div>
          </div>
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
            fontFamily: "'DM Sans', sans-serif",
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

function ProgressDetailSheet({
  item,
  onClose,
}: {
  item: BadgeProgress;
  onClose: () => void;
}) {
  const color =
    item.progressPercent >= 66
      ? "#22C55E"
      : item.progressPercent >= 33
        ? "#F59E0B"
        : "#F97316";

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
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 512,
          maxHeight: "88dvh",
          overflowY: "auto",
          borderRadius: "20px 20px 0 0",
          border: "1px solid var(--border)",
          borderBottom: "none",
          background: "var(--card)",
          padding: "20px 18px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Artwork + name + description */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <AchievementBadgeArtwork badgeId={item.badgeId} icon={item.badgeIcon} size={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                color: "var(--cream)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 16,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {item.badgeName}
            </p>
            {item.badgeDescription && (
              <p
                style={{
                  margin: "5px 0 0",
                  color: "var(--muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {item.badgeDescription}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar + label */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              Progress
            </p>
            <p
              style={{
                margin: 0,
                color,
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {item.label}
            </p>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${item.progressPercent}%`,
                height: "100%",
                borderRadius: 999,
                background: color,
                transition: "width 0.6s ease",
              }}
            />
          </div>
        </div>

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
            fontFamily: "'DM Sans', sans-serif",
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
  badges,
  progress,
  onClose,
  onTierClick,
  onBadgeClick,
  onProgressClick,
}: {
  tier: UserTier;
  badges: PermanentBadge[];
  progress: BadgeProgress[];
  onClose: () => void;
  onTierClick: () => void;
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
          maxWidth: 512,
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
              fontFamily: "'DM Sans', sans-serif",
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
          {/* Reputation Tier */}
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              Reputation Tier
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <TierAchievementPill tier={tier} onClick={onTierClick} />
            </div>
          </section>

          {/* Earned badges */}
          {badges.length > 0 ? (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontFamily: "'DM Sans', sans-serif",
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

          {/* To Earn — in-progress first, then locked */}
          {(progress.length > 0 || lockedAchievements.length > 0) && (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p
                style={{
                  margin: 0,
                  color: "var(--muted)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                To Earn
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

  // Most-recently-earned badges first (badges arrive oldest-first from the server)
  const recentBadges = [...reputation.permanentBadges].reverse().slice(0, 2);
  const remainingCount = Math.max(0, reputation.permanentBadges.length - 2);
  const hasContent =
    reputation.permanentBadges.length > 0 ||
    reputation.badgeProgress.length > 0;

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
            fontFamily: "'DM Sans', sans-serif",
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

      <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
        <TierAchievementPill
          tier={reputation.tier}
          onClick={() => setDetail({ kind: "tier" })}
        />
        {recentBadges.map((badge) => (
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
        {remainingCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            style={{
              width: 88,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              height: 120,
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
            <span>+{remainingCount} more</span>
          </button>
        )}
      </div>

      {/* View All sheet */}
      {showAll && (
        <AllAchievementsSheet
          tier={reputation.tier}
          badges={reputation.permanentBadges}
          progress={reputation.badgeProgress}
          onClose={() => setShowAll(false)}
          onTierClick={() => {
            setShowAll(false);
            setDetail({ kind: "tier" });
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
      {detail?.kind === "progress" && (
        <ProgressDetailSheet
          item={detail.item}
          onClose={() => setDetail(null)}
        />
      )}
      {detail?.kind === "permanent" && (
        <BadgeDetailSheet
          detail={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
