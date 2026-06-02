import type { Comment, Review } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { rankCircleFeedReviews } from "@/lib/feed-ranking";
import { filterCircleTrendingReviews } from "@/lib/visibility";
import { CIRCLE_FEED_MAX_PAGE_SIZE, CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { normalizeReview } from "@/lib/server/normalize-review";
import { getPostTasteTrustSummaryMap } from "@/lib/server/taste-trust";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";
import { loadSeenPostIdsForUser } from "@/lib/server/post-views";

type FeedDb = {
  auth: {
    getUser: () => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown>;
        } | null;
      };
      error?: unknown;
    }>;
  };
  from: (table: string) => any;
};

const REVIEW_SELECT = [
  "id",
  "reviewer_name",
  "restaurant_id",
  "restaurant_name",
  "area",
  "restaurant_address",
  "restaurant_lat",
  "restaurant_lng",
  "items",
  "body",
  "tags",
  "photo_url",
  "review_photos(public_url, media_type, position)",
  "visibility",
  "created_at",
  "deleted_at",
  "hidden_at",
  "reported_at",
  "status",
].join(", ");

const CIRCLE_FEED_CACHE_TTL_MS = 5 * 60 * 1000;

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

function userMetadataName(user: Awaited<ReturnType<FeedDb["auth"]["getUser"]>>["data"]["user"]) {
  const fallbackFullName = typeof user?.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name.trim()
    : "";
  const fallbackName = typeof user?.user_metadata?.name === "string"
    ? user.user_metadata.name.trim()
    : "";
  const fallbackEmailPrefix = user?.email?.split("@")[0]?.trim() ?? "";
  return { fallbackFullName, fallbackName, fallbackEmailPrefix };
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) return CIRCLE_FEED_PAGE_SIZE;
  return Math.min(CIRCLE_FEED_MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

function normalizeCacheName(name: string) {
  return name.trim().toLowerCase();
}

function feedCacheTagForName(name: string) {
  return `circle-feed:name:${normalizeCacheName(name)}`;
}

export type CircleFeedCursor = {
  createdAt: string;
  id: string;
};

function feedCacheKey(
  candidateNames: string[],
  cursor: CircleFeedCursor | null,
  limit: number,
  excludePostIds: string[]
) {
  const identity = candidateNames.map(normalizeCacheName).sort().join("|") || "anonymous";
  const cursorKey = cursor ? `${cursor.createdAt}|${cursor.id}` : "first";
  const excludeKey = excludePostIds.length > 0 ? `exclude:${excludePostIds.slice().sort().join("|")}` : "exclude:none";
  return `circle-feed:v3:${identity}:${cursorKey}:${limit}:${excludeKey}`;
}

export function cursorForCircleFeedReview(review: Pick<Review, "created_at" | "id">): CircleFeedCursor {
  return { createdAt: review.created_at, id: review.id };
}

export function serializeCircleFeedCursor(cursor: CircleFeedCursor | null | undefined): string {
  return cursor ? JSON.stringify(cursor) : "";
}

export function parseCircleFeedCursor(raw: string | null | undefined): CircleFeedCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CircleFeedCursor>;
    if (
      typeof parsed.createdAt === "string" &&
      parsed.createdAt.trim() &&
      typeof parsed.id === "string" &&
      parsed.id.trim()
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}

export function isAfterCircleFeedCursor(
  review: Pick<Review, "created_at" | "id">,
  cursor: CircleFeedCursor | null | undefined
): boolean {
  if (!cursor) return true;
  if (review.created_at < cursor.createdAt) return true;
  if (review.created_at > cursor.createdAt) return false;
  return review.id < cursor.id;
}

export function invalidateCircleFeedCacheForNames(names: string[]) {
  invalidatePrivateCacheByTags(
    Array.from(new Set(names.map((name) => name.trim()).filter(Boolean).map(feedCacheTagForName)))
  );
}

const globalForFeedCache = globalThis as typeof globalThis & {
  __foodReviewInvalidateCircleFeedCacheForNames?: (names: string[]) => void;
};

globalForFeedCache.__foodReviewInvalidateCircleFeedCacheForNames = invalidateCircleFeedCacheForNames;

export type CircleFeedPage = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  rankMap: Record<string, { rank: number; total: number; visitCount: number }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  tasteTrustSummaryMap: Record<string, PostTasteTrustSummary>;
  profileMap: Record<string, string>;
  myName: string;
  joinedCircles: string[];
  mutualMembers: string[];
  hasMore: boolean;
  nextCursor: CircleFeedCursor | null;
};

export async function getCircleFeedPage(
  supabase: FeedDb,
  options: { cursor?: CircleFeedCursor | null; limit?: number; bypassCache?: boolean; excludePostIds?: string[] } = {}
): Promise<CircleFeedPage> {
  const cursor = options.cursor ?? null;
  const limit = clampLimit(options.limit ?? CIRCLE_FEED_PAGE_SIZE);
  const excludePostIds = Array.from(new Set((options.excludePostIds ?? []).map((id) => id.trim()).filter(Boolean)));

  const [actor, { data: { user } }] = await Promise.all([
    getAuthenticatedCircleActor(supabase),
    supabase.auth.getUser(),
  ]);

  const { fallbackFullName, fallbackName, fallbackEmailPrefix } = userMetadataName(user);
  const candidateNames = Array.from(
    new Set(
      [
        actor?.actorName ?? "",
        fallbackFullName,
        fallbackName,
        fallbackEmailPrefix,
      ].map((name) => name.trim()).filter(Boolean)
    )
  );

  const load = async () => {
    const value = await loadCircleFeedPageForNames(supabase, candidateNames, cursor, limit, excludePostIds, actor?.userId ?? null);
    const tags = Array.from(
      new Set([value.myName, ...value.joinedCircles, ...candidateNames].filter(Boolean).map(feedCacheTagForName))
    );
    return { value, tags };
  };

  // Cursor pages always bypass server private cache — they must fetch fresh data so
  // that deleted posts and new engagement are not stale during load-more.
  if (options.bypassCache || cursor || excludePostIds.length > 0 || actor?.userId) {
    const { value } = await load();
    return value;
  }

  return getPrivateCached({
    key: feedCacheKey(candidateNames, cursor, limit, excludePostIds),
    ttlMs: CIRCLE_FEED_CACHE_TTL_MS,
    load,
  });
}

async function loadCircleFeedPageForNames(
  supabase: FeedDb,
  candidateNames: string[],
  cursor: CircleFeedCursor | null,
  limit: number,
  excludePostIds: string[] = [],
  userId: string | null = null
): Promise<CircleFeedPage> {
  const readDb = candidateNames.length > 0 ? createAdminClient() : supabase;

  const relationshipSnapshots = await Promise.all(
    candidateNames.map((name) => getCircleRelationshipsForName(readDb, name))
  );

  const joinedCircleSet = new Set<string>();
  const mutualMemberSet = new Set<string>();
  for (const snapshot of relationshipSnapshots) {
    for (const member of snapshot.joinedCircles) joinedCircleSet.add(member);
    for (const member of snapshot.mutualMembers) mutualMemberSet.add(member);
  }

  const myName = candidateNames[0] ?? "";
  const joinedCircles = Array.from(joinedCircleSet);
  const mutualMembers = Array.from(mutualMemberSet);
  const feedReviewerNames = Array.from(new Set(joinedCircles.filter(Boolean)));
  const excludePostIdSet = await loadSeenPostIdsForUser(readDb, userId, excludePostIds);

  const visibleRows: Review[] = [];
  const seenFallbackRows: Review[] = [];
  let scanCursor = cursor;
  let exhausted = feedReviewerNames.length === 0;
  const batchSize = Math.min(100, Math.max(limit + 1, limit * 2));

  while (!exhausted && visibleRows.length <= limit) {
    let query = readDb
      .from("reviews")
      .select(REVIEW_SELECT)
      .in("reviewer_name", feedReviewerNames)
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (scanCursor) {
      query = query.or(
        `created_at.lt.${scanCursor.createdAt},and(created_at.eq.${scanCursor.createdAt},id.lt.${scanCursor.id})`
      );
    }

    const { data: rawBatch } = await query.limit(batchSize);
    const batch = ((rawBatch ?? []) as unknown[]).map(
      (r) => normalizeReview(r as Parameters<typeof normalizeReview>[0])
    ) as Review[];
    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    const visibleBatch = filterCircleTrendingReviews(batch, {
      viewerName: myName,
      circleOwnerNames: joinedCircles,
    });

    for (const review of visibleBatch) {
      if (excludePostIdSet.has(review.id)) {
        seenFallbackRows.push(review);
      } else {
        visibleRows.push(review);
      }
    }

    scanCursor = cursorForCircleFeedReview(batch[batch.length - 1]);
    exhausted = batch.length < batchSize;
  }

  const unseenPostIds = new Set(visibleRows.map((review) => review.id));
  const orderedRows = [...visibleRows, ...seenFallbackRows];
  const hasMore = orderedRows.length > limit;
  const allReviews = orderedRows.slice(0, limit);
  const nextCursor = hasMore && allReviews.length > 0
    ? cursorForCircleFeedReview(allReviews[allReviews.length - 1])
    : null;
  const postIds = allReviews.map((review) => review.id);

  const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }, tasteTrustSummaryMap, profileMap] = postIds.length > 0
    ? await Promise.all([
        readDb.from("likes").select("post_id, user_name").in("post_id", postIds),
        readDb
          .from("comments")
          .select("id, post_id, user_name, content, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: false }),
        myName && postIds.length > 0
          ? readDb
              .from("wishlist")
              .select("post_id")
              .eq("user_name", myName)
              .in("post_id", postIds)
          : Promise.resolve({ data: [] }),
        getPostTasteTrustSummaryMap(readDb, postIds),
        Promise.resolve().then(() => buildProfileDisplayMap(readDb, allReviews.map((r) => r.reviewer_name))),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, {}, {}];

  const likeCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (rawLikes ?? []) as { post_id: string; user_name: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (like.user_name === myName) likedByMeMap[like.post_id] = true;
  }

  const bookmarkedPostMap: Record<string, boolean> = {};
  for (const item of (rawWishlist ?? []) as { post_id: string | null }[]) {
    if (item.post_id) bookmarkedPostMap[item.post_id] = true;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of rawComments ?? []) {
    const ex = commentMap[comment.post_id];
    if (!ex) {
      commentMap[comment.post_id] = { count: 1, top: comment };
    } else {
      ex.count++;
    }
  }

  const rankedUnseenReviews = rankCircleFeedReviews(
    allReviews.filter((review) => unseenPostIds.has(review.id)),
    { likeCountMap, commentMap }
  );
  const rankedSeenFallbackReviews = rankCircleFeedReviews(
    allReviews.filter((review) => !unseenPostIds.has(review.id)),
    { likeCountMap, commentMap }
  );
  const rankedReviews = [...rankedUnseenReviews, ...rankedSeenFallbackReviews];

  const visitCounts = new Map<string, number>();
  for (const review of allReviews) {
    const key = `${review.reviewer_name}\x00${review.restaurant_name}`;
    visitCounts.set(key, (visitCounts.get(key) ?? 0) + 1);
  }

  const byReviewer = new Map<string, Review[]>();
  for (const review of allReviews) {
    const group = byReviewer.get(review.reviewer_name) ?? [];
    group.push(review);
    byReviewer.set(review.reviewer_name, group);
  }

  const rankMap: Record<string, { rank: number; total: number; visitCount: number }> = {};
  for (const [, group] of byReviewer) {
    const sorted = [...group].sort((a, b) => avgRating(b) - avgRating(a));
    sorted.forEach((review, index) => {
      rankMap[review.id] = {
        rank: index + 1,
        total: group.length,
        visitCount: visitCounts.get(`${review.reviewer_name}\x00${review.restaurant_name}`) ?? 1,
      };
    });
  }

  return {
    reviews: rankedReviews,
    likeCountMap,
    commentMap,
    rankMap,
    likedByMeMap,
    bookmarkedPostMap,
    tasteTrustSummaryMap,
    profileMap,
    myName,
    joinedCircles,
    mutualMembers,
    hasMore,
    nextCursor,
  };
}
