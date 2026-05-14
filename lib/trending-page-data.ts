import type { Review } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { computeTrending, type CircleReviewItem, type TrendingPeopleCounts } from "@/lib/trending";
import { filterGlobalTrendingReviews, filterPublicCircleTrendingReviews } from "@/lib/visibility";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";
import { REVIEW_SELECT } from "@/lib/selects";

type TrendingDb = {
  from: (table: string) => any;
};

const TRENDING_CACHE_TTL_MS = 5 * 60 * 1000;

export type TrendingPageData = {
  week: ReturnType<typeof computeTrending>["week"];
  month: ReturnType<typeof computeTrending>["month"];
  alltime: ReturnType<typeof computeTrending>["alltime"];
  peopleCounts: TrendingPeopleCounts;
  circleReviews: Record<string, CircleReviewItem[]>;
  circleWeek: ReturnType<typeof computeTrending>["week"];
  circleMonth: ReturnType<typeof computeTrending>["month"];
  circleAlltime: ReturnType<typeof computeTrending>["alltime"];
  circlePeopleCounts: TrendingPeopleCounts;
};

function cacheName(name: string) {
  return name.trim().toLowerCase() || "anonymous";
}

export function invalidateTrendingPageCacheForNames(names: string[]) {
  const tags = ["trending:all"];
  for (const name of names) {
    const normalized = cacheName(name);
    if (normalized !== "anonymous") tags.push(`trending:${normalized}`);
  }
  invalidatePrivateCacheByTags(tags);
}

const globalForTrendingCache = globalThis as typeof globalThis & {
  __foodReviewInvalidateTrendingPageCacheForNames?: (names: string[]) => void;
};

globalForTrendingCache.__foodReviewInvalidateTrendingPageCacheForNames = invalidateTrendingPageCacheForNames;

export async function getTrendingPageData(db: TrendingDb, myName: string): Promise<TrendingPageData> {
  return getPrivateCached({
    key: `trending-page:v2:${cacheName(myName)}`,
    ttlMs: TRENDING_CACHE_TTL_MS,
    load: async () => ({ value: await loadTrendingPageData(db, myName), tags: [`trending:${cacheName(myName)}`, "trending:all"] }),
  });
}

async function loadTrendingPageData(db: TrendingDb, myName: string): Promise<TrendingPageData> {
  const readDb = createAdminClient();
  // Filter to public, non-suppressed reviews at the DB level so the 500-row window
  // is filled with usable data. filterGlobalTrendingReviews below is kept as
  // defense-in-depth for any edge-case suppression flags not covered by SQL.
  const { data: reviews } = await readDb
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(500);

  const allReviews = (reviews ?? []) as unknown as Review[];
  const publicReviews = filterGlobalTrendingReviews(allReviews);
  const { week, month, alltime, peopleCounts } = computeTrending(publicReviews);

  let circleReviews: Record<string, CircleReviewItem[]> = {};
  let circleWeek: typeof week = [];
  let circleMonth: typeof month = [];
  let circleAlltime: typeof alltime = [];
  let circlePeopleCounts: TrendingPeopleCounts = { week: 0, month: 0, alltime: 0 };

  if (myName) {
    const { joinedCircles } = await getCircleRelationshipsForName(db, myName);

    if (joinedCircles.size > 0) {
      const allFriendReviews = filterPublicCircleTrendingReviews(publicReviews, {
        viewerName: myName,
        circleOwnerNames: joinedCircles,
      });

      const now = Date.now();
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      const circleWeekRestaurantNames = new Set<string>();
      const circleMonthRestaurantNames = new Set<string>();
      const circleAlltimeRestaurantNames = new Set<string>();
      for (const review of allFriendReviews) {
        const ts = new Date(review.created_at).getTime();
        circleAlltimeRestaurantNames.add(review.restaurant_name);
        if (ts > monthAgo) circleMonthRestaurantNames.add(review.restaurant_name);
        if (ts > weekAgo) circleWeekRestaurantNames.add(review.restaurant_name);
      }

      circleWeek = week.filter((restaurant) => circleWeekRestaurantNames.has(restaurant.restaurant_name));
      circleMonth = month.filter((restaurant) => circleMonthRestaurantNames.has(restaurant.restaurant_name));
      circleAlltime = alltime.filter((restaurant) => circleAlltimeRestaurantNames.has(restaurant.restaurant_name));
      circlePeopleCounts = computeTrending(allFriendReviews).peopleCounts;

      for (const review of allFriendReviews) {
        const avgRating =
          review.items.length > 0
            ? Math.round(review.items.reduce((sum, item) => sum + item.rating, 0) / review.items.length)
            : 3;

        const days = Math.floor((now - new Date(review.created_at).getTime()) / 86400000);
        const weeksAgo = Math.floor(days / 7);
        const timeAgo =
          days === 0 ? "today"
          : days === 1 ? "1d ago"
          : days < 7 ? `${days}d ago`
          : weeksAgo === 1 ? "1w ago"
          : `${weeksAgo}w ago`;

        if (!circleReviews[review.restaurant_name]) circleReviews[review.restaurant_name] = [];
        circleReviews[review.restaurant_name].push({
          friend_name: review.reviewer_name,
          rating: avgRating,
          text: review.body ?? "",
          time_ago: timeAgo,
        });
      }
    }
  }

  return {
    week,
    month,
    alltime,
    peopleCounts,
    circleReviews,
    circleWeek,
    circleMonth,
    circleAlltime,
    circlePeopleCounts,
  };
}
