"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Review, Comment } from "@/lib/types";
import type { CircleFeedCursor } from "@/lib/circle-feed";
import { Users } from "lucide-react";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { cachedCircleStatus } from "@/lib/browser-circle-status";
import { cachedJson, primeCachedJson, invalidateCachedJson } from "@/lib/browser-api-cache";
import { invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { resolveActorName } from "@/lib/browser-actor";

interface Props {
  allReviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  rankMap: Record<string, { rank: number; total: number; visitCount: number }>;
  initialProfileMap?: Record<string, string>;
  initialMyName?: string;
  initialCircle?: string[];
  initialMutualCircle?: string[];
  initialLikedMap?: Record<string, boolean>;
  initialBookmarkedPostMap?: Record<string, boolean>;
  initialHasMore?: boolean;
  initialNextCursor?: CircleFeedCursor | null;
}

export default function CircleFeedClient({
  allReviews,
  likeCountMap,
  commentMap,
  rankMap,
  initialProfileMap = {},
  initialMyName = "",
  initialCircle = [],
  initialMutualCircle = [],
  initialLikedMap = {},
  initialBookmarkedPostMap = {},
  initialHasMore = false,
  initialNextCursor = null,
}: Props) {
  const hasInitialIdentity = initialMyName.length > 0;
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [mutualCircle, setMutualCircle] = useState<string[]>(initialMutualCircle);
  const [myName, setMyName] = useState(initialMyName);
  const [mounted, setMounted] = useState(hasInitialIdentity);
  const [feedReviews, setFeedReviews] = useState<Review[]>(allReviews);
  const [feedLikeCountMap, setFeedLikeCountMap] = useState(likeCountMap);
  const [feedCommentMap, setFeedCommentMap] = useState(commentMap);
  const [feedProfileMap, setFeedProfileMap] = useState<Record<string, string>>(initialProfileMap);
  const [feedLikedMap, setFeedLikedMap] = useState(initialLikedMap);
  const [feedBookmarkedPostMap, setFeedBookmarkedPostMap] = useState(initialBookmarkedPostMap);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<CircleFeedCursor | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");

  // Public feed section — shown after circle posts are exhausted
  const [publicReviews, setPublicReviews] = useState<Review[]>([]);
  const [publicLikeCountMap, setPublicLikeCountMap] = useState<Record<string, number>>({});
  const [publicCommentMap, setPublicCommentMap] = useState<Record<string, { count: number; top: Comment }>>({});
  const [publicLikedMap, setPublicLikedMap] = useState<Record<string, boolean>>({});
  const [publicBookmarkedMap, setPublicBookmarkedMap] = useState<Record<string, boolean>>({});
  const [publicProfileMap, setPublicProfileMap] = useState<Record<string, string>>({});
  const [publicHasMore, setPublicHasMore] = useState(false);
  const [publicNextCursor, setPublicNextCursor] = useState<CircleFeedCursor | null>(null);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [publicStarted, setPublicStarted] = useState(false);

  // Per-person request state shared across all cards for the same reviewer
  const [personStates, setPersonStates] = useState<Record<string, "idle" | "loading" | "pending" | "joined">>({});
  const [confirmCancelName, setConfirmCancelName] = useState<string | null>(null);
  const [confirmLeaveName, setConfirmLeaveName] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    setFeedReviews(allReviews);
    setFeedLikeCountMap(likeCountMap);
    setFeedCommentMap(commentMap);
    setFeedProfileMap(initialProfileMap);
    setFeedLikedMap(initialLikedMap);
    setFeedBookmarkedPostMap(initialBookmarkedPostMap);
    setHasMore(initialHasMore);
    setNextCursor(initialNextCursor);

    primeCachedJson("/api/feed/circle", {
      reviews: allReviews,
      likeCountMap,
      commentMap,
      rankMap,
      profileMap: initialProfileMap,
      likedByMeMap: initialLikedMap,
      bookmarkedPostMap: initialBookmarkedPostMap,
      myName: initialMyName,
      joinedCircles: initialCircle,
      mutualMembers: initialMutualCircle,
      hasMore: initialHasMore,
      nextCursor: initialNextCursor,
    }, 3 * 60 * 1000);

    const name = resolveActorName(initialMyName);
    setMyName(name);
    // When server already provided authenticated identity + circle data,
    // trust that snapshot to avoid client-side status drift hiding posts.
    if (initialMyName) {
      setMounted(true);
      return;
    }
    if (!name) { setMounted(true); return; }
    cachedCircleStatus(name)
      .then((data) => {
        setCircle(data.members ?? []);
        setMutualCircle(data.mutualMembers ?? []);
      })
      .catch(() => {})
      .finally(() => setMounted(true));
  }, [
    allReviews,
    likeCountMap,
    commentMap,
    rankMap,
    initialProfileMap,
    initialLikedMap,
    initialBookmarkedPostMap,
    initialMyName,
    initialCircle,
    initialMutualCircle,
    initialHasMore,
    initialNextCursor,
  ]);

  // `allReviews` is already filtered server-side for this viewer and circle graph.
  // Keep client rendering aligned with server results to avoid drift.
  const circleReviews = feedReviews;

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const params = new URLSearchParams({
        limit: String(CIRCLE_FEED_PAGE_SIZE),
      });
      if (nextCursor) params.set("cursor", JSON.stringify(nextCursor));
      const response = await fetch(`/api/feed/circle?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Unable to load more posts");

      setFeedReviews((current) => {
        const seen = new Set(current.map((review) => review.id));
        const fresh = (data.reviews ?? []).filter((review: Review) => !seen.has(review.id));
        return [...current, ...fresh];
      });
      setFeedLikeCountMap((current) => ({ ...current, ...(data.likeCountMap ?? {}) }));
      setFeedCommentMap((current) => ({ ...current, ...(data.commentMap ?? {}) }));
      setFeedProfileMap((current) => ({ ...current, ...(data.profileMap ?? {}) }));
      setFeedLikedMap((current) => ({ ...current, ...(data.likedByMeMap ?? {}) }));
      setFeedBookmarkedPostMap((current) => ({ ...current, ...(data.bookmarkedPostMap ?? {}) }));
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setLoadMoreError("Could not load more posts. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const PUBLIC_FEED_TTL_MS = 3 * 60 * 1000;

  async function loadPublic(cursor: CircleFeedCursor | null = null) {
    if (publicLoading) return;
    setPublicLoading(true);
    setPublicError("");
    setPublicStarted(true);
    try {
      // Exclude everyone whose posts already appear in the circle section
      const excludeNames = [...circle, myName].filter(Boolean);
      const params = new URLSearchParams({ limit: String(CIRCLE_FEED_PAGE_SIZE) });
      if (excludeNames.length > 0) params.set("exclude", excludeNames.join(","));
      if (myName) params.set("viewer", myName);
      if (cursor) params.set("cursor", JSON.stringify(cursor));
      const url = `/api/feed/public?${params}`;
      // Use cachedJson for the first page during normal navigation. A browser reload
      // bypasses the stored value once so deleted posts do not reappear from sessionStorage.
      const data = cursor
        ? await fetch(url, { cache: "no-store" }).then((r) => r.json())
        : await cachedJson(url, PUBLIC_FEED_TTL_MS, { bypassOnReload: true });
      if (data?.error) throw new Error(data.error);

      setPublicReviews((current) => {
        const seen = new Set(current.map((r) => r.id));
        const fresh = (data.reviews ?? []).filter((r: Review) => !seen.has(r.id));
        return [...current, ...fresh];
      });
      setPublicLikeCountMap((current) => ({ ...current, ...(data.likeCountMap ?? {}) }));
      setPublicCommentMap((current) => ({ ...current, ...(data.commentMap ?? {}) }));
      setPublicLikedMap((current) => ({ ...current, ...(data.likedByMeMap ?? {}) }));
      setPublicBookmarkedMap((current) => ({ ...current, ...(data.bookmarkedPostMap ?? {}) }));
      setPublicProfileMap((current) => ({ ...current, ...(data.profileMap ?? {}) }));
      setPublicHasMore(Boolean(data.hasMore));
      setPublicNextCursor(data.nextCursor ?? null);
    } catch {
      setPublicError("Could not load public posts. Please try again.");
    } finally {
      setPublicLoading(false);
    }
  }

  function setPersonState(name: string, state: "idle" | "loading" | "pending" | "joined") {
    setPersonStates((prev) => ({ ...prev, [name]: state }));
  }

  async function sendPublicRequest(receiverName: string) {
    if (!myName || myName === receiverName) return;
    // Optimistic: assume public account → In Circle immediately
    setPersonState(receiverName, "joined");
    try {
      const res = await fetch("/api/circle/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverName }),
      });
      const data = await res.json();
      if (!res.ok) { setPersonState(receiverName, "idle"); return; }
      // Correct if private account (pending request instead)
      if (data.status === "pending") setPersonState(receiverName, "pending");
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(receiverName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } catch {
      setPersonState(receiverName, "idle");
    }
  }

  async function cancelPublicRequest(receiverName: string) {
    if (actionBusy) return;
    setActionBusy(true);
    setPersonState(receiverName, "loading");
    try {
      const res = await fetch("/api/circle/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverName }),
      });
      if (!res.ok) { setPersonState(receiverName, "pending"); return; }
      setPersonState(receiverName, "idle");
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(receiverName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } finally {
      setActionBusy(false);
    }
  }

  async function leavePublicCircle(otherName: string) {
    if (actionBusy) return;
    setActionBusy(true);
    setPersonState(otherName, "loading");
    try {
      const res = await fetch("/api/circle/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherName }),
      });
      if (!res.ok) { setPersonState(otherName, "joined"); return; }
      setPersonState(otherName, "idle");
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(otherName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } finally {
      setActionBusy(false);
    }
  }

  function handleRequestClick(reviewerName: string) {
    const state = personStates[reviewerName] ?? "idle";
    if (state === "idle") sendPublicRequest(reviewerName);
    else if (state === "pending") setConfirmCancelName(reviewerName);
    else if (state === "joined") setConfirmLeaveName(reviewerName);
  }

  // Don't render until we've read localStorage to avoid flash
  if (!mounted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 16px 100px" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse" style={{ height: "280px", background: "var(--card)", borderRadius: "20px", opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  // Circle is empty and no own posts to show
  if (circle.length === 0 && circleReviews.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 24px 100px", gap: "12px" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--orange-dim)", border: "1.5px solid rgba(240,96,48,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Users size={28} strokeWidth={1.8} color="var(--orange)" />
        </div>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Your circle is empty
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "260px" }}>
          Add friends to see what they&apos;re eating — or be the first to share a spot.
        </p>
        <div style={{ display: "flex", gap: "10px", marginTop: "8px", width: "100%", maxWidth: "320px" }}>
          <Link href="/people" style={{ flex: 1, textDecoration: "none" }}>
            <button style={{ width: "100%", background: "var(--surface)", color: "var(--cream)", border: "1px solid var(--border)", borderRadius: "14px", padding: "13px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              Find friends
            </button>
          </Link>
          <Link href="/reviews/new" style={{ flex: 1, textDecoration: "none" }}>
            <button style={{ width: "100%", background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "13px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              Share a spot
            </button>
          </Link>
        </div>
      </div>
    );
  }

  // Circle has people but none have posted yet
  if (circleReviews.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 24px 100px", gap: "12px" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--orange-dim)", border: "1.5px solid rgba(240,96,48,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Users size={28} strokeWidth={1.8} color="var(--orange)" />
        </div>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Your circle hasn&apos;t posted yet
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "260px" }}>
          {circle.length === 1 ? "They haven't" : "None of them have"} logged a place yet. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 16px 100px" }}>
        {circleReviews.map((review, index) => {
          const eng = feedCommentMap[review.id];
          return (
            <CircleFeedCard
              key={review.id}
              review={review}
              initialLikeCount={feedLikeCountMap[review.id] ?? 0}
              initialCommentCount={eng?.count ?? 0}
              initialLiked={feedLikedMap[review.id] ?? false}
              initialBookmarked={feedBookmarkedPostMap[review.id] ?? false}
              initialMyName={myName}
              profileMap={feedProfileMap}
              priorityImage={index === 0}
            />
          );
        })}
        {loadMoreError && (
          <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", margin: 0 }}>
            {loadMoreError}
          </p>
        )}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              width: "100%",
              background: loadingMore ? "var(--surface)" : "var(--orange)",
              color: loadingMore ? "var(--muted)" : "white",
              border: "none",
              borderRadius: "14px",
              padding: "13px",
              fontFamily: "'Syne', sans-serif",
              fontSize: "13px",
              fontWeight: 700,
              cursor: loadingMore ? "default" : "pointer",
            }}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}

        {/* Public section — shown once circle posts are fully loaded */}
        {!hasMore && (
          <>
            {/* Section header */}
            <div style={{ margin: "12px 0 4px", borderRadius: "18px", background: "var(--surface)", border: "1px solid var(--border)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800, color: "var(--cream)", margin: 0 }}>
                  Discover People
                </p>
                <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--muted)", flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600, color: "var(--orange)" }}>
                  Join new circles
                </span>
              </div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--muted)", margin: 0, lineHeight: 1.4 }}>
                Posts from people whose circles you haven&apos;t joined yet
              </p>
            </div>

            {/* Public posts */}
            {publicReviews.map((review) => {
              const eng = publicCommentMap[review.id];
              const rn = review.reviewer_name;
              return (
                <CircleFeedCard
                  key={review.id}
                  review={review}
                  initialLikeCount={publicLikeCountMap[review.id] ?? 0}
                  initialCommentCount={eng?.count ?? 0}
                  initialLiked={publicLikedMap[review.id] ?? false}
                  initialBookmarked={publicBookmarkedMap[review.id] ?? false}
                  initialMyName={myName}
                  profileMap={publicProfileMap}
                  priorityImage={false}
                  requestStatus={personStates[rn] ?? "idle"}
                  onRequestClick={() => handleRequestClick(rn)}
                />
              );
            })}

            {publicError && (
              <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", margin: 0 }}>
                {publicError}
              </p>
            )}

            {!publicStarted && (
              <button
                onClick={() => loadPublic(null)}
                disabled={publicLoading}
                style={{
                  width: "100%",
                  background: "var(--surface)",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  padding: "13px",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {publicLoading ? "Loading..." : "Show public posts"}
              </button>
            )}

            {publicStarted && publicHasMore && (
              <button
                onClick={() => loadPublic(publicNextCursor)}
                disabled={publicLoading}
                style={{
                  width: "100%",
                  background: publicLoading ? "var(--surface)" : "var(--orange)",
                  color: publicLoading ? "var(--muted)" : "white",
                  border: "none",
                  borderRadius: "14px",
                  padding: "13px",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: publicLoading ? "default" : "pointer",
                }}
              >
                {publicLoading ? "Loading..." : "Load more"}
              </button>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        open={Boolean(confirmCancelName)}
        title="Cancel request?"
        message={confirmCancelName ? `Cancel your request to join ${publicProfileMap[confirmCancelName] || confirmCancelName}'s circle?` : ""}
        confirmText="Cancel request"
        disabled={actionBusy}
        onCancel={() => setConfirmCancelName(null)}
        onConfirm={async () => {
          const target = confirmCancelName;
          if (!target) return;
          setConfirmCancelName(null);
          await cancelPublicRequest(target);
        }}
      />
      <ConfirmModal
        open={Boolean(confirmLeaveName)}
        title="Leave circle?"
        message={confirmLeaveName ? `Do you no longer want to be in ${publicProfileMap[confirmLeaveName] || confirmLeaveName}'s circle?` : ""}
        confirmText="Leave"
        confirmVariant="danger"
        disabled={actionBusy}
        onCancel={() => setConfirmLeaveName(null)}
        onConfirm={async () => {
          const target = confirmLeaveName;
          if (!target) return;
          setConfirmLeaveName(null);
          await leavePublicCircle(target);
        }}
      />
    </>
  );
}
