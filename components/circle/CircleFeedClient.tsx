"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Review, Comment } from "@/lib/types";
import type { CircleFeedCursor } from "@/lib/circle-feed";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";
import { Users } from "lucide-react";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { cachedCircleStatus } from "@/lib/browser-circle-status";
import { primeCachedJson } from "@/lib/browser-api-cache";
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
  initialTasteTrustSummaryMap?: Record<string, PostTasteTrustSummary>;
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
  initialTasteTrustSummaryMap = {},
  initialHasMore = false,
  initialNextCursor = null,
}: Props) {
  const hasInitialIdentity = initialMyName.length > 0;
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [myName, setMyName] = useState(initialMyName);
  const [mounted, setMounted] = useState(hasInitialIdentity);
  const [feedReviews, setFeedReviews] = useState<Review[]>(allReviews);
  const [feedLikeCountMap, setFeedLikeCountMap] = useState(likeCountMap);
  const [feedCommentMap, setFeedCommentMap] = useState(commentMap);
  const [feedProfileMap, setFeedProfileMap] = useState<Record<string, string>>(initialProfileMap);
  const [feedLikedMap, setFeedLikedMap] = useState(initialLikedMap);
  const [feedBookmarkedPostMap, setFeedBookmarkedPostMap] = useState(initialBookmarkedPostMap);
  const [feedTasteTrustSummaryMap, setFeedTasteTrustSummaryMap] = useState(initialTasteTrustSummaryMap);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<CircleFeedCursor | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");

  useEffect(() => {
    setFeedReviews(allReviews);
    setFeedLikeCountMap(likeCountMap);
    setFeedCommentMap(commentMap);
    setFeedProfileMap(initialProfileMap);
    setFeedLikedMap(initialLikedMap);
    setFeedBookmarkedPostMap(initialBookmarkedPostMap);
    setFeedTasteTrustSummaryMap(initialTasteTrustSummaryMap);
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
      tasteTrustSummaryMap: initialTasteTrustSummaryMap,
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
    initialTasteTrustSummaryMap,
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
      setFeedTasteTrustSummaryMap((current) => ({ ...current, ...(data.tasteTrustSummaryMap ?? {}) }));
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setLoadMoreError("Could not load more posts. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Don't render until we've read localStorage to avoid flash
  if (!mounted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 100px" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse" style={{ height: "360px", background: "var(--card)", borderBottom: "1px solid var(--border)", opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  // Circle is empty and there are no joined-circle posts to show.
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
          Add friends to see what they&apos;re eating.
        </p>
        <div style={{ display: "flex", gap: "10px", marginTop: "8px", width: "100%", maxWidth: "320px" }}>
          <Link href="/explore" style={{ flex: 1, textDecoration: "none" }}>
            <button style={{ width: "100%", background: "var(--surface)", color: "var(--cream)", border: "1px solid var(--border)", borderRadius: "14px", padding: "13px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              Find friends
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
      <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 100px" }}>
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
              tasteTrustSummary={feedTasteTrustSummaryMap[review.id] ?? null}
              initialMyName={myName}
              profileMap={feedProfileMap}
              priorityImage={index === 0}
            />
          );
        })}
        {loadMoreError && (
          <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", margin: "12px 12px 0" }}>
            {loadMoreError}
          </p>
        )}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: loadingMore ? "var(--surface)" : "var(--orange)",
              color: loadingMore ? "var(--muted)" : "white",
              border: "none",
              borderRadius: "14px",
              padding: "13px",
              margin: "16px 12px 0",
              width: "calc(100% - 24px)",
              fontFamily: "'Syne', sans-serif",
              fontSize: "13px",
              fontWeight: 700,
              cursor: loadingMore ? "default" : "pointer",
            }}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}

        {!hasMore && circleReviews.length > CIRCLE_FEED_PAGE_SIZE && (
          <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "10px 0 20px", fontFamily: "'DM Sans', sans-serif" }}>
            You are caught up for now.
          </p>
        )}
      </div>
    </>
  );
}
