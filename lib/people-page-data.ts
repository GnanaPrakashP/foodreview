import type { AccountType, Review } from "@/lib/types";
import { DEFAULT_ACCOUNT_TYPE, normalizeAccountType } from "@/lib/circle";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";
import { filterGlobalTrendingReviews } from "@/lib/visibility";
import { profileDisplayName } from "@/lib/profile-names";

const PEOPLE_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const PEOPLE_PAGE_DEFAULT_LIMIT = 48;
const PEOPLE_PAGE_MAX_LIMIT = 100;
const PEOPLE_REVIEWS_SCAN_LIMIT = 600;

type SupabaseLike = {
  from: (table: string) => any;
};

type ProfileSummary = {
  username: string | null;
  account_type: string | null;
  first_name: string | null;
  last_name: string | null;
};

export interface CircleMember {
  name: string;
  displayName: string;
  accountType: AccountType;
  totalPlaces: number;
  lastPlace: string | null;
  commonRestaurantCount: number;
  suggestionRank: number;
}

type PeoplePageOptions = {
  limit?: number;
};

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

export function invalidatePeoplePageCacheForNames(names: string[]) {
  const tags = ["people-page:all"];
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized) tags.push(`people-page:${normalized}`);
  }
  invalidatePrivateCacheByTags(tags);
}

const globalForPeopleCache = globalThis as typeof globalThis & {
  __foodReviewInvalidatePeoplePageCacheForNames?: (names: string[]) => void;
};

globalForPeopleCache.__foodReviewInvalidatePeoplePageCacheForNames = invalidatePeoplePageCacheForNames;

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return PEOPLE_PAGE_DEFAULT_LIMIT;
  return Math.min(PEOPLE_PAGE_MAX_LIMIT, Math.max(1, Math.floor(limit as number)));
}

export async function getPeoplePageData(supabase: SupabaseLike, myName: string, options: PeoplePageOptions = {}) {
  const viewer = normalizeName(myName) || "anonymous";
  const limit = clampLimit(options.limit);
  return getPrivateCached({
    key: `people-page:v2:${viewer}:${limit}`,
    ttlMs: PEOPLE_PAGE_CACHE_TTL_MS,
    load: async () => ({
      value: await loadPeoplePageData(supabase, myName, limit),
      tags: [`people-page:${viewer}`, "people-page:all"],
    }),
  });
}

async function loadPeoplePageData(supabase: SupabaseLike, myName: string, limit: number): Promise<{ circleMembers: CircleMember[]; hasMore: boolean }> {
  const { data: reviews } =
    // Only public, non-suppressed reviews. Keeps the working set manageable and prevents
    // private/circle posts from leaking into the people suggestion ranking.
    await supabase
      .from("reviews")
      .select("reviewer_name, restaurant_name, visibility, created_at")
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(PEOPLE_REVIEWS_SCAN_LIMIT);

  const allReviews = (reviews ?? []) as Pick<Review, "reviewer_name" | "restaurant_name" | "visibility" | "created_at">[] as Review[];
  const publicReviews = filterGlobalTrendingReviews(allReviews);
  const reviewerNames = Array.from(new Set(publicReviews.map((review) => review.reviewer_name).filter(Boolean)));

  const [{ data: reviewerProfiles }, { data: starterProfiles }] = await Promise.all([
    reviewerNames.length > 0
      ? supabase
          .from("profiles")
          .select("username, account_type, first_name, last_name")
          .in("username", reviewerNames)
      : Promise.resolve({ data: [] }),
    supabase
      .from("profiles")
      .select("username, account_type, first_name, last_name")
      .not("username", "is", null)
      .order("username", { ascending: true })
      .limit(limit + 1),
  ]);

  const profileRows = Array.from(
    new Map(
      ([...(reviewerProfiles ?? []), ...(starterProfiles ?? [])] as ProfileSummary[])
        .filter((profile) => profile.username)
        .map((profile) => [profile.username, profile])
    ).values()
  );
  const myRestaurants = new Set(
    allReviews
      .filter((review) => review.reviewer_name === myName)
      .map((review) => review.restaurant_name)
  );
  const profileAccountTypes = new Map<string, AccountType>();
  const displayNameMap = new Map<string, string>();
  for (const profile of profileRows) {
    if (profile.username) {
      profileAccountTypes.set(profile.username, normalizeAccountType(profile.account_type));
      displayNameMap.set(profile.username, profileDisplayName(profile, profile.username));
    }
  }

  const memberMap = new Map<string, {
    accountType: AccountType;
    restaurants: Set<string>;
    lastPlace: string | null;
    lastSeen: number;
  }>();

  for (const review of publicReviews) {
    const existing = memberMap.get(review.reviewer_name);
    if (!existing) {
      memberMap.set(review.reviewer_name, {
        accountType: profileAccountTypes.get(review.reviewer_name) ?? DEFAULT_ACCOUNT_TYPE,
        restaurants: new Set([review.restaurant_name]),
        lastPlace: review.restaurant_name,
        lastSeen: new Date(review.created_at).getTime(),
      });
    } else {
      existing.restaurants.add(review.restaurant_name);
      existing.lastSeen = Math.max(existing.lastSeen, new Date(review.created_at).getTime());
    }
  }

  for (const profile of profileRows) {
    if (profile.username && !memberMap.has(profile.username)) {
      memberMap.set(profile.username, {
        accountType: normalizeAccountType(profile.account_type),
        restaurants: new Set(),
        lastPlace: null,
        lastSeen: 0,
      });
    }
  }

  const sortedMembers: CircleMember[] = Array.from(memberMap.entries())
    .map(([name, data]) => {
      const commonRestaurantCount = Array.from(data.restaurants).filter((restaurant) => myRestaurants.has(restaurant)).length;
      return {
        name,
        displayName: displayNameMap.get(name) || name,
        accountType: data.accountType,
        totalPlaces: data.restaurants.size,
        lastPlace: data.lastPlace,
        commonRestaurantCount,
        suggestionRank: commonRestaurantCount * 10_000 + data.lastSeen,
      };
    })
    .sort((a, b) => b.suggestionRank - a.suggestionRank || b.totalPlaces - a.totalPlaces || a.name.localeCompare(b.name));

  return {
    circleMembers: sortedMembers.slice(0, limit),
    hasMore: sortedMembers.length > limit || (starterProfiles ?? []).length > limit,
  };
}
