"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import { restaurantGradient } from "@/lib/profile";

/* ─── helpers ─────────────────────────────────────── */

interface DishEntry {
  name: string;
  avgRating5: number;
  orderCount: number;
}

function buildDishes(posts: Review[]): DishEntry[] {
  const map = new Map<string, { totalRating: number; ratingCount: number; orderCount: number }>();
  for (const r of posts) {
    for (const it of r.items) {
      if (!it.name.trim()) continue;
      const key = it.name.trim().toLowerCase();
      const ex = map.get(key);
      if (ex) {
        ex.orderCount++;
        if (it.rating > 0) { ex.totalRating += it.rating; ex.ratingCount++; }
      } else {
        map.set(key, {
          totalRating: it.rating > 0 ? it.rating : 0,
          ratingCount: it.rating > 0 ? 1 : 0,
          orderCount: 1,
        });
      }
    }
  }
  return [...map.entries()]
    .map(([key, d]) => ({
      name: key,
      avgRating5: d.ratingCount > 0 ? Math.round((d.totalRating / d.ratingCount) * 10) / 10 : 0,
      orderCount: d.orderCount,
    }))
    .sort((a, b) => b.avgRating5 - a.avgRating5 || b.orderCount - a.orderCount);
}

/* ─── component ───────────────────────────────────── */

interface Props {
  username: string;
  restaurantName: string;
  posts: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  rankMap: Record<string, { rank: number; total: number; visitCount: number }>;
  profileMap?: Record<string, string>;
  initialMyName?: string;
}

export default function RestaurantDetailClient({
  username,
  restaurantName,
  posts,
  likeCountMap,
  commentMap,
  rankMap,
  profileMap,
  initialMyName = "",
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"posts" | "dishes">("posts");
  const [visiblePosts, setVisiblePosts] = useState(posts);
  const [shouldRedirectToProfile, setShouldRedirectToProfile] = useState(false);
  const profileHref = `/people/${encodeURIComponent(username)}`;

  const dishes = useMemo(() => buildDishes(visiblePosts), [visiblePosts]);

  useEffect(() => {
    if (!shouldRedirectToProfile) return;
    router.replace(profileHref);
    router.refresh();
  }, [profileHref, router, shouldRedirectToProfile]);

  function handlePostDeleted(deletedPost: Review) {
    const nextPosts = visiblePosts.filter((post) => post.id !== deletedPost.id);
    setVisiblePosts(nextPosts);
    if (nextPosts.length === 0) setShouldRedirectToProfile(true);
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href={profileHref} style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
          </div>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <div style={{ width: 40, height: 40, background: restaurantGradient(restaurantName), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
            {restaurantName[0]?.toUpperCase() ?? "?"}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "16px", color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {restaurantName}
            </h1>
            <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>
              {visiblePosts.length} visit{visiblePosts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", margin: "0 20px" }}>
        {(["posts", "dishes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              flex: 1, background: "none", border: "none", cursor: "pointer",
              padding: "11px 0",
              fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, letterSpacing: "0.3px",
              color: activeTab === t ? "var(--orange)" : "var(--muted)",
              borderBottom: `2px solid ${activeTab === t ? "var(--orange)" : "transparent"}`,
              marginBottom: "-1px", textTransform: "capitalize",
            }}
          >
            {t === "posts" ? "Posts" : "Dishes"}
          </button>
        ))}
      </div>

      {/* Posts tab */}
      {activeTab === "posts" && (
        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: "16px" }}>
          {visiblePosts.map((post) => {
            const info = rankMap[post.id];
            const eng = commentMap[post.id];
            return (
              <CircleFeedCard
                key={post.id}
                review={post}
                initialLikeCount={likeCountMap[post.id] ?? 0}
                initialCommentCount={eng?.count ?? 0}
                initialMyName={initialMyName}
                profileMap={profileMap}
                onDeleted={handlePostDeleted}
              />
            );
          })}
        </div>
      )}

      {/* Dishes tab */}
      {activeTab === "dishes" && (
        <div style={{ padding: "16px 20px 0" }}>
          {dishes.length === 0 ? (
            <p style={{ textAlign: "center", padding: "48px 0", fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
              No dishes logged
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {dishes.map((d, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: "12px", padding: "13px 14px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d.name.charAt(0).toUpperCase() + d.name.slice(1)}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
                      ordered {d.orderCount}×
                    </p>
                  </div>
                  {d.avgRating5 > 0 ? (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: "12px", color: "var(--gold)" }}>
                        {"★".repeat(Math.round(d.avgRating5))}{"☆".repeat(Math.max(0, 5 - Math.round(d.avgRating5)))}
                      </div>
                      <p style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "2px" }}>
                        {d.avgRating5}/5 avg
                      </p>
                    </div>
                  ) : (
                    <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>no rating</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
