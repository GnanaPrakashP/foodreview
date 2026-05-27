"use client";

import { Star } from "lucide-react";
import type { UserTier } from "@/lib/reputation";

function TierOctagonIcon() {
  return (
    <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
      {/* Outer octagon — copper gradient */}
      <div
        style={{
          width: 52,
          height: 52,
          clipPath: "polygon(29% 0%, 71% 0%, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0% 71%, 0% 29%)",
          background: "linear-gradient(145deg, #F5A623 0%, #D97706 45%, #92400E 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Inner octagon — dark */}
        <div
          style={{
            width: 38,
            height: 38,
            clipPath: "polygon(29% 0%, 71% 0%, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0% 71%, 0% 29%)",
            background: "linear-gradient(145deg, #7C2D12 0%, #431407 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Star size={16} strokeWidth={2.5} color="#F59E0B" fill="#F59E0B" />
        </div>
      </div>
    </div>
  );
}

function motivationalText(tier: UserTier): string {
  if (tier.isMaxTier) return "You've reached the top. Culinary Legend!";
  if (tier.progressPercent >= 75) return "Almost at the next tier — keep it going!";
  if (tier.progressPercent >= 40) return "Solid progress — keep exploring and reviewing!";
  return "Keep sharing great food and level up!";
}

export default function TierProgressCard({
  tier,
  profileScore,
}: {
  tier: UserTier;
  profileScore?: number;
}) {
  const score =
    profileScore ??
    Math.round(
      tier.minScore +
        (tier.progressPercent / 100) * ((tier.maxScore ?? tier.minScore + 1) - tier.minScore)
    );

  const scoreLabel = tier.isMaxTier ? `${score}` : `${score} / ${tier.maxScore}`;

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(240,96,48,0.22)",
        background: "linear-gradient(135deg, rgba(28,22,18,0.99), rgba(42,30,20,0.98))",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Top row: octagon icon + tier name + score */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <TierOctagonIcon />
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
                fontSize: 13,
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
            {tier.isMaxTier ? "Top tier achieved" : `${tier.progressPercent}% to ${tier.nextTierName}`}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div
        aria-label={`${tier.progressPercent}% progress`}
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
          color: "rgba(255,255,255,0.35)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {motivationalText(tier)}
      </p>
    </div>
  );
}
