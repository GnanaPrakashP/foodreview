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
        {detailKind === "tried" && date ? `Rated on ${date}` : `Based on ${pick.mentions} public post${pick.mentions !== 1 ? "s" : ""}`}
      </p>
    </div>
  );
}

function DishCard({ item }: { item: DishComparison }) {
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 1px minmax(0, 1fr)", gap: 16, alignItems: "center", marginTop: 14 }}>
        <PickColumn pick={item.triedBest} emptyLabel="" detailKind="tried" />
        <div style={{ width: 1, minHeight: 72, background: "var(--border)" }} />
        <PickColumn pick={item.bestNow} emptyLabel="Not enough public posts yet" detailKind="public" />
      </div>
    </article>
  );
}

export default function ProfileDishesList({
  triedReviews,
  publicReviews,
  triedLabel = "Your best",
  emptyText = "No dishes yet",
  bottomPadding = 110,
}: {
  triedReviews: Review[];
  publicReviews: Review[];
  triedLabel?: string;
  emptyText?: string;
  bottomPadding?: number;
}) {
  const comparisons = useMemo(() => buildDishComparisons(triedReviews, publicReviews), [triedReviews, publicReviews]);

  if (triedReviews.length === 0 || comparisons.length === 0) {
    return (
      <div style={{ padding: `56px 20px ${bottomPadding}px`, textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>{emptyText}</p>
      </div>
    );
  }

  return (
    <section style={{ padding: `0 20px ${bottomPadding}px` }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 1px minmax(0, 1fr)", gap: 16, padding: "0 18px 11px" }}>
        <p style={{ margin: 0, color: "var(--green)", fontSize: 11, fontWeight: 900, letterSpacing: 0, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
          {triedLabel}
        </p>
        <span />
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 11, fontWeight: 900, letterSpacing: 0, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
          Best now (public)
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {comparisons.map((item) => (
          <DishCard key={item.dishName} item={item} />
        ))}
      </div>
    </section>
  );
}
