"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import PostDetailSheet from "@/components/reviews/PostDetailSheet";
import type { Review, Comment } from "@/lib/types";

interface Props {
  review: Review;
  rank: number | null;
  totalByReviewer: number;
  visitCount: number;
  initialLikeCount: number;
  initialCommentCount: number;
  topComment: Comment | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function avatarGradient(name: string): string {
  const G = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
    "linear-gradient(135deg,#14B8A6,#0F766E)",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return G[h % G.length];
}

function avatarInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function restaurantEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("idli") || n.includes("dosa") || n.includes("tiffin") || n.includes("murugan")) return "🥘";
  if (n.includes("biryani") || n.includes("mughal") || n.includes("dum")) return "🍛";
  if (n.includes("ramen") || n.includes("nagi") || n.includes("japanese") || n.includes("sushi")) return "🍜";
  if (n.includes("pizza") || n.includes("italiano") || n.includes("pasta")) return "🍕";
  if (n.includes("burger") || n.includes("grill")) return "🍔";
  if (n.includes("mess") || n.includes("madurai") || n.includes("mutton") || n.includes("chicken")) return "🍖";
  if (n.includes("cafe") || n.includes("coffee") || n.includes("brew")) return "☕";
  return "🍽️";
}

function RankPill({ rank, total }: { rank: number; total: number }) {
  const isTop = rank === 1;
  const label = rank === 1 ? "Their #1 pick" : rank === 2 ? "#2 on their list" : rank === 3 ? "#3 on their list" : `#${rank} of ${total}`;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: isTop ? "rgba(232,168,48,0.15)" : "rgba(232,168,48,0.08)", border: `1px solid ${isTop ? "rgba(232,168,48,0.4)" : "rgba(232,168,48,0.18)"}`, borderRadius: "20px", padding: "5px 10px", flexShrink: 0 }}>
      <span style={{ fontSize: "11px", color: "var(--gold)", fontWeight: 600 }}>{isTop ? "🏆" : "📍"} {label}</span>
    </div>
  );
}

export default function CircleFeedCard({ review, rank, totalByReviewer, visitCount, initialLikeCount, initialCommentCount, topComment }: Props) {
  const [myName, setMyName] = useState("");
  const [mounted, setMounted] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [bounceKey, setBounceKey] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkBounceKey, setBookmarkBounceKey] = useState(0);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [previewComment, setPreviewComment] = useState<Comment | null>(topComment);
  const [showDetail, setShowDetail] = useState(false);

  const initials = review.reviewer_name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");

  useEffect(() => {
    const name = localStorage.getItem("fc_my_name") ?? "";
    setMyName(name);
    setMounted(true);
    if (!name) return;
    // Check if already liked
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [{ data: likeData }, { data: wishData }] = await Promise.all([
        (supabase as any).from("likes").select("id").eq("post_id", review.id).eq("user_name", name).maybeSingle(),
        (supabase as any).from("wishlist").select("id").eq("user_name", name).eq("restaurant_name", review.restaurant_name).maybeSingle(),
      ]);
      if (likeData) setLiked(true);
      if (wishData) setBookmarked(true);
    })();
  }, [review.id, review.restaurant_name]);

  const toggleLike = useCallback(async () => {
    if (!myName || !mounted) return;
    setBounceKey(k => k + 1);
    const supabase = createClient();
    if (liked) {
      setLiked(false);
      setLikeCount(c => c - 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("likes").delete().eq("post_id", review.id).eq("user_name", myName);
    } else {
      setLiked(true);
      setLikeCount(c => c + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("likes").insert({ post_id: review.id, user_name: myName });
      // Notification for post owner
      if (review.reviewer_name !== myName) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("notifications").insert({
          recipient_name: review.reviewer_name,
          actor_name: myName,
          type: "like",
          post_id: review.id,
          restaurant_name: review.restaurant_name,
        });
      }
    }
  }, [myName, mounted, liked, review]);

  const toggleBookmark = useCallback(async () => {
    if (!myName || !mounted) return;
    setBookmarkBounceKey(k => k + 1);
    const supabase = createClient();
    if (bookmarked) {
      setBookmarked(false);
      await (supabase as any).from("wishlist").delete().eq("user_name", myName).eq("restaurant_name", review.restaurant_name);
    } else {
      setBookmarked(true);
      await (supabase as any).from("wishlist").insert({ user_name: myName, restaurant_name: review.restaurant_name, post_id: review.id });
    }
  }, [myName, mounted, bookmarked, review]);

  return (
    <>
      {showDetail && (
        <PostDetailSheet
          review={review}
          myName={myName}
          liked={liked}
          likeCount={likeCount}
          onLike={toggleLike}
          onClose={() => setShowDetail(false)}
        />
      )}

      <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "22px", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "13px 14px 11px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: avatarGradient(review.reviewer_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "white", flexShrink: 0 }}>
            {initials || "?"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
              <strong>{review.reviewer_name}</strong>
              <span style={{ color: "var(--muted)", fontWeight: 400 }}> shared a spot</span>
            </p>
          </div>
          <span style={{ fontSize: "11px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {timeAgo(review.created_at)}
          </span>
        </div>

        {/* Photo / emoji hero */}
        <div style={{ position: "relative", height: "230px", background: "linear-gradient(160deg,#2A1008 0%,#6B3318 50%,#A04020 100%)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {review.photo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={review.photo_url} alt={review.restaurant_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: "76px", filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.5))" }}>{restaurantEmoji(review.restaurant_name)}</span>
          }
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)" }} />
          {review.items[0]?.name && (
            <span style={{ position: "absolute", bottom: "12px", left: "12px", background: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.15)", color: "white", fontSize: "11px", fontWeight: 500, padding: "4px 10px", borderRadius: "20px", zIndex: 1 }}>
              {review.items[0].name}
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "14px 14px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "19px", fontWeight: 800, color: "var(--cream)", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {review.restaurant_name}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "5px", fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
                <span>📍</span><span>Near you</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, paddingTop: "2px" }}>
              {rank !== null && <RankPill rank={rank} total={totalByReviewer} />}
              <button
                key={`bm-${bookmarkBounceKey}`}
                onClick={toggleBookmark}
                className={bookmarkBounceKey > 0 ? "like-pop" : ""}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: bookmarked ? "#F06030" : "#7A6E65", lineHeight: 0, transition: "color 0.15s" }}
                aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            </div>
          </div>

          {visitCount >= 3 && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--orange-dim)", border: "1px solid rgba(240,96,48,0.25)", borderRadius: "20px", padding: "4px 10px", marginTop: "8px" }}>
              <span style={{ fontSize: "11px" }}>🏠</span>
              <span style={{ fontSize: "11px", color: "var(--orange)", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                {review.reviewer_name.split(" ")[0]} has been here {visitCount} times — ask them what to order
              </span>
            </div>
          )}

          {review.body && (
            <div style={{ marginTop: "12px", padding: "11px 13px", background: "var(--surface)", borderLeft: "3px solid var(--orange)", borderRadius: "0 12px 12px 0" }}>
              <p style={{ fontFamily: "'Instrument Serif', serif", fontStyle: "italic", fontSize: "15px", color: "var(--cream)", lineHeight: 1.55 }}>
                &ldquo;{review.body}&rdquo;
              </p>
            </div>
          )}

          {review.items.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
              {review.items.map((item, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "20px", padding: "4px 10px", fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
                  {item.name}{item.rating > 0 && <span style={{ fontSize: "10px", letterSpacing: "-1px" }}>{"⭐".repeat(item.rating)}</span>}
                </span>
              ))}
            </div>
          )}

          {/* Engagement row */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "14px" }}>
            <button
              key={bounceKey}
              onClick={toggleLike}
              disabled={!mounted || !myName}
              className={bounceKey > 0 ? "like-pop" : ""}
              style={{ background: "none", border: "none", cursor: mounted && myName ? "pointer" : "default", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
            >
              <span style={{ fontSize: "16px", color: liked ? "#E84040" : "#7A6E65", transition: "color 0.15s" }}>♥</span>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>{likeCount}</span>
            </button>
            <button
              onClick={() => setShowDetail(true)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "5px" }}
            >
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                💬 {commentCount} comment{commentCount !== 1 ? "s" : ""}
              </span>
            </button>
          </div>

          {/* Top comment preview */}
          {previewComment && (
            <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "8px" }}>
              <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: avatarGradient(previewComment.user_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                {avatarInitials(previewComment.user_name)}
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong>{previewComment.user_name}</strong> {previewComment.content}
              </p>
            </div>
          )}

          {/* View all comments */}
          {commentCount > 1 && (
            <button
              onClick={() => setShowDetail(true)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 0 0", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--muted)", display: "block" }}
            >
              View all {commentCount} comments →
            </button>
          )}

          <div style={{ height: "14px" }} />
        </div>
      </article>
    </>
  );
}
