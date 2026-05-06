"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { restaurantGradient } from "@/lib/profile";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Comment, Review } from "@/lib/types";

interface WishlistItem {
  id: string;
  restaurant_name: string;
  reviews: Review | Review[] | null;
}

function nestedReview(value: Review | Review[] | null): Review | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function SavedPlacesPage() {
  const router = useRouter();
  const [postItems, setPostItems] = useState<Review[]>([]);
  const [placeItems, setPlaceItems] = useState<WishlistItem[]>([]);
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({});
  const [commentMap, setCommentMap] = useState<Record<string, { count: number; top: Comment }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const myName = localStorage.getItem("fc_my_name") ?? "";
    if (!myName) { setLoading(false); return; }

    const supabase = createClient();

    async function loadSavedPosts() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("wishlist")
        .select("id, restaurant_name, reviews(*)")
        .eq("user_name", myName)
        .order("created_at", { ascending: false });

      const rows = (data ?? []) as WishlistItem[];
      const reviews = rows
        .map((row) => nestedReview(row.reviews))
        .filter((review): review is Review => Boolean(review));
      setPlaceItems(rows.filter((row) => !nestedReview(row.reviews)));

      const postIds = reviews.map((review) => review.id);
      if (postIds.length > 0) {
        const [{ data: rawLikes }, { data: rawComments }] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any).from("likes").select("post_id").in("post_id", postIds),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("comments")
            .select("id, post_id, user_name, content, created_at")
            .in("post_id", postIds)
            .order("created_at", { ascending: false }),
        ]);

        const likes: Record<string, number> = {};
        for (const like of (rawLikes ?? []) as { post_id: string }[]) {
          likes[like.post_id] = (likes[like.post_id] ?? 0) + 1;
        }

        const comments: Record<string, { count: number; top: Comment }> = {};
        for (const comment of (rawComments ?? []) as Comment[]) {
          const existing = comments[comment.post_id];
          if (!existing) comments[comment.post_id] = { count: 1, top: comment };
          else existing.count++;
        }

        setLikeCountMap(likes);
        setCommentMap(comments);
      }

      setPostItems(reviews);
      setLoading(false);
    }

    loadSavedPosts();
  }, []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Saved Posts</h1>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {loading ? (
          [1,2,3].map(i => <div key={i} style={{ height: 220, background: "var(--card)", borderRadius: 22, opacity: 0.5 }} className="animate-pulse" />)
        ) : postItems.length === 0 && placeItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <Bookmark size={32} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No saved posts yet</p>
          </div>
        ) : (
          <>
            {postItems.map((review) => (
              <CircleFeedCard
                key={review.id}
                review={review}
                initialLikeCount={likeCountMap[review.id] ?? 0}
                initialCommentCount={commentMap[review.id]?.count ?? 0}
              />
            ))}
            {placeItems.map((item) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
                <div style={{ width: 40, height: 40, background: restaurantGradient(item.restaurant_name), borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                  {item.restaurant_name[0]?.toUpperCase() ?? "?"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.restaurant_name}</p>
                  <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>Saved before posts were attached</p>
                </div>
                <Bookmark size={14} strokeWidth={2} color="var(--gold)" fill="var(--gold)" style={{ flexShrink: 0 }} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
