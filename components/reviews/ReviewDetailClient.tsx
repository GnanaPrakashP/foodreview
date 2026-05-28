"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, Heart, MapPin, MessageCircle, MoreVertical, Send, Star, Utensils } from "lucide-react";
import PostShareButton from "@/components/posts/PostShareButton";
import type { Comment, Review } from "@/lib/types";
import RecommendationFeedback from "@/components/taste-trust/RecommendationFeedback";
import { avatarGradient, avatarInitials } from "@/lib/profile";
import { googleMapsUrl, restaurantLocationLabel } from "@/lib/location";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { invalidateCachedJson, invalidatePostDeletionCaches } from "@/lib/browser-api-cache";
import { resolveActorName } from "@/lib/browser-actor";
import { reviewMediaItems } from "@/lib/review-media";
import { patchPostEngagement, readPostEngagementEntry } from "@/lib/post-engagement-cache";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";

type Props = {
  review: Review;
  initialLikeCount: number;
  initialComments: Comment[];
  initialMyName: string;
  initialLiked?: boolean;
  initialBookmarked?: boolean;
  initialSnapshotAt?: number;
  profileMap?: Record<string, string>;
  initialTasteTrustSummary?: PostTasteTrustSummary;
  autoFocusComment?: boolean;
};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function invalidateEngagementCaches() {
  invalidateCachedJson("/api/me");
  invalidateCachedJson("/api/feed/circle");
  invalidateCachedJson("/api/feed/public");
}

function detailImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
    ) {
      const objectPath = parsed.pathname.replace("/storage/v1/object/public/", "");
      parsed.pathname = `/storage/v1/render/image/public/${objectPath}`;
      parsed.searchParams.set("width", "1080");
      parsed.searchParams.set("height", "1350");
      parsed.searchParams.set("resize", "cover");
      parsed.searchParams.set("quality", "82");
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

export default function ReviewDetailClient({
  review,
  initialLikeCount,
  initialComments,
  initialMyName,
  initialLiked = false,
  initialBookmarked = false,
  initialSnapshotAt = Date.now(),
  profileMap = {},
  initialTasteTrustSummary,
  autoFocusComment = false,
}: Props) {
  const router = useRouter();
  const locationLabel = restaurantLocationLabel(review);
  const mapsUrl = googleMapsUrl(review);
  const [myName, setMyName] = useState(initialMyName);
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [bookmarkBounceKey, setBookmarkBounceKey] = useState(0);
  const [comments, setComments] = useState(initialComments);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingReview, setDeletingReview] = useState(false);
  const [deleteReviewError, setDeleteReviewError] = useState("");
  const [showPostActions, setShowPostActions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tasteTrustSummary, setTasteTrustSummary] = useState<PostTasteTrustSummary | null>(initialTasteTrustSummary ?? null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postMenuRef = useRef<HTMLDivElement>(null);

  const mediaItems = reviewMediaItems(review);
  const reviewerDisplayName = profileMap[review.reviewer_name] || review.reviewer_name;
  const initials = avatarInitials(reviewerDisplayName);
  const canDeleteReview = Boolean(myName) && review.reviewer_name === myName;
  const triedCount = tasteTrustSummary?.tried_count ?? 0;

  useEffect(() => {
    const name = resolveActorName(initialMyName);
    setMyName(name);
  }, [initialMyName]);

  useIsomorphicLayoutEffect(() => {
    const cached = readPostEngagementEntry(review.id);
    setLiked(initialLiked);
    setLikeCount(initialLikeCount);
    setBookmarked(initialBookmarked);
    setComments(initialComments);
    if (!cached || cached.updatedAt <= initialSnapshotAt) return;
    if (cached.liked !== undefined) setLiked(cached.liked);
    if (cached.likeCount !== undefined) setLikeCount(cached.likeCount);
    if (cached.bookmarked !== undefined) setBookmarked(cached.bookmarked);
  }, [initialBookmarked, initialComments, initialLikeCount, initialLiked, initialSnapshotAt, review.id]);

  async function deleteReview() {
    if (!canDeleteReview || deletingReview) return;
    setDeletingReview(true);
    setDeleteReviewError("");
    const response = await fetch(`/api/reviews/${encodeURIComponent(review.id)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setDeleteReviewError("Could not delete this post. Please try again.");
      setDeletingReview(false);
      return;
    }

    invalidatePostDeletionCaches(review.id);
    router.replace("/me");
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

  useEffect(() => {
    if (!autoFocusComment) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 150);
    return () => window.clearTimeout(timer);
  }, [autoFocusComment]);

  const toggleLike = useCallback(async () => {
    if (!myName) return;
    const nextLiked = !liked;
    const nextLikeCount = liked ? Math.max(0, likeCount - 1) : likeCount + 1;
    setLiked(nextLiked);
    setLikeCount(nextLikeCount);
    patchPostEngagement(review.id, { liked: nextLiked, likeCount: nextLikeCount });

    if (liked) {
      const response = await fetch("/api/likes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: review.id }),
      });
      if (!response.ok) {
        setLiked(true);
        setLikeCount(likeCount);
        patchPostEngagement(review.id, { liked: true, likeCount });
        return;
      }
      invalidateEngagementCaches();
      invalidateCachedJson("/api/feed/public");
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_UNLIKED", reviewId: review.id, actorName: myName }),
      }).catch(() => {});
      return;
    }

    const response = await fetch("/api/likes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: review.id }),
    });
    if (!response.ok) {
      setLiked(false);
      setLikeCount(likeCount);
      patchPostEngagement(review.id, { liked: false, likeCount });
      return;
    }
    invalidateEngagementCaches();
    invalidateCachedJson("/api/feed/public");
    await fetch("/api/notifications/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "POST_LIKED", reviewId: review.id, actorName: myName }),
    }).catch(() => {});
  }, [liked, likeCount, myName, review.id]);

  const toggleBookmark = useCallback(async () => {
    if (!myName) return;
    setBookmarkBounceKey((key) => key + 1);
    const nextBookmarked = !bookmarked;
    setBookmarked(nextBookmarked);
    patchPostEngagement(review.id, { bookmarked: nextBookmarked });

    if (bookmarked) {
      const response = await fetch("/api/wishlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: review.id }),
      });
      if (!response.ok) {
        setBookmarked(true);
        patchPostEngagement(review.id, { bookmarked: true });
        return;
      }
      invalidateEngagementCaches();
      invalidateCachedJson("/api/feed/public");
    } else {
      const response = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName: review.restaurant_name, postId: review.id }),
      });
      if (!response.ok) {
        setBookmarked(false);
        patchPostEngagement(review.id, { bookmarked: false });
        return;
      }
      invalidateEngagementCaches();
      invalidateCachedJson("/api/feed/public");
    }
  }, [bookmarked, myName, review.restaurant_name, review.id]);

  async function sendComment() {
    const content = text.trim();
    if (!content || !myName || sending) return;

    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const temp: Comment = { id: tempId, post_id: review.id, user_name: myName, content, created_at: new Date().toISOString() };
    setComments((prev) => [...prev, temp]);
    setText("");

    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: review.id, content }),
    });
    const data = response.ok ? await response.json() as Comment : null;

    if (!data) {
      setComments((prev) => prev.filter((comment) => comment.id !== tempId));
      setText(content);
      setSending(false);
      return;
    }

    if (data) {
      setComments((prev) => prev.map((comment) => comment.id === tempId ? data : comment));
      invalidateEngagementCaches();
      invalidateCachedJson("/api/feed/public");
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_COMMENTED", reviewId: review.id, commentId: data.id, actorName: myName }),
      }).catch(() => {});
    }
    setSending(false);
  }

  async function deleteComment(id: string) {
    const removed = comments.find((comment) => comment.id === id);
    setComments((prev) => prev.filter((comment) => comment.id !== id));
    setDeletingId(null);
    const response = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      if (removed) setComments((prev) => [...prev, removed].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      return;
    }
    invalidateEngagementCaches();
    invalidateCachedJson("/api/feed/public");
    await fetch("/api/notifications/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "POST_COMMENT_DELETED", commentId: id, actorName: myName }),
    }).catch(() => {});
  }

  function startLongPress(commentId: string, owner: string) {
    if (owner !== myName) return;
    longPressTimer.current = setTimeout(() => setDeletingId(commentId), 600);
  }

  function endLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function focusCommentInput() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: "92px" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)", flex: 1 }}>Post</p>
      </div>
      {deleteReviewError && (
        <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", padding: "8px 16px 0" }}>
          {deleteReviewError}
        </p>
      )}

      <div style={{ padding: 0 }}>
        <article style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "12px 4px 10px 12px", display: "flex", alignItems: "center", gap: "10px" }}>
            <Link href={`/people/${encodeURIComponent(review.reviewer_name)}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: avatarGradient(reviewerDisplayName), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                {initials || "?"}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
                  <strong>{reviewerDisplayName}</strong>
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}> shared a spot</span>
                </p>
              </div>
            </Link>
            <div ref={postMenuRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => setShowPostActions((open) => !open)}
                disabled={deletingReview}
                aria-label="Post actions"
                style={{
                  width: 30,
                  height: 30,
                  border: "none",
                  background: "transparent",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: deletingReview ? "default" : "pointer",
                  opacity: deletingReview ? 0.7 : 1,
                }}
              >
                <MoreVertical size={18} strokeWidth={2} color="var(--cream)" />
              </button>
              {showPostActions && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    minWidth: "152px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  padding: "6px",
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

          <div style={{ padding: "0 12px 10px" }}>
            <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", lineHeight: 1.1, marginBottom: locationLabel ? "4px" : 0 }}>
              {review.restaurant_name}
            </h1>
            {locationLabel && (
              <a
                href={mapsUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: "'DM Sans', sans-serif", fontSize: "11px", lineHeight: 1.2, color: "var(--muted)", textDecoration: "none" }}
              >
                <MapPin size={12} strokeWidth={2} />
                <span>{locationLabel}</span>
              </a>
            )}
          </div>

          {mediaItems.length > 0 && (
            <div style={{ position: "relative" }}>
              <div
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const idx = Math.round(el.scrollLeft / el.clientWidth);
                  setPhotoIndex(idx);
                }}
                style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", aspectRatio: "4/5", background: "var(--surface)" }}
                className="hide-scrollbar"
              >
                {mediaItems.map((item, index) => (
                  <div key={`${item.public_url}-${index}`} style={{ position: "relative", flexShrink: 0, width: "100%", height: "100%", scrollSnapAlign: "start" }}>
                    {item.media_type === "video" ? (
                      <video src={item.public_url} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <Image
                        src={detailImageUrl(item.public_url)}
                        alt={review.restaurant_name}
                        fill
                        sizes="(max-width: 512px) 100vw, 512px"
                        priority={index === 0}
                        style={{ objectFit: "cover" }}
                      />
                    )}
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)", pointerEvents: "none" }} />
                  </div>
                ))}
              </div>
              {mediaItems.length > 1 && (
                <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", borderRadius: 20, padding: "3px 9px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: "white", pointerEvents: "none" }}>
                  {photoIndex + 1}/{mediaItems.length}
                </div>
              )}
            </div>
          )}

          <div style={{ padding: "8px 12px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "2px 0 10px" }}>
              <button
                onClick={toggleLike}
                disabled={!myName}
                aria-label={liked ? "Unlike post" : "Like post"}
                style={{ background: "none", border: "none", cursor: myName ? "pointer" : "default", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
              >
                <Heart size={15} strokeWidth={2} fill={liked ? "#E84040" : "none"} color={liked ? "#E84040" : "var(--muted)"} style={{ transition: "color 0.15s", flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>{likeCount}</span>
              </button>
              <button onClick={focusCommentInput} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "5px" }}>
                <MessageCircle size={15} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                  {comments.length}
                </span>
              </button>
              <span
                aria-label={triedCount > 0 ? `${triedCount} tried this` : "No tries yet"}
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <Utensils size={15} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                  {triedCount}
                </span>
              </span>
              <button
                key={`bm-${bookmarkBounceKey}`}
                onClick={toggleBookmark}
                className={bookmarkBounceKey > 0 ? "like-pop" : ""}
                style={{ background: "none", border: "none", cursor: myName ? "pointer" : "default", padding: 0, color: bookmarked ? "var(--orange)" : "var(--muted)", lineHeight: 0, transition: "color 0.15s", marginLeft: "auto" }}
                aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
              >
                <Bookmark size={18} strokeWidth={2} fill={bookmarked ? "currentColor" : "none"} />
              </button>
              <PostShareButton review={review} reviewerDisplayName={reviewerDisplayName} />
            </div>

            {review.body && (
              <div style={{ marginBottom: "10px" }}>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.5 }}>
                  <strong style={{ fontWeight: 800 }}>{reviewerDisplayName}</strong>{" "}
                  {review.body}
                </p>
              </div>
            )}

            {review.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {review.tags.map((tag) => (
                  <span key={tag} style={{ display: "inline-flex", alignItems: "center", background: "rgba(240,96,48,0.1)", border: "1px solid rgba(240,96,48,0.22)", borderRadius: "999px", padding: "4px 8px", fontSize: "10px", color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontWeight: 800, lineHeight: 1 }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {review.items.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {review.items.map((item, i) => (
                  <span key={`${item.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "4px 8px", fontSize: "11px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
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

            <p suppressHydrationWarning style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", margin: 0 }}>
              {timeAgo(review.created_at)}
            </p>
            <RecommendationFeedback
              postId={review.id}
              reviewerName={review.reviewer_name}
              postVisibility={review.visibility}
              myName={myName}
              initialSummary={tasteTrustSummary}
              onSummaryChange={setTasteTrustSummary}
            />
            <div style={{ height: "12px" }} />
          </div>
        </article>
      </div>

      <section style={{ padding: "12px 16px 0" }}>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--cream)", marginBottom: "10px" }}>
          Comments
        </h2>
        {comments.length === 0 ? (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "18px", textAlign: "center" }}>
            <p style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px" }}>No comments yet</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {comments.map((comment) => (
              <div
                key={comment.id}
                onMouseDown={() => startLongPress(comment.id, comment.user_name)}
                onMouseUp={endLongPress}
                onMouseLeave={endLongPress}
                onTouchStart={() => startLongPress(comment.id, comment.user_name)}
                onTouchEnd={endLongPress}
                style={{ display: "flex", gap: "9px", alignItems: "flex-start", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "10px" }}
              >
                <div style={{ width: "30px", height: "30px", borderRadius: "10px", background: avatarGradient(profileMap[comment.user_name] || comment.user_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                  {avatarInitials(profileMap[comment.user_name] || comment.user_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.4 }}>
                    <strong>{profileMap[comment.user_name] || comment.user_name}</strong> {comment.content}
                  </p>
                  <p suppressHydrationWarning style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", marginTop: "3px" }}>
                    {timeAgo(comment.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "512px", borderTop: "1px solid var(--border)", background: "var(--card)", padding: "10px 14px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", display: "flex", alignItems: "center", gap: "10px", zIndex: 20 }}>
        {myName && (
          <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: avatarGradient(myName), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", flexShrink: 0 }}>
            {avatarInitials(myName)}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={myName ? "Add a comment..." : "Set your name to comment"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && sendComment()}
          disabled={!myName}
          maxLength={500}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", minWidth: 0 }}
        />
        <button
          onClick={sendComment}
          disabled={!text.trim() || !myName || sending}
          aria-label="Send comment"
          style={{ width: 38, height: 38, borderRadius: "12px", border: "none", background: text.trim() && myName ? "var(--orange)" : "var(--muted)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: text.trim() && myName ? "pointer" : "default", flexShrink: 0 }}
        >
          <Send size={16} strokeWidth={2.2} />
        </button>
      </div>

      {deletingId && (
        <div onClick={() => setDeletingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 30, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "16px" }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "8px" }}>
            <button onClick={() => deleteComment(deletingId)} style={{ width: "100%", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "12px", padding: "14px", color: "#EF4444", fontSize: "14px", fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Delete comment
            </button>
            <button onClick={() => setDeletingId(null)} style={{ width: "100%", background: "none", border: "none", padding: "11px", color: "var(--muted)", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Cancel
            </button>
          </div>
        </div>
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

    </main>
  );
}
