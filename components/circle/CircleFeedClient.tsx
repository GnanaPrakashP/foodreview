"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Review, Comment } from "@/lib/types";
import type { CircleFeedCursor } from "@/lib/circle-feed";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";
import { Users } from "lucide-react";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { cachedCircleStatus, invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import { invalidateCachedJson, primeCachedJson } from "@/lib/browser-api-cache";
import { resolveActorName } from "@/lib/browser-actor";
import { readFeedState, writeFeedState } from "@/lib/browser-feed-state";
import type { SeenPostMap } from "@/lib/feed-ranking";
import { markPostsSeen, readSeenPostMap } from "@/lib/browser-post-views";
import {
  addName,
  isAcceptedCircleResponse,
  isOneWayCircleResponse,
  personStatusFor,
  removeName,
} from "@/lib/people-circle-state";

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
const SEEN_DWELL_MS = 1000;
const SEEN_EXIT_DWELL_MS = 250;
const FEED_STATE_VERSION = "mixed-circle-public-v1";

type CircleFeedSnapshot = {
  reviews: Review[];
  publicPostIds?: string[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  profileMap: Record<string, string>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  tasteTrustSummaryMap: Record<string, PostTasteTrustSummary>;
  // hasMore and nextCursor are intentionally excluded: pagination cursor must
  // never be restored from a persisted snapshot. Always use server-provided values.
};

type PublicFeedResponse = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  hasMore: boolean;
  nextCursor: CircleFeedCursor | null;
  error?: string;
};

function circleFeedStateKey(viewerName: string) {
  return `/api/feed/circle?viewer=${encodeURIComponent(viewerName || "anonymous")}&stateVersion=${FEED_STATE_VERSION}`;
}

function publicFallbackUrl(
  viewerName: string,
  cursor: CircleFeedCursor | null,
  currentIds: string[],
  seenIds: string[],
  excludedReviewers: string[],
  strictExclude = true,
) {
  const params = new URLSearchParams({
    limit: String(CIRCLE_FEED_PAGE_SIZE),
    excludeSynthetic: "1",
  });
  if (strictExclude) params.set("strictExclude", "1");
  if (viewerName) params.set("viewer", viewerName);
  const excludedNames = Array.from(new Set(excludedReviewers.map((name) => name.trim()).filter(Boolean)));
  if (excludedNames.length > 0) params.set("exclude", excludedNames.join(","));
  if (cursor) params.set("cursor", JSON.stringify(cursor));
  // Build exclusion list: currently rendered posts take priority so they can
  // never be dropped by the 120-item cap. Seen (scrolled-past) IDs fill the rest.
  const excludeSet = new Set(currentIds);
  for (const id of seenIds) excludeSet.add(id);
  const excludeIds = Array.from(excludeSet);
  if (excludeIds.length > 0) params.set("excludeSeen", excludeIds.slice(0, 120).join(","));
  return `/api/feed/public?${params.toString()}`;
}

function interleaveUnseenPosts(circlePosts: Review[], publicPosts: Review[]) {
  if (circlePosts.length === 0) return publicPosts;
  if (publicPosts.length === 0) return circlePosts;

  const result: Review[] = [];
  // 70/30 mix: seven circle posts and three public discovery posts per cycle.
  const pattern: Array<"circle" | "public"> = [
    "circle",
    "circle",
    "public",
    "circle",
    "circle",
    "public",
    "circle",
    "circle",
    "public",
    "circle",
  ];
  let circleIndex = 0;
  let publicIndex = 0;

  while (circleIndex < circlePosts.length || publicIndex < publicPosts.length) {
    for (const source of pattern) {
      if (source === "circle") {
        if (circleIndex < circlePosts.length) {
          result.push(circlePosts[circleIndex++]);
        } else if (publicIndex < publicPosts.length) {
          result.push(publicPosts[publicIndex++]);
        }
      } else if (publicIndex < publicPosts.length) {
        result.push(publicPosts[publicIndex++]);
      } else if (circleIndex < circlePosts.length) {
        result.push(circlePosts[circleIndex++]);
      }

      if (circleIndex >= circlePosts.length && publicIndex >= publicPosts.length) break;
    }
  }

  return result;
}

function recordSeenPostsOnServer(postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds.map((id) => id.trim()).filter(Boolean)));
  if (uniquePostIds.length === 0) return;
  const body = JSON.stringify({ postIds: uniquePostIds });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/post-views", blob)) return;
  }

  void fetch("/api/post-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
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
  const persistedPublicPostIds = persistedSnapshot?.publicPostIds ?? [];
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [requestCircleMembers, setRequestCircleMembers] = useState<Set<string>>(() => new Set(initialCircle));
  const [pendingSent, setPendingSent] = useState<Set<string>>(new Set());
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
  const [publicPostIds, setPublicPostIds] = useState<Set<string>>(() => new Set(persistedPublicPostIds));
  const [seenPostMap, setSeenPostMap] = useState<SeenPostMap>(() => readSeenPostMap(initialViewerName || initialMyName));
  const [circleHasMore, setCircleHasMore] = useState(initialHasMore);
  const [circleNextCursor, setCircleNextCursor] = useState<CircleFeedCursor | null>(initialNextCursor);
  const [publicFeedAttempted, setPublicFeedAttempted] = useState(persistedPublicPostIds.length > 0);
  const [publicHasMore, setPublicHasMore] = useState(false);
  const [publicNextCursor, setPublicNextCursor] = useState<CircleFeedCursor | null>(null);
  const [publicFallbackEmpty, setPublicFallbackEmpty] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const seenPostMapRef = useRef<SeenPostMap>({});
  const visibleSinceRef = useRef<Map<string, number>>(new Map());
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
      setPublicPostIds(new Set(snapshot.publicPostIds ?? []));
      // Always use server-provided pagination — cursor is never restored from snapshot.
      setCircleHasMore(initialHasMore);
      setCircleNextCursor(initialNextCursor);
      setPublicFeedAttempted((snapshot.publicPostIds ?? []).length > 0);
      setPublicHasMore(false);
      setPublicNextCursor(null);
    } else {
      const resolvedName = resolveActorName(initialMyName);
      const freshSeenMap = readSeenPostMap(resolvedName);
      setFeedReviews(allReviews);
      setFeedLikeCountMap(likeCountMap);
      setFeedCommentMap(commentMap);
      setFeedProfileMap(initialProfileMap);
      setFeedLikedMap(initialLikedMap);
      setFeedBookmarkedPostMap(initialBookmarkedPostMap);
      setFeedTasteTrustSummaryMap(initialTasteTrustSummaryMap);
      setPublicPostIds(new Set());
      setCircleHasMore(initialHasMore);
      setCircleNextCursor(initialNextCursor);
      setPublicFeedAttempted(false);
      setPublicHasMore(false);
      setPublicNextCursor(null);
      setPublicFallbackEmpty(false);
      setSeenPostMap(freshSeenMap);
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
    setRequestCircleMembers(new Set(initialCircle));
    // When server already provided authenticated identity + circle data,
    // trust that snapshot to avoid client-side status drift hiding posts.
    if (initialMyName) {
      setMounted(true);
      if (name) {
        cachedCircleStatus(name)
          .then((data) => {
            setRequestCircleMembers(new Set(data.members ?? []));
            setPendingSent(new Set(data.pendingSent ?? []));
          })
          .catch(() => {});
      }
      return;
    }
    if (!name) { setMounted(true); return; }
    cachedCircleStatus(name)
      .then((data) => {
        setCircle(data.members ?? []);
        setRequestCircleMembers(new Set(data.members ?? []));
        setPendingSent(new Set(data.pendingSent ?? []));
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

  function requestStatusFor(name: string) {
    const status = personStatusFor(name, { circleMembers: requestCircleMembers, pendingSent });
    return status === "one_way" ? "joined" : status === "sent" ? "pending" : "idle";
  }

  async function requestCircleAccess(receiverName: string) {
    if (
      !myName ||
      myName === receiverName ||
      personStatusFor(receiverName, { circleMembers: requestCircleMembers, pendingSent }) !== "none"
    ) {
      return;
    }

    setPendingSent((prev) => addName(prev, receiverName));
    const response = await fetch("/api/circle/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverName }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setPendingSent((prev) => removeName(prev, receiverName));
      return;
    }

    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(receiverName);
    invalidateCachedJson("/api/feed/circle", { clearFeedSnapshots: false });
    invalidateCachedJson("/api/people");

    if (isAcceptedCircleResponse(data) || isOneWayCircleResponse(data)) {
      setPendingSent((prev) => removeName(prev, receiverName));
      setRequestCircleMembers((prev) => addName(prev, receiverName));
      setCircle((prev) => Array.from(addName(new Set(prev), receiverName)));
    }
  }

  const circleReviews = useMemo(() => feedReviews, [feedReviews]);
  const displayedReviews = useMemo(() => {
    const unseenCircle: Review[] = [];
    const unseenPublic: Review[] = [];
    const seenCircle: Review[] = [];
    const seenPublic: Review[] = [];

    for (const review of feedReviews) {
      const isPublic = publicPostIds.has(review.id);
      const isSeen = Boolean(seenPostMap[review.id]);
      if (isPublic && isSeen) seenPublic.push(review);
      else if (isPublic) unseenPublic.push(review);
      else if (isSeen) seenCircle.push(review);
      else unseenCircle.push(review);
    }

    return [
      ...interleaveUnseenPosts(unseenCircle, unseenPublic),
      ...seenCircle,
      ...seenPublic,
    ];
  }, [feedReviews, publicPostIds, seenPostMap]);

  useEffect(() => {
    // Don't persist until seen-post data is loaded; the render order is derived
    // from the real seenPostMap and the circle/public source map.
    if (!mounted) return;
    writeFeedState<CircleFeedSnapshot>(stateKey, {
      reviews: circleReviews.slice(0, MAX_PERSISTED_REVIEWS),
      publicPostIds: Array.from(publicPostIds).slice(0, MAX_PERSISTED_REVIEWS),
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
    publicPostIds,
  ]);

  useEffect(() => {
    const root = feedContainerRef.current;
    if (!root || displayedReviews.length === 0) return;

    const container = root;
    let frame = 0;
    let settleTimer = 0;
    let dwellTimer = 0;

    function scheduleDwellScan() {
      if (dwellTimer) window.clearTimeout(dwellTimer);
      dwellTimer = window.setTimeout(() => {
        dwellTimer = 0;
        scheduleScan();
      }, SEEN_DWELL_MS + 50);
    }

    function visiblePostIds(force = false) {
      const now = Date.now();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const visibleIds = new Set<string>();
      const unseenIds: string[] = [];
      let hasVisibleUnseen = false;
      const latestSeenMap = seenPostMapRef.current;

      container.querySelectorAll<HTMLElement>("[data-feed-post-id]").forEach((element) => {
        const postId = element.getAttribute("data-feed-post-id") ?? "";
        if (!postId) return;

        const rect = element.getBoundingClientRect();
        const visiblePx = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
        const visibleRatio = visiblePx / Math.max(1, Math.min(rect.height, viewportHeight));
        if (visibleRatio >= SEEN_VISIBILITY_RATIO) {
          visibleIds.add(postId);
          if (!visibleSinceRef.current.has(postId)) {
            visibleSinceRef.current.set(postId, now);
          }

          const visibleForMs = now - (visibleSinceRef.current.get(postId) ?? now);
          const requiredDwellMs = force ? SEEN_EXIT_DWELL_MS : SEEN_DWELL_MS;
          if (!latestSeenMap[postId]) {
            hasVisibleUnseen = true;
            if (visibleForMs >= requiredDwellMs) {
              unseenIds.push(postId);
            }
          }
        }
      });

      for (const postId of visibleSinceRef.current.keys()) {
        if (!visibleIds.has(postId)) visibleSinceRef.current.delete(postId);
      }

      return { unseenIds, hasVisibleUnseen };
    }

    function markVisiblePosts(force = false) {
      const { unseenIds, hasVisibleUnseen } = visiblePostIds(force);
      if (!force && hasVisibleUnseen && unseenIds.length === 0) {
        scheduleDwellScan();
      }
      if (unseenIds.length === 0) return;

      const nextSeenMap = markPostsSeen(myName, unseenIds);
      seenPostMapRef.current = nextSeenMap;
      for (const postId of unseenIds) visibleSinceRef.current.delete(postId);
      recordSeenPostsOnServer(unseenIds);
      // Keep the current viewport stable. The freshly written seen map is used
      // by future loads, but this mounted feed should not reshuffle itself.
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
      markVisiblePosts(true);
    }

    function flushWhenHidden() {
      if (document.visibilityState === "hidden") flushBeforeLeaving();
    }

    markVisiblePosts();
    scheduleScan();
    settleTimer = window.setTimeout(scheduleScan, 350);
    scheduleDwellScan();
    window.addEventListener("scroll", scheduleScan, { passive: true });
    document.addEventListener("scroll", scheduleScan, { passive: true, capture: true });
    window.addEventListener("resize", scheduleScan);
    window.addEventListener("pagehide", flushBeforeLeaving);
    window.addEventListener("beforeunload", flushBeforeLeaving);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      flushBeforeLeaving();
      if (settleTimer) window.clearTimeout(settleTimer);
      if (dwellTimer) window.clearTimeout(dwellTimer);
      window.removeEventListener("scroll", scheduleScan);
      document.removeEventListener("scroll", scheduleScan, { capture: true });
      window.removeEventListener("resize", scheduleScan);
      window.removeEventListener("pagehide", flushBeforeLeaving);
      window.removeEventListener("beforeunload", flushBeforeLeaving);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [displayedReviews, myName]);

  const appendPublicFallbackPosts = useCallback(async (cursor: CircleFeedCursor | null = null) => {
    if (loadingMore) return;
    if (!cursor) setPublicFeedAttempted(true);
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const seenIds = Object.keys(readSeenPostMap(myName));
      const currentIds = feedReviews.map((review) => review.id);
      const excludedReviewers = [myName, ...circle, ...Array.from(requestCircleMembers)];

      async function fetchPublicPage(nextCursor: CircleFeedCursor | null, excludedSeenIds: string[], strictExclude: boolean) {
        const response = await fetch(
          publicFallbackUrl(myName, nextCursor, currentIds, excludedSeenIds, excludedReviewers, strictExclude),
          { cache: "no-store" }
        );
        const data = await response.json() as PublicFeedResponse;
        if (!response.ok || data.error) throw new Error(data.error ?? "Unable to load public posts");
        return data;
      }

      let data = await fetchPublicPage(cursor, seenIds, true);
      if ((data.reviews ?? []).length === 0 && !data.hasMore) {
        data = await fetchPublicPage(null, [], false);
      }

      const incomingReviews = data.reviews ?? [];
      setFeedReviews((current) => {
        const seen = new Set(current.map((review) => review.id));
        const fresh = incomingReviews.filter((review) => !seen.has(review.id));
        if (fresh.length > 0) setPublicPostIds((ids) => new Set([...ids, ...fresh.map((review) => review.id)]));
        return [...current, ...fresh];
      });
      setFeedLikeCountMap((current) => ({ ...current, ...(data.likeCountMap ?? {}) }));
      setFeedCommentMap((current) => ({ ...current, ...(data.commentMap ?? {}) }));
      setFeedProfileMap((current) => ({ ...current, ...(data.profileMap ?? {}) }));
      setFeedLikedMap((current) => ({ ...current, ...(data.likedByMeMap ?? {}) }));
      setFeedBookmarkedPostMap((current) => ({ ...current, ...(data.bookmarkedPostMap ?? {}) }));
      setPublicHasMore(Boolean(data.hasMore));
      setPublicNextCursor(data.nextCursor ?? null);
      if (incomingReviews.length === 0 && !data.hasMore) {
        setPublicFallbackEmpty(true);
      }
    } catch {
      setLoadMoreError("Could not load more posts. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }, [circle, feedReviews, loadingMore, myName, requestCircleMembers]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    if (!circleHasMore) {
      if (publicHasMore) {
        await appendPublicFallbackPosts(publicNextCursor);
      } else if (!publicFeedAttempted) {
        await appendPublicFallbackPosts(null);
      }
      return;
    }

    let loadedCirclePage = false;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const params = new URLSearchParams({
        limit: String(CIRCLE_FEED_PAGE_SIZE),
      });
      if (circleNextCursor) params.set("cursor", JSON.stringify(circleNextCursor));
      const excludedSeenIds = Object.keys(readSeenPostMap(myName)).slice(0, 160);
      if (excludedSeenIds.length > 0) params.set("excludeSeen", excludedSeenIds.join(","));
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
      setCircleHasMore(Boolean(data.hasMore));
      setCircleNextCursor(data.nextCursor ?? null);
      loadedCirclePage = true;
    } catch {
      setLoadMoreError("Could not load more posts. Please try again.");
    } finally {
      setLoadingMore(false);
    }

    if (loadedCirclePage && publicHasMore) {
      await appendPublicFallbackPosts(publicNextCursor);
    }
  }, [
    appendPublicFallbackPosts,
    circleHasMore,
    circleNextCursor,
    loadingMore,
    myName,
    publicFeedAttempted,
    publicHasMore,
    publicNextCursor,
  ]);

  useEffect(() => {
    if (
      !mounted ||
      publicFeedAttempted ||
      loadingMore
    ) {
      return;
    }

    void appendPublicFallbackPosts(null);
  }, [
    appendPublicFallbackPosts,
    loadingMore,
    mounted,
    publicFeedAttempted,
  ]);

  useEffect(() => {
    const target = loadMoreSentinelRef.current;
    if (!target || loadingMore || (!circleHasMore && !publicHasMore && (publicFeedAttempted || publicFallbackEmpty))) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root: null, rootMargin: "900px 0px", threshold: 0 }
    );
    observer.observe(target);

    return () => observer.disconnect();
  }, [
    circleHasMore,
    loadingMore,
    publicFallbackEmpty,
    publicFeedAttempted,
    publicHasMore,
    loadMore,
  ]);

  // Don't render until we've read localStorage to avoid flash
  if (!mounted || (!publicFeedAttempted && displayedReviews.length === 0)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 100px" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse" style={{ height: "360px", background: "var(--card)", borderBottom: "1px solid var(--border)", opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  if (displayedReviews.length === 0 && publicFeedAttempted && !loadingMore) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 24px 100px", gap: "12px" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--orange-dim)", border: "1.5px solid rgba(240,96,48,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Users size={28} strokeWidth={1.8} color="var(--orange)" />
        </div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Nothing new right now
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "280px" }}>
          Your circle and nearby public picks are caught up for now.
        </p>
      </div>
    );
  }

  return (
    <>
      <div ref={feedContainerRef} style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 0 100px" }}>
        {displayedReviews.map((review, index) => {
          const eng = feedCommentMap[review.id];
          const isPublicPost = publicPostIds.has(review.id);
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
                requestStatus={isPublicPost ? requestStatusFor(review.reviewer_name) : undefined}
                onRequestClick={isPublicPost ? () => requestCircleAccess(review.reviewer_name) : undefined}
              />
            </div>
          );
        })}
        {loadMoreError && (
          <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", margin: "12px 12px 0" }}>
            {loadMoreError}
          </p>
        )}
        {(circleHasMore || publicHasMore || (!publicFeedAttempted && !publicFallbackEmpty && displayedReviews.length > 0)) && (
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

        {(!circleHasMore && !publicHasMore && displayedReviews.length > CIRCLE_FEED_PAGE_SIZE) || (publicFallbackEmpty && !circleHasMore && !publicHasMore) ? (
          <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "10px 0 20px", fontFamily: "'DM Sans', sans-serif" }}>
            You are caught up for now.
          </p>
        ) : null}
        <div ref={loadMoreSentinelRef} aria-hidden="true" style={{ height: 1 }} />
      </div>
    </>
  );
}
