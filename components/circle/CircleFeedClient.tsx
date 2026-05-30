"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import { readFeedState, writeFeedState } from "@/lib/browser-feed-state";
import { rankFeedReviewsBySeenState, type SeenPostMap } from "@/lib/feed-ranking";
import { markPostsSeen, readSeenPostMap } from "@/lib/browser-post-views";

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
  preserveOrderOnNav?: boolean;
  refreshMode?: boolean;
}

const FEED_STATE_TTL_MS = 30 * 60 * 1000;
const MAX_PERSISTED_REVIEWS = 120;
const SEEN_VISIBILITY_RATIO = 0.35;
const FEED_STATE_VERSION = "stable-nav-v2";
const MAX_FRESH_UNSEEN_PAGE_LOADS = 8;

type CircleFeedSnapshot = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  profileMap: Record<string, string>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  tasteTrustSummaryMap: Record<string, PostTasteTrustSummary>;
  // hasMore and nextCursor are intentionally excluded: pagination cursor must
  // never be restored from a persisted snapshot. Always use server-provided values.
};

function circleFeedStateKey(viewerName: string) {
  return `/api/feed/circle?viewer=${encodeURIComponent(viewerName || "anonymous")}&stateVersion=${FEED_STATE_VERSION}`;
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
  preserveOrderOnNav = false,
  refreshMode = false,
}: Props) {
  const [initialViewerName] = useState(() => resolveActorName(initialMyName));
  const initialStateKey = circleFeedStateKey(initialViewerName || initialMyName);
  const [persistedSnapshot] = useState(() => !refreshMode && preserveOrderOnNav ? readFeedState<CircleFeedSnapshot>(initialStateKey) : null);
  const [preserveFeedOrderOnNav] = useState(() => !refreshMode && Boolean(persistedSnapshot));
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [myName, setMyName] = useState(initialViewerName);
  const stateKey = circleFeedStateKey(myName || initialMyName);
  const [mounted, setMounted] = useState(false);
  const [feedReviews, setFeedReviews] = useState<Review[]>(persistedSnapshot?.reviews ?? allReviews);
  const [feedLikeCountMap, setFeedLikeCountMap] = useState(persistedSnapshot?.likeCountMap ?? likeCountMap);
  const [feedCommentMap, setFeedCommentMap] = useState(persistedSnapshot?.commentMap ?? commentMap);
  const [feedProfileMap, setFeedProfileMap] = useState<Record<string, string>>(persistedSnapshot?.profileMap ?? initialProfileMap);
  const [feedLikedMap, setFeedLikedMap] = useState(persistedSnapshot?.likedByMeMap ?? initialLikedMap);
  const [feedBookmarkedPostMap, setFeedBookmarkedPostMap] = useState(persistedSnapshot?.bookmarkedPostMap ?? initialBookmarkedPostMap);
  const [feedTasteTrustSummaryMap, setFeedTasteTrustSummaryMap] = useState(persistedSnapshot?.tasteTrustSummaryMap ?? initialTasteTrustSummaryMap);
  const [seenPostMap, setSeenPostMap] = useState<SeenPostMap>(() => readSeenPostMap(initialViewerName || initialMyName));
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<CircleFeedCursor | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [freshUnseenPageLoads, setFreshUnseenPageLoads] = useState(0);
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const seenPostMapRef = useRef<SeenPostMap>({});

  useEffect(() => {
    seenPostMapRef.current = seenPostMap;
  }, [seenPostMap]);

  useEffect(() => {
    const snapshot = readFeedState<CircleFeedSnapshot>(stateKey);
    if (!refreshMode && snapshot && preserveOrderOnNav) {
      setFeedReviews(snapshot.reviews);
      setFeedLikeCountMap(snapshot.likeCountMap);
      setFeedCommentMap(snapshot.commentMap);
      setFeedProfileMap(snapshot.profileMap);
      setFeedLikedMap(snapshot.likedByMeMap);
      setFeedBookmarkedPostMap(snapshot.bookmarkedPostMap);
      setFeedTasteTrustSummaryMap(snapshot.tasteTrustSummaryMap);
      // Always use server-provided pagination — cursor is never restored from snapshot.
      setHasMore(initialHasMore);
      setNextCursor(initialNextCursor);
    } else {
      setFeedReviews(allReviews);
      setFeedLikeCountMap(likeCountMap);
      setFeedCommentMap(commentMap);
      setFeedProfileMap(initialProfileMap);
      setFeedLikedMap(initialLikedMap);
      setFeedBookmarkedPostMap(initialBookmarkedPostMap);
      setFeedTasteTrustSummaryMap(initialTasteTrustSummaryMap);
      setHasMore(initialHasMore);
      setNextCursor(initialNextCursor);
    }

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
    }, 3 * 60 * 1000, { memoryOnly: true });

    const name = resolveActorName(initialMyName);
    setMyName(name);
    setSeenPostMap(readSeenPostMap(name));
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
    preserveOrderOnNav,
    refreshMode,
    stateKey,
  ]);

  // Keep cached SPA navigation stable; only fresh loads apply seen-post reranking.
  const circleReviews = useMemo(
    () => preserveFeedOrderOnNav ? feedReviews : rankFeedReviewsBySeenState(feedReviews, seenPostMap),
    [feedReviews, preserveFeedOrderOnNav, seenPostMap]
  );
  const unseenFeedReviewCount = useMemo(
    () => feedReviews.filter((review) => !seenPostMap[review.id]).length,
    [feedReviews, seenPostMap]
  );

  useEffect(() => {
    // Don't persist until seen-post data is loaded; on refresh this ensures the
    // snapshot is only written after rankFeedReviewsBySeenState has run with the
    // real seenPostMap, not with the empty initial state.
    if (!mounted) return;
    writeFeedState<CircleFeedSnapshot>(stateKey, {
      reviews: circleReviews.slice(0, MAX_PERSISTED_REVIEWS),
      likeCountMap: feedLikeCountMap,
      commentMap: feedCommentMap,
      profileMap: feedProfileMap,
      likedByMeMap: feedLikedMap,
      bookmarkedPostMap: feedBookmarkedPostMap,
      tasteTrustSummaryMap: feedTasteTrustSummaryMap,
    }, FEED_STATE_TTL_MS);
  }, [
    feedBookmarkedPostMap,
    feedCommentMap,
    feedLikedMap,
    feedLikeCountMap,
    feedProfileMap,
    feedTasteTrustSummaryMap,
    circleReviews,
    stateKey,
    mounted,
  ]);

  useEffect(() => {
    const root = feedContainerRef.current;
    if (!root || circleReviews.length === 0) return;

    const container = root;
    const markedThisView = new Set<string>();
    let frame = 0;
    let settleTimer = 0;

    function visiblePostIds() {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const newlySeen: string[] = [];
      const latestSeenMap = seenPostMapRef.current;

      container.querySelectorAll<HTMLElement>("[data-feed-post-id]").forEach((element) => {
        const postId = element.getAttribute("data-feed-post-id") ?? "";
        if (!postId || latestSeenMap[postId] || markedThisView.has(postId)) return;

        const rect = element.getBoundingClientRect();
        const visiblePx = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
        const visibleRatio = visiblePx / Math.max(1, Math.min(rect.height, viewportHeight));
        if (visibleRatio >= SEEN_VISIBILITY_RATIO) newlySeen.push(postId);
      });

      return newlySeen;
    }

    function markVisiblePosts() {
      const newlySeen = visiblePostIds();
      if (newlySeen.length === 0) return;
      for (const postId of newlySeen) markedThisView.add(postId);
      seenPostMapRef.current = markPostsSeen(myName, newlySeen);
    }

    function scanVisiblePosts() {
      frame = 0;
      markVisiblePosts();
    }

    function scheduleScan() {
      if (frame) return;
      frame = window.requestAnimationFrame(scanVisiblePosts);
    }

    function flushBeforeLeaving() {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      markVisiblePosts();
    }

    function flushWhenHidden() {
      if (document.visibilityState === "hidden") flushBeforeLeaving();
    }

    markVisiblePosts();
    scheduleScan();
    settleTimer = window.setTimeout(scheduleScan, 350);
    window.addEventListener("scroll", scheduleScan, { passive: true });
    document.addEventListener("scroll", scheduleScan, { passive: true, capture: true });
    window.addEventListener("resize", scheduleScan);
    window.addEventListener("pagehide", flushBeforeLeaving);
    window.addEventListener("beforeunload", flushBeforeLeaving);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      flushBeforeLeaving();
      if (settleTimer) window.clearTimeout(settleTimer);
      window.removeEventListener("scroll", scheduleScan);
      document.removeEventListener("scroll", scheduleScan, { capture: true });
      window.removeEventListener("resize", scheduleScan);
      window.removeEventListener("pagehide", flushBeforeLeaving);
      window.removeEventListener("beforeunload", flushBeforeLeaving);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [circleReviews, myName]);

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

  useEffect(() => {
    if (
      preserveFeedOrderOnNav ||
      !refreshMode ||
      !mounted ||
      loadingMore ||
      !hasMore ||
      !nextCursor ||
      feedReviews.length === 0 ||
      unseenFeedReviewCount > 0 ||
      freshUnseenPageLoads >= MAX_FRESH_UNSEEN_PAGE_LOADS
    ) {
      return;
    }

    setFreshUnseenPageLoads((count) => count + 1);
    void loadMore();
  // loadMore is intentionally excluded because this effect is gated by feed state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedReviews.length, freshUnseenPageLoads, hasMore, loadingMore, mounted, nextCursor, preserveFeedOrderOnNav, refreshMode, unseenFeedReviewCount]);

  const searchingForUnseenOnRefresh = refreshMode
    && !preserveFeedOrderOnNav
    && !loadMoreError
    && hasMore
    && Boolean(nextCursor)
    && feedReviews.length > 0
    && unseenFeedReviewCount === 0
    && freshUnseenPageLoads < MAX_FRESH_UNSEEN_PAGE_LOADS;

  // Don't render until we've read localStorage to avoid flash
  if (!mounted || searchingForUnseenOnRefresh) {
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
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Your circle is empty
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "260px" }}>
          Add friends to see what they&apos;re eating.
        </p>
        <div style={{ display: "flex", gap: "10px", marginTop: "8px", width: "100%", maxWidth: "320px" }}>
          <Link href="/explore" style={{ flex: 1, textDecoration: "none" }}>
            <button style={{ width: "100%", background: "var(--surface)", color: "var(--cream)", border: "1px solid var(--border)", borderRadius: "14px", padding: "13px", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
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
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
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
      <div ref={feedContainerRef} style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 100px" }}>
        {circleReviews.map((review, index) => {
          const eng = feedCommentMap[review.id];
          return (
            <div key={review.id} data-feed-post-id={review.id}>
              <CircleFeedCard
                review={review}
                initialLikeCount={feedLikeCountMap[review.id] ?? 0}
                initialCommentCount={eng?.count ?? 0}
                initialLiked={feedLikedMap[review.id] ?? false}
                initialBookmarked={feedBookmarkedPostMap[review.id] ?? false}
                tasteTrustSummary={feedTasteTrustSummaryMap[review.id] ?? null}
                initialMyName={myName}
                profileMap={feedProfileMap}
                priorityImage={index < 2}
              />
            </div>
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
              fontFamily: "'DM Sans', sans-serif",
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
