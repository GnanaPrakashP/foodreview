import type { AccountType, Review } from "@/lib/types";
import { DEFAULT_ACCOUNT_TYPE, normalizeAccountType } from "@/lib/circle";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";
import { filterGlobalTrendingReviews } from "@/lib/visibility";
import { profileDisplayName } from "@/lib/profile-names";

const PEOPLE_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;

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

export async function getPeoplePageData(supabase: SupabaseLike, myName: string) {
  const viewer = normalizeName(myName) || "anonymous";
  return getPrivateCached({
    key: `people-page:v1:${viewer}`,
    ttlMs: PEOPLE_PAGE_CACHE_TTL_MS,
    load: async () => ({
      value: await loadPeoplePageData(supabase, myName),
      tags: [`people-page:${viewer}`, "people-page:all"],
    }),
  });
}

async function loadPeoplePageData(supabase: SupabaseLike, myName: string): Promise<{ circleMembers: CircleMember[] }> {
  const [{ data: reviews }, { data: profiles }] = await Promise.all([
    // Only public, non-suppressed reviews. Keeps the working set manageable and prevents
    // private/circle posts from leaking into the people suggestion ranking.
    supabase
      .from("reviews")
      .select("reviewer_name, restaurant_name, visibility, created_at")
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("profiles")
      .select("username, account_type, first_name, last_name")
      .not("username", "is", null),
  ]);

  const allReviews = (reviews ?? []) as Pick<Review, "reviewer_name" | "restaurant_name" | "visibility" | "created_at">[] as Review[];
  const profileRows = (profiles ?? []) as ProfileSummary[];
  const publicReviews = filterGlobalTrendingReviews(allReviews);
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

  const circleMembers: CircleMember[] = Array.from(memberMap.entries())
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

  return { circleMembers };
}
