"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Review } from "@/lib/types";
import {
  buildDishComparisons,
  formatDishScore,
  restaurantHref,
  type DishComparison,
  type DishRestaurantPick,
  type DishSortLocation,
} from "@/lib/profile-dishes";

function formatShortDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function scoreColor(score: number): string {
  const score10 = score * 2;
  if (score10 >= 9) return "var(--green)";
  if (score10 >= 7) return "var(--orange)";
  return "var(--muted)";
}

function formatDistance(distanceKm: number | null): string {
  if (distanceKm == null) return "";
  if (distanceKm < 1) return `${Math.max(1, Math.round(distanceKm * 1000))} m away`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km away`;
}

function PickColumn({
  pick,
  emptyLabel,
  detailKind,
}: {
  pick: DishRestaurantPick | null;
  emptyLabel: string;
  detailKind: "tried" | "public";
}) {
  if (!pick) {
    return (
      <div style={{ minWidth: 0 }}>
        <p style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
          -
        </p>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.35, fontFamily: "'DM Sans', sans-serif" }}>
          {emptyLabel}
        </p>
      </div>
    );
  }

  const date = formatShortDate(pick.latestAt);
  const distance = formatDistance(pick.distanceKm);

  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, color: scoreColor(pick.rating), fontFamily: "'DM Sans', sans-serif", fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
        {formatDishScore(pick.rating)}
        <span style={{ color: "var(--cream)", fontSize: 13, fontWeight: 700 }}>/10</span>
      </p>
      <Link href={restaurantHref(pick.restaurantName, pick.restaurantId)} style={{ textDecoration: "none" }}>
        <p style={{ margin: "6px 0 0", color: "var(--cream)", fontSize: 14, fontWeight: 800, lineHeight: 1.25, fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pick.restaurantName}
        </p>
      </Link>
      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.25, fontFamily: "'DM Sans', sans-serif" }}>
        {detailKind === "tried" && date
          ? `Rated on ${date}`
          : `${distance ? `${distance} · ` : ""}Based on ${pick.mentions} public post${pick.mentions !== 1 ? "s" : ""}`}
      </p>
    </div>
  );
}

function DishCard({ item, triedLabel }: { item: DishComparison; triedLabel: string }) {
  return (
    <article
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--cream)", fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
        {item.dishName}
      </h3>
      {item.status === "missing_best_place" && (
        <p style={{ margin: "7px 0 0", color: "var(--orange)", fontSize: 12, fontWeight: 800, lineHeight: 1.25, fontFamily: "'DM Sans', sans-serif" }}>
          Community-best place not tried yet
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 1px minmax(0, 1fr)", gap: 16, alignItems: "start", marginTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: "0 0 9px", color: "var(--green)", fontSize: 11, fontWeight: 900, letterSpacing: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {triedLabel}
          </p>
          <PickColumn pick={item.triedBest} emptyLabel="" detailKind="tried" />
        </div>
        <div style={{ width: 1, minHeight: 96, background: "var(--border)" }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: "0 0 9px", color: item.status === "missing_best_place" ? "var(--orange)" : "var(--muted)", fontSize: 11, fontWeight: 900, letterSpacing: 0, fontFamily: "'DM Sans', sans-serif" }}>
            Community Best
          </p>
          <PickColumn pick={item.bestNow} emptyLabel="Not enough public posts yet" detailKind="public" />
        </div>
      </div>
    </article>
  );
}

export default function ProfileDishesList({
  triedReviews,
  publicReviews,
  triedLabel = "Your Best",
  emptyText = "No dishes yet",
  bottomPadding = 110,
  userLocation = null,
}: {
  triedReviews: Review[];
  publicReviews: Review[];
  triedLabel?: string;
  emptyText?: string;
  bottomPadding?: number;
  userLocation?: DishSortLocation | null;
}) {
  const comparisons = useMemo(() => buildDishComparisons(triedReviews, publicReviews, userLocation), [triedReviews, publicReviews, userLocation]);
  const missingBestCount = comparisons.filter((item) => item.status === "missing_best_place").length;

  if (triedReviews.length === 0 || comparisons.length === 0) {
    return (
      <div style={{ padding: `56px 20px ${bottomPadding}px`, textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>{emptyText}</p>
      </div>
    );
  }

  return (
    <section style={{ padding: `0 20px ${bottomPadding}px` }}>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 14,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, color: missingBestCount ? "var(--orange)" : "var(--green)", fontSize: 14, fontWeight: 900, lineHeight: 1.2, fontFamily: "'DM Sans', sans-serif" }}>
            Best places to try
          </p>
          <p style={{ margin: "5px 0 0", color: "var(--cream)", fontSize: 13, lineHeight: 1.35, fontFamily: "'DM Sans', sans-serif" }}>
            {missingBestCount === 0
              ? "You’ve tried the community-best spots for these dishes."
              : "You’ve had these dishes, but not at their community-best spots."}
          </p>
        </div>
        <p style={{ margin: 0, color: missingBestCount ? "var(--orange)" : "var(--green)", fontSize: 28, fontWeight: 900, lineHeight: 1, fontFamily: "'DM Sans', sans-serif" }}>
          {missingBestCount}/{comparisons.length}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {comparisons.map((item) => (
          <DishCard key={item.dishName} item={item} triedLabel={triedLabel} />
        ))}
      </div>
    </section>
  );
}
