import type { Review } from "@/lib/types";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";

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

const ME_PAGE_REVIEWS_DEFAULT_LIMIT = 300;

export async function getMePageData(
  supabase: SupabaseLike,
  myName: string,
  options?: { cursor?: MeCursor | null; limit?: number }
) {
  const viewer = normalizeName(myName);
  if (!viewer) {
    return { reviews: [] as Review[], circleMembers: [] as string[], hasMore: false, nextCursor: null };
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
    .select("*")
    .eq("reviewer_name", myName)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (cursor) {
    reviewsQuery = reviewsQuery.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const [relationships, { data: rawReviews }] = await Promise.all([
    getCircleRelationshipsForName(supabase, myName),
    reviewsQuery.limit(limit + 1),
  ]);

  const allReviews = (rawReviews ?? []) as Review[];
  const hasMore = allReviews.length > limit;
  const reviews = allReviews.slice(0, limit);
  const nextCursor: MeCursor | null =
    hasMore && reviews.length > 0
      ? { createdAt: reviews[reviews.length - 1].created_at, id: reviews[reviews.length - 1].id }
      : null;

  return {
    reviews,
    circleMembers: [...relationships.circleMembers],
    hasMore,
    nextCursor,
  };
}
