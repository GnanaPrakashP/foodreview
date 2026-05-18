"use client";

import { useState } from "react";
import type { Restaurant, BucketStatus } from "@/lib/mock-restaurants";
import { priceLabel } from "@/lib/mock-restaurants";
import { restaurantGradient } from "@/lib/profile";

export type BucketRestaurant = Restaurant & { bucketStatus: BucketStatus };

const TABS: { id: BucketStatus; label: string }[] = [
  { id: "want_to_try", label: "Want to try" },
  { id: "tonight",     label: "Tonight" },
  { id: "try_later",   label: "Try later" },
];

function BucketItem({ restaurant }: { restaurant: BucketRestaurant }) {
  const bg = restaurantGradient(restaurant.name);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
      {/* Gradient thumbnail */}
      <div style={{ width: "60px", height: "60px", borderRadius: "14px", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: "26px", fontWeight: 800, color: "rgba(255,255,255,0.35)", fontFamily: "'Syne', sans-serif" }}>
          {restaurant.name[0]}
        </span>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {restaurant.name}
        </p>
        <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif" }}>
          {restaurant.cuisine} · {restaurant.distanceKm} km · {priceLabel(restaurant.priceRange)}
        </p>
        <p style={{ fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
          ★ {restaurant.rating}
        </p>
      </div>

      {/* Bookmark */}
      <span style={{ fontSize: "20px", color: "var(--orange)", flexShrink: 0 }}>🔖</span>
    </div>
  );
}

export default function BucketList({ bucket }: { bucket: BucketRestaurant[] }) {
  const [activeTab, setActiveTab] = useState<BucketStatus>("want_to_try");

  const counts: Record<BucketStatus, number> = {
    want_to_try: bucket.filter((r) => r.bucketStatus === "want_to_try").length,
    tonight:     bucket.filter((r) => r.bucketStatus === "tonight").length,
    try_later:   bucket.filter((r) => r.bucketStatus === "try_later").length,
  };

  const filtered = bucket.filter((r) => r.bucketStatus === activeTab);

  return (
    <div>
      {/* Section header */}
      <div style={{ padding: "0 16px 12px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Your bucket ({bucket.length})
        </p>
      </div>

      {/* Tab pills */}
      <div style={{ display: "flex", gap: "8px", padding: "0 16px 12px", overflowX: "auto", scrollbarWidth: "none" }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flexShrink: 0,
                padding: "7px 14px",
                borderRadius: "100px",
                border: "none",
                background: active ? "var(--orange)" : "var(--card)",
                color: active ? "white" : "var(--muted)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.15s",
              }}
            >
              {tab.label}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "28px 24px", fontFamily: "'DM Sans', sans-serif" }}>
          Nothing here yet
        </p>
      ) : (
        <div>
          {filtered.map((r) => (
            <BucketItem key={r.id} restaurant={r} />
          ))}
        </div>
      )}
    </div>
  );
}
