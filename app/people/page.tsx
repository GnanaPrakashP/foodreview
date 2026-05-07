import { createClient } from "@/lib/supabase/server";
import PeopleTab from "@/components/people/PeopleTab";
import type { AccountType, Review } from "@/lib/types";
import { DEFAULT_ACCOUNT_TYPE, normalizeAccountType } from "@/lib/circle";
import { filterGlobalTrendingReviews } from "@/lib/visibility";

export const dynamic = "force-dynamic";

type ProfileSummary = {
  first_name: string;
  last_name: string;
  account_type: string | null;
};

export interface CircleMember {
  name: string;
  accountType: AccountType;
  totalPlaces: number;
  lastPlace: string | null;
  commonRestaurantCount: number;
  suggestionRank: number;
}

export default async function PeoplePage() {
  const supabase = await createClient();

  const [{ data: reviews }, { data: profiles }, { data: { user } }] = await Promise.all([
    supabase
      .from("reviews")
      .select("reviewer_name, restaurant_name, visibility, created_at")
      .order("created_at", { ascending: false })
      .returns<Pick<Review, "reviewer_name" | "restaurant_name" | "visibility" | "created_at">[]>(),
    supabase
      .from("profiles")
      .select("first_name, last_name, account_type")
      .returns<ProfileSummary[]>(),
    supabase.auth.getUser(),
  ]);

  const myName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "";
  const allReviews = (reviews ?? []) as Review[];
  const publicReviews = filterGlobalTrendingReviews(allReviews);
  const myRestaurants = new Set(
    allReviews
      .filter((review) => review.reviewer_name === myName)
      .map((review) => review.restaurant_name)
  );
  const profileAccountTypes = new Map<string, AccountType>();
  for (const p of profiles ?? []) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    if (name) profileAccountTypes.set(name, normalizeAccountType(p.account_type));
  }

  // Group by reviewer_name — each unique reviewer = a "person on the app"
  const memberMap = new Map<string, { accountType: AccountType; restaurants: Set<string>; lastPlace: string | null; lastSeen: number }>();
  for (const r of publicReviews) {
    const existing = memberMap.get(r.reviewer_name);
    if (!existing) {
      memberMap.set(r.reviewer_name, {
        accountType: profileAccountTypes.get(r.reviewer_name) ?? DEFAULT_ACCOUNT_TYPE,
        restaurants: new Set([r.restaurant_name]),
        lastPlace: r.restaurant_name,
        lastSeen: new Date(r.created_at).getTime(),
      });
    } else {
      existing.restaurants.add(r.restaurant_name);
      existing.lastSeen = Math.max(existing.lastSeen, new Date(r.created_at).getTime());
    }
  }

  // Include registered users who haven't posted any reviews yet
  for (const p of profiles ?? []) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    if (name && !memberMap.has(name)) {
      memberMap.set(name, {
        accountType: normalizeAccountType(p.account_type),
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
        accountType: data.accountType,
        totalPlaces: data.restaurants.size,
        lastPlace: data.lastPlace,
        commonRestaurantCount,
        suggestionRank: commonRestaurantCount * 10_000 + data.lastSeen,
      };
    })
    .sort((a, b) => b.suggestionRank - a.suggestionRank || b.totalPlaces - a.totalPlaces || a.name.localeCompare(b.name));

  return <PeopleTab initialCircle={circleMembers} />;
}
