"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, MessageCircle, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Review } from "@/lib/types";

interface Props {
  review: Review;
  initialLikeCount: number;
  initialCommentCount: number;
  initialLiked?: boolean;
  initialBookmarked?: boolean;
  initialMyName?: string;
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

export default function CircleFeedCard({
  review,
  initialLikeCount,
  initialCommentCount,
  initialLiked = false,
  initialBookmarked = false,
  initialMyName = "",
}: Props) {
  const router = useRouter();
  const [myName, setMyName] = useState(initialMyName);
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [bounceKey, setBounceKey] = useState(0);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [bookmarkBounceKey, setBookmarkBounceKey] = useState(0);
  const commentCount = initialCommentCount;
  const [photoIndex, setPhotoIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const initials = review.reviewer_name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
  const postHref = `/reviews/${encodeURIComponent(review.id)}`;

  useEffect(() => {
    const name = initialMyName || localStorage.getItem("fc_my_name") || "";
    if (name) localStorage.setItem("fc_my_name", name);
    setMyName(name);
    setMounted(true);
    if (!name || initialMyName) return;
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
  }, [initialMyName, review.id, review.restaurant_name]);

  const toggleLike = useCallback(async () => {
    if (!myName || !mounted) return;
    setBounceKey(k => k + 1);
    const supabase = createClient();
    if (liked) {
      setLiked(false);
      setLikeCount(c => c - 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("likes").delete().eq("post_id", review.id).eq("user_name", myName);
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_UNLIKED", reviewId: review.id, actorName: myName }),
      }).catch(() => {});
    } else {
      setLiked(true);
      setLikeCount(c => c + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("likes").insert({ post_id: review.id, user_name: myName });
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_LIKED", reviewId: review.id, actorName: myName }),
      }).catch(() => {});
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
      <article
        role="link"
        tabIndex={0}
        onClick={() => router.push(postHref)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            router.push(postHref);
          }
        }}
        onPointerEnter={() => router.prefetch(postHref)}
        style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "22px", overflow: "hidden", cursor: "pointer" }}
      >

        {/* Header */}
        <div style={{ padding: "13px 14px 11px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Link
            href={`/people/${encodeURIComponent(review.reviewer_name)}`}
            onClick={(event) => event.stopPropagation()}
            style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}
          >
            <div style={{ width: "36px", height: "36px", borderRadius: "12px", background: avatarGradient(review.reviewer_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "white", flexShrink: 0 }}>
              {initials || "?"}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
                <strong>{review.reviewer_name}</strong>
                <span style={{ color: "var(--muted)", fontWeight: 400 }}> shared a spot</span>
              </p>
            </div>
          </Link>
          <span style={{ fontSize: "11px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {timeAgo(review.created_at)}
          </span>
        </div>

        {/* Photo / hero */}
        {(() => {
          const photos = review.photo_urls?.length ? review.photo_urls : review.photo_url ? [review.photo_url] : [];
          if (!photos.length) return null;
          return (
            <div style={{ position: "relative" }}>
              <div
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const idx = Math.round(el.scrollLeft / el.clientWidth);
                  setPhotoIndex(idx);
                }}
                style={{
                  display: "flex", overflowX: "auto", scrollSnapType: "x mandatory",
                  scrollbarWidth: "none", aspectRatio: "3/2",
                }}
                className="hide-scrollbar"
              >
                {photos.map((url, i) => (
                  <div key={i} style={{ position: "relative", flexShrink: 0, width: "100%", scrollSnapAlign: "start" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={review.restaurant_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }} />
                  </div>
                ))}
              </div>
              {photos.length > 1 && (
                <div style={{
                  position: "absolute", top: 10, right: 10,
                  background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)",
                  borderRadius: 20, padding: "3px 9px",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: "white",
                  pointerEvents: "none",
                }}>
                  {photoIndex + 1}/{photos.length}
                </div>
              )}
            </div>
          );
        })()}

        {/* Body */}
        <div style={{ padding: "12px 14px 0" }}>
          {/* Restaurant name */}
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", lineHeight: 1.1, marginBottom: "6px" }}>
            {review.restaurant_name}
          </h2>
{review.body && (
            <div style={{ padding: "8px 10px", background: "var(--orange-dim)", borderLeft: "3px solid var(--orange)", borderRadius: "0 8px 8px 0", marginBottom: "10px" }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.5 }}>
                {review.body}
              </p>
            </div>
          )}

          {review.items.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
              {review.items.map((item, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "4px 8px", fontSize: "11px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
                  {item.name}
                  {item.rating > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "2px", background: "rgba(232,168,48,0.15)", border: "1px solid rgba(232,168,48,0.25)", borderRadius: "5px", padding: "1px 5px" }}>
                      <Star size={8} strokeWidth={0} fill="#E8A830" />
                      <span style={{ fontSize: "10px", color: "var(--gold)", fontWeight: 700, lineHeight: 1 }}>{item.rating}</span>
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Engagement row */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px", paddingTop: "8px", borderTop: "1px solid var(--border)", marginBottom: "8px" }}>
            <button
              key={bounceKey}
              onClick={(event) => {
                event.stopPropagation();
                toggleLike();
              }}
              disabled={!mounted || !myName}
              className={bounceKey > 0 ? "like-pop" : ""}
              style={{ background: "none", border: "none", cursor: mounted && myName ? "pointer" : "default", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
            >
              <Heart size={15} strokeWidth={2} fill={liked ? "#E84040" : "none"} color={liked ? "#E84040" : "var(--muted)"} style={{ transition: "color 0.15s", flexShrink: 0 }} />
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>{likeCount}</span>
            </button>
            <Link
              href={`/comments/${encodeURIComponent(review.id)}`}
              onClick={(event) => event.stopPropagation()}
              style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "5px" }}
            >
              <MessageCircle size={15} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                {commentCount} comment{commentCount !== 1 ? "s" : ""}
              </span>
            </Link>
            <button
              key={`bm-${bookmarkBounceKey}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleBookmark();
              }}
              className={bookmarkBounceKey > 0 ? "like-pop" : ""}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: bookmarked ? "var(--orange)" : "var(--muted)", lineHeight: 0, transition: "color 0.15s", marginLeft: "auto" }}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>

          <div style={{ height: "14px" }} />
        </div>
      </article>
    </>
  );
}
