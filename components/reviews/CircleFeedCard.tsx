"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, MessageCircle, MoreHorizontal, Star } from "lucide-react";
import type { Review } from "@/lib/types";
import PostShareButton from "@/components/posts/PostShareButton";
import { googleMapsUrl, restaurantLocationLabel } from "@/lib/location";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { resolveActorName } from "@/lib/browser-actor";

interface Props {
  review: Review;
  initialLikeCount: number;
  initialCommentCount: number;
  initialLiked?: boolean;
  initialBookmarked?: boolean;
  initialMyName?: string;
  profileMap?: Record<string, string>;
  priorityImage?: boolean;
  onDeleted?: (review: Review) => void;
  requestStatus?: "idle" | "loading" | "pending" | "joined";
  onRequestClick?: () => void;
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

function feedImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
    ) {
      const objectPath = parsed.pathname.replace("/storage/v1/object/public/", "");
      parsed.pathname = `/storage/v1/render/image/public/${objectPath}`;
      parsed.searchParams.set("width", "960");
      parsed.searchParams.set("height", "1200");
      parsed.searchParams.set("resize", "cover");
      parsed.searchParams.set("quality", "78");
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

function invalidateEngagementCaches() {
  invalidateCachedJson("/api/me");
  invalidateCachedJson("/api/feed/circle");
  invalidateCachedJson("/api/feed/public");
}

export default function CircleFeedCard({
  review,
  initialLikeCount,
  initialCommentCount,
  initialLiked = false,
  initialBookmarked = false,
  initialMyName = "",
  profileMap,
  priorityImage = false,
  onDeleted,
  requestStatus,
  onRequestClick,
}: Props) {
  const router = useRouter();
  const locationLabel = restaurantLocationLabel(review);
  const mapsUrl = googleMapsUrl(review);
  const [myName, setMyName] = useState(initialMyName);
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [bounceKey, setBounceKey] = useState(0);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [bookmarkBounceKey, setBookmarkBounceKey] = useState(0);
  const [showPostActions, setShowPostActions] = useState(false);
  const [deletingReview, setDeletingReview] = useState(false);
  const [deleteReviewError, setDeleteReviewError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const commentCount = initialCommentCount;
  const [photoIndex, setPhotoIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const postMenuRef = useRef<HTMLDivElement>(null);

  const rn = review.reviewer_name;
  const reviewerDisplayName = profileMap?.[rn] || rn;
  const initials = (() => {
    const parts = reviewerDisplayName.split(/[\s_]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? reviewerDisplayName[0] ?? "?").toUpperCase();
  })();
  const postHref = `/reviews/${encodeURIComponent(review.id)}`;
  const canDeleteReview = Boolean(myName) && review.reviewer_name === myName;

  useEffect(() => {
    const name = resolveActorName(initialMyName);
    setMyName(name);
    setMounted(true);
  }, [initialMyName]);

  const toggleLike = useCallback(async () => {
    if (!myName || !mounted) return;
    setBounceKey(k => k + 1);
    if (liked) {
      setLiked(false);
      setLikeCount(c => c - 1);
      const response = await fetch("/api/likes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: review.id }),
      });
      if (!response.ok) {
        setLiked(true);
        setLikeCount(c => c + 1);
        return;
      }
      invalidateEngagementCaches();
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_UNLIKED", reviewId: review.id, actorName: myName }),
      }).catch(() => {});
    } else {
      setLiked(true);
      setLikeCount(c => c + 1);
      const response = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: review.id }),
      });
      if (!response.ok) {
        setLiked(false);
        setLikeCount(c => c - 1);
        return;
      }
      invalidateEngagementCaches();
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
    if (bookmarked) {
      setBookmarked(false);
      const response = await fetch("/api/wishlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName: review.restaurant_name }),
      });
      if (!response.ok) setBookmarked(true);
      else invalidateEngagementCaches();
    } else {
      setBookmarked(true);
      const response = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName: review.restaurant_name, postId: review.id }),
      });
      if (!response.ok) setBookmarked(false);
      else invalidateEngagementCaches();
    }
  }, [myName, mounted, bookmarked, review]);

  async function deleteReview() {
    if (!canDeleteReview || deletingReview) return;
    setDeletingReview(true);
    setDeleteReviewError("");
    const response = await fetch(`/api/reviews/${encodeURIComponent(review.id)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      const detail = payload?.error || `Request failed with status ${response.status}`;
      setDeleteReviewError(`Could not delete this post: ${detail}`);
      setDeletingReview(false);
      return;
    }

    invalidateEngagementCaches();

    if (onDeleted) {
      onDeleted(review);
      return;
    }

    router.refresh();
  }

  function requestDeleteReview() {
    if (!canDeleteReview || deletingReview) return;
    setShowPostActions(false);
    setShowDeleteConfirm(true);
  }

  useEffect(() => {
    if (!showPostActions) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && postMenuRef.current && !postMenuRef.current.contains(target)) {
        setShowPostActions(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showPostActions]);

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
            <div style={{ width: "36px", height: "36px", borderRadius: "12px", background: avatarGradient(rn), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "white", flexShrink: 0 }}>
              {initials || "?"}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
                <strong>{reviewerDisplayName}</strong>
                <span style={{ color: "var(--muted)", fontWeight: 400 }}> shared a spot</span>
              </p>
            </div>
          </Link>
          <span suppressHydrationWarning style={{ fontSize: "11px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {timeAgo(review.created_at)}
          </span>
          {requestStatus !== undefined && review.reviewer_name !== myName && (
            <button
              onClick={(e) => { e.stopPropagation(); onRequestClick?.(); }}
              disabled={requestStatus === "loading"}
              style={{
                flexShrink: 0,
                background: requestStatus === "joined"
                  ? "rgba(61,214,140,0.12)"
                  : "rgba(240,96,48,0.12)",
                border: requestStatus === "joined"
                  ? "1.5px solid rgba(61,214,140,0.35)"
                  : "1.5px solid rgba(240,96,48,0.35)",
                color: requestStatus === "joined" ? "var(--green)" : "var(--orange)",
                fontSize: "11px",
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: "100px",
                cursor: requestStatus === "loading" ? "default" : "pointer",
                whiteSpace: "nowrap",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {requestStatus === "pending" ? "Requested" : requestStatus === "joined" ? "In Circle" : "Request"}
            </button>
          )}
          <div ref={postMenuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowPostActions((open) => !open);
              }}
              disabled={deletingReview}
              aria-label="Post actions"
              style={{
                width: 30,
                height: 30,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                borderRadius: "9px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: deletingReview ? "default" : "pointer",
                opacity: deletingReview ? 0.7 : 1,
              }}
            >
              <MoreHorizontal size={15} strokeWidth={2} color="var(--muted)" />
            </button>
            {showPostActions && (
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  minWidth: "152px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  padding: "6px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                  zIndex: 15,
                }}
              >
                {canDeleteReview ? (
                  <button
                    onClick={requestDeleteReview}
                    disabled={deletingReview}
                    style={{ width: "100%", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "9px", padding: "9px 10px", color: "#EF4444", fontSize: "13px", fontWeight: 700, cursor: deletingReview ? "default" : "pointer", fontFamily: "'DM Sans', sans-serif", opacity: deletingReview ? 0.7 : 1, textAlign: "left" }}
                  >
                    {deletingReview ? "Deleting..." : "Delete post"}
                  </button>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: "12px", margin: 0, padding: "8px 6px", fontFamily: "'DM Sans', sans-serif", textAlign: "center" }}>
                    No actions
                  </p>
                )}
              </div>
            )}
          </div>
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
                  scrollbarWidth: "none", aspectRatio: "4/5",
                }}
                className="hide-scrollbar"
              >
                {photos.map((url, i) => (
                  <div key={i} style={{ position: "relative", flexShrink: 0, width: "100%", height: "100%", scrollSnapAlign: "start" }}>
                    <Image
                      src={feedImageUrl(url)}
                      alt={review.restaurant_name}
                      fill
                      sizes="(max-width: 512px) 100vw, 512px"
                      priority={priorityImage && i === 0}
                      loading={priorityImage && i === 0 ? undefined : "lazy"}
                      style={{ objectFit: "cover" }}
                    />
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
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", lineHeight: 1.1, marginBottom: locationLabel ? "1px" : "6px" }}>
            {review.restaurant_name}
          </h2>
          {locationLabel && (
            <a
              href={mapsUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              style={{ display: "inline-block", fontFamily: "'DM Sans', sans-serif", fontSize: "11px", lineHeight: 1.2, color: "var(--muted)", marginTop: 0, marginBottom: "8px", textDecoration: "none" }}
            >
              📍 {locationLabel}
            </a>
          )}
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
            <PostShareButton review={review} reviewerDisplayName={reviewerDisplayName} />
          </div>

          <div style={{ height: "14px" }} />
        </div>
      </article>
      {deleteReviewError && (
        <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", padding: "8px 6px 0" }}>
          {deleteReviewError}
        </p>
      )}
      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete post?"
        message="Delete this post permanently?"
        confirmText={deletingReview ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        disabled={deletingReview}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          setShowDeleteConfirm(false);
          await deleteReview();
        }}
      />
    </>
  );
}
