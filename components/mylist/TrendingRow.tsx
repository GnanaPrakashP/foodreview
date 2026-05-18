"use client";

import Link from "next/link";
import type { Restaurant } from "@/lib/mock-restaurants";
import { TRENDING_LIST, priceLabel } from "@/lib/mock-restaurants";
import { restaurantGradient } from "@/lib/profile";

function TrendingCard({ restaurant, rank }: { restaurant: Restaurant; rank: number }) {
  const bg = restaurantGradient(restaurant.name);
  return (
    <Link
      href={`/trending/${encodeURIComponent(restaurant.name)}`}
      style={{ textDecoration: "none", flexShrink: 0, scrollSnapAlign: "start", display: "block", width: "160px" }}
    >
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
        {/* Image area */}
        <div style={{ height: "110px", background: bg, position: "relative" }}>
          {/* Rank badge */}
          <div style={{ position: "absolute", top: "10px", left: "10px", width: "28px", height: "28px", borderRadius: "50%", background: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 800, color: "white", fontFamily: "'Syne', sans-serif" }}>{rank}</span>
          </div>
          {/* Initial */}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "44px", fontWeight: 800, color: "rgba(255,255,255,0.28)", fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>
              {restaurant.name[0]}
            </span>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "10px 12px 12px" }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700, color: "var(--cream)", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {restaurant.name}
          </p>
          <p style={{ fontSize: "11px", color: "var(--muted)", margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
            ★ {restaurant.rating} · {restaurant.distanceKm} km
          </p>
          <p style={{ fontSize: "11px", color: "var(--muted)", margin: "2px 0 0", fontFamily: "'DM Sans', sans-serif" }}>
            {priceLabel(restaurant.priceRange)}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function TrendingRow() {
  return (
    <div>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 12px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Trending near you
        </p>
        <button style={{ background: "none", border: "none", color: "var(--orange)", fontSize: "13px", fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: "'DM Sans', sans-serif" }}>
          See all
        </button>
      </div>

      {/* Scrollable cards */}
      <div style={{ display: "flex", gap: "12px", overflowX: "auto", scrollSnapType: "x mandatory", padding: "0 16px 4px", scrollbarWidth: "none" }}>
        {TRENDING_LIST.map((r, i) => (
          <TrendingCard key={r.id} restaurant={r} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}
