"use client";

import { useMemo, useState } from "react";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import { normalizeDishName } from "@/lib/dish-normalizer";

type RestaurantTab = "posts" | "dishes" | "menu";

type RestaurantDish = {
  name: string;
  averageRating: number;
  mentions: number;
};

interface Props {
  restaurantReviews: Review[];
  circleRestaurantReviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  profileMap?: Record<string, string>;
  likedByMeMap?: Record<string, boolean>;
  bookmarkedPostMap?: Record<string, boolean>;
  myName?: string;
  circleOnly?: boolean;
}

export default function RestaurantPostsClient({
  restaurantReviews,
  circleRestaurantReviews,
  likeCountMap,
  commentMap,
  profileMap = {},
  likedByMeMap = {},
  bookmarkedPostMap = {},
  myName = "",
  circleOnly = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<RestaurantTab>("posts");
  const shown = circleOnly ? circleRestaurantReviews : restaurantReviews;
  const dishes = useMemo(() => topDishesForRestaurant(shown), [shown]);

  return (
    <div>
      <RestaurantTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "posts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "0 16px 20px" }}>
          {shown.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>
                {circleOnly ? "No circle posts yet" : "No public posts yet"}
              </p>
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                {circleOnly ? "None of your circle has visited this place yet." : "Reviews for this restaurant will appear here."}
              </p>
            </div>
          ) : (
            shown.map((review) => {
              const eng = commentMap[review.id];
              return (
                <CircleFeedCard
                  key={review.id}
                  review={review}
                  initialLikeCount={likeCountMap[review.id] ?? 0}
                  initialCommentCount={eng?.count ?? 0}
                  initialLiked={likedByMeMap[review.id] ?? false}
                  initialBookmarked={bookmarkedPostMap[review.id] ?? false}
                  initialMyName={myName}
                  profileMap={profileMap}
                />
              );
            })
          )}
        </div>
      )}

      {activeTab === "dishes" && (
        <div style={{ padding: "0 16px 20px" }}>
          {dishes.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>
                No dishes yet
              </p>
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                Rated dishes from public posts will appear here.
              </p>
            </div>
          ) : (
            dishes.map((dish) => (
              <div key={dish.name} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, color: "var(--cream)", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {dish.name}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: 3 }}>
                    {dish.mentions} mention{dish.mentions !== 1 ? "s" : ""}
                  </p>
                </div>
                {dish.averageRating > 0 && (
                  <div style={{ minWidth: "46px", height: "38px", borderRadius: "13px", background: "linear-gradient(180deg, rgba(232,168,48,0.18), rgba(232,168,48,0.07))", border: "1px solid rgba(232,168,48,0.28)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--gold)" }}>{formatScore10(dish.averageRating)}</span>
                    <span style={{ marginTop: "2px", fontSize: "8px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontWeight: 800 }}>/10</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "menu" && (
        <div style={{ textAlign: "center", padding: "48px 24px 20px" }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>
            Menu coming soon
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            We will design this tab next.
          </p>
        </div>
      )}
    </div>
  );
}

function RestaurantTabs({ activeTab, onChange }: { activeTab: RestaurantTab; onChange: (tab: RestaurantTab) => void }) {
  const tabs: Array<{ id: RestaurantTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "dishes", label: "Dishes" },
    { id: "menu", label: "Menu" },
  ];

  return (
    <div style={{ display: "flex", padding: "0 16px 16px" }}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "10px 0 9px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              color: active ? "var(--orange)" : "var(--muted)",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${active ? "var(--orange)" : "var(--border)"}`,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function topDishesForRestaurant(reviews: Review[]): RestaurantDish[] {
  const dishes = new Map<string, { ratingTotal: number; ratingCount: number; mentions: number }>();

  for (const review of reviews) {
    for (const item of review.items) {
      if (!item.name.trim()) continue;
      const dishName = normalizeDishName(item.name);
      const existing = dishes.get(dishName) ?? { ratingTotal: 0, ratingCount: 0, mentions: 0 };
      existing.mentions += 1;
      if (item.rating > 0) {
        existing.ratingTotal += item.rating;
        existing.ratingCount += 1;
      }
      dishes.set(dishName, existing);
    }
  }

  return Array.from(dishes.entries())
    .map(([name, dish]) => ({
      name,
      averageRating: dish.ratingCount > 0 ? dish.ratingTotal / dish.ratingCount : 0,
      mentions: dish.mentions,
    }))
    .sort((a, b) => b.averageRating - a.averageRating || b.mentions - a.mentions || a.name.localeCompare(b.name));
}

function formatScore10(value: number): string {
  const score = Math.round(value * 2 * 10) / 10;
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
