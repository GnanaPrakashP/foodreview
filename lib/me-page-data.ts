import type { Review } from "@/lib/types";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";
import { REVIEW_SELECT } from "@/lib/selects";
import { engagementForPosts } from "@/lib/server/engagement-list";
import { normalizeReview } from "@/lib/server/normalize-review";

const ME_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;

type SupabaseLike = {
  from: (table: string) => any;
};

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

export function invalidateMePageCacheForNames(names: string[]) {
  const tags = [];
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized) tags.push(`me-page:${normalized}`);
  }
  invalidatePrivateCacheByTags(tags);
}

const globalForMeCache = globalThis as typeof globalThis & {
  __foodReviewInvalidateMePageCacheForNames?: (names: string[]) => void;
};

globalForMeCache.__foodReviewInvalidateMePageCacheForNames = invalidateMePageCacheForNames;

export type MeCursor = { id: string; createdAt: string };

export const ME_PAGE_REVIEWS_DEFAULT_LIMIT = 24;
const PUBLIC_BEST_REVIEWS_LIMIT = 500;

type MeStats = {
  totalVisits: number;
  uniquePlaces: number;
  uniqueDishes: number;
};

function statsFromReviews(reviews: Pick<Review, "restaurant_name" | "items">[]): MeStats {
  const places = new Set<string>();
  const dishes = new Set<string>();
  for (const review of reviews) {
    if (review.restaurant_name) places.add(review.restaurant_name);
    for (const item of review.items ?? []) {
      const dish = item.name?.trim().toLowerCase();
      if (dish) dishes.add(`${review.restaurant_name}\x00${dish}`);
    }
  }
  return {
    totalVisits: reviews.length,
    uniquePlaces: places.size,
    uniqueDishes: dishes.size,
  };
}

export async function getMePageData(
  supabase: SupabaseLike,
  myName: string,
  options?: { cursor?: MeCursor | null; limit?: number }
) {
  const viewer = normalizeName(myName);
  if (!viewer) {
    return {
      reviews: [] as Review[],
      circleMembers: [] as string[],
      hasMore: false,
      nextCursor: null,
      stats: { totalVisits: 0, uniquePlaces: 0, uniqueDishes: 0 },
    };
  }

  // Pages after the first bypass the server-side cache — they are always fresh.
  if (options?.cursor) {
    return loadMePageData(supabase, myName, options.cursor, options.limit);
  }

  return getPrivateCached({
    key: `me-page:v1:${viewer}`,
    ttlMs: ME_PAGE_CACHE_TTL_MS,
    load: async () => ({
      value: await loadMePageData(supabase, myName, null, options?.limit),
      tags: [`me-page:${viewer}`],
    }),
  });
}

async function loadMePageData(
  supabase: SupabaseLike,
  myName: string,
  cursor: MeCursor | null = null,
  limit = ME_PAGE_REVIEWS_DEFAULT_LIMIT
) {
  let reviewsQuery = supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("reviewer_name", myName)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (cursor) {
    reviewsQuery = reviewsQuery.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const publicBestReviewsQuery = supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(PUBLIC_BEST_REVIEWS_LIMIT);

  const statsQuery = supabase
    .from("reviews")
    .select("restaurant_name, items")
    .eq("reviewer_name", myName)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active");

  const [relationships, { data: rawReviews }, { data: rawPublicBestReviews }, { data: rawStatsReviews }] = await Promise.all([
    getCircleRelationshipsForName(supabase, myName),
    reviewsQuery.limit(limit + 1),
    cursor ? Promise.resolve({ data: [] }) : publicBestReviewsQuery,
    cursor ? Promise.resolve({ data: [] }) : statsQuery,
  ]);

  const allReviews = ((rawReviews ?? []) as unknown[])
    .map((r) => normalizeReview(r as Parameters<typeof normalizeReview>[0]));
  const hasMore = allReviews.length > limit;
  const reviews = allReviews.slice(0, limit);
  const nextCursor: MeCursor | null =
    hasMore && reviews.length > 0
      ? { createdAt: reviews[reviews.length - 1].created_at, id: reviews[reviews.length - 1].id }
      : null;

  const engagement = await engagementForPosts(supabase, reviews, myName);
  const publicBestReviews = ((rawPublicBestReviews ?? []) as unknown[])
    .map((r) => normalizeReview(r as Parameters<typeof normalizeReview>[0]));
  const statsRows = ((rawStatsReviews ?? []) as Pick<Review, "restaurant_name" | "items">[]);
  const stats = cursor ? undefined : statsFromReviews(statsRows);

  return {
    reviews,
    publicBestReviews,
    circleMembers: [...relationships.circleMembers],
    hasMore,
    nextCursor,
    stats,
    ...engagement,
  };
}
