"use client";

import { useState } from "react";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import { canShowInCircleFeed } from "@/lib/circle";

interface RankInfo { rank: number; total: number; visitCount: number }

interface Props {
  restaurantReviews: Review[];
  myName: string;
  circleMembers: string[];
  mutualCircleMembers: string[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  rankMap: Record<string, RankInfo>;
  circleOnly?: boolean;
}

export default function RestaurantPostsClient({
  restaurantReviews,
  myName,
  circleMembers,
  mutualCircleMembers,
  likeCountMap,
  commentMap,
  circleOnly = false,
}: Props) {
  const [filter, setFilter] = useState<"all" | "circle">("all");

  const hasCircle = circleMembers.length > 0 && !circleOnly;
  const circleSet = new Set(circleMembers);
  const mutualSet = new Set(mutualCircleMembers);
  const circleShown = restaurantReviews.filter((review) =>
    canShowInCircleFeed(review, myName, circleSet, mutualSet)
  );
  const shown = (circleOnly || filter === "circle")
    ? circleShown
    : restaurantReviews;

  return (
    <div>
      {/* Toggle */}
      {hasCircle && (
        <div style={{ display: "flex", padding: "0 20px", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          {(["all", "circle"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 500, cursor: "pointer",
                color: filter === f ? "#F59E0B" : "var(--muted)",
                background: "none", border: "none",
                borderBottom: `2px solid ${filter === f ? "#F59E0B" : "transparent"}`,
                fontFamily: "'DM Sans',sans-serif",
                marginBottom: -1,
              }}>
              {f === "all" ? "Everyone" : "Circle"}
            </button>
          ))}
        </div>
      )}

      {/* Posts */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "0 16px 20px" }}>
        {shown.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>
              No circle posts yet
            </p>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              None of your circle has visited this place yet.
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
                topComment={eng?.top ?? null}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
