"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Heart } from "lucide-react";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Comment, Review } from "@/lib/types";

type LikedPostsResponse = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedRestaurantMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
};

export default function LikedPostsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Review[]>([]);
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({});
  const [commentMap, setCommentMap] = useState<Record<string, { count: number; top: Comment }>>({});
  const [likedByMeMap, setLikedByMeMap] = useState<Record<string, boolean>>({});
  const [bookmarkedRestaurantMap, setBookmarkedRestaurantMap] = useState<Record<string, boolean>>({});
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [myName, setMyName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLikedPosts() {
      try {
        const response = await fetch("/api/me/liked", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as LikedPostsResponse;
        setItems(data.reviews ?? []);
        setLikeCountMap(data.likeCountMap ?? {});
        setCommentMap(data.commentMap ?? {});
        setLikedByMeMap(data.likedByMeMap ?? {});
        setBookmarkedRestaurantMap(data.bookmarkedRestaurantMap ?? {});
        setProfileMap(data.profileMap ?? {});
        setMyName(data.myName ?? "");
      } finally {
        setLoading(false);
      }
    }

    loadLikedPosts();
  }, []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Liked Posts</h1>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {loading ? (
          [1,2,3].map(i => <div key={i} style={{ height: 220, background: "var(--card)", borderRadius: 22, opacity: 0.5 }} className="animate-pulse" />)
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <Heart size={32} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No liked posts yet</p>
          </div>
        ) : items.map((review) => (
          <CircleFeedCard
            key={review.id}
            review={review}
            initialLikeCount={likeCountMap[review.id] ?? 0}
            initialCommentCount={commentMap[review.id]?.count ?? 0}
            initialLiked={likedByMeMap[review.id] ?? true}
            initialBookmarked={bookmarkedRestaurantMap[review.restaurant_name] ?? false}
            initialMyName={myName}
            profileMap={profileMap}
          />
        ))}
      </div>
    </div>
  );
}
