"use client";

import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";

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
  const shown = circleOnly ? circleRestaurantReviews : restaurantReviews;

  return (
    <div>
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
                initialLiked={likedByMeMap[review.id] ?? false}
                initialBookmarked={bookmarkedPostMap[review.id] ?? false}
                initialMyName={myName}
                profileMap={profileMap}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
