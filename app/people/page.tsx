import { createClient } from "@/lib/supabase/server";
import PeopleTab from "@/components/people/PeopleTab";
import type { AccountType, Review } from "@/lib/types";
import { normalizeAccountType } from "@/lib/circle";
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
}

export default async function PeoplePage() {
  const supabase = await createClient();

  const [{ data: reviews }, { data: profiles }] = await Promise.all([
    supabase
      .from("reviews")
      .select("reviewer_name, restaurant_name, visibility, created_at")
      .order("created_at", { ascending: false })
      .returns<Pick<Review, "reviewer_name" | "restaurant_name" | "visibility" | "created_at">[]>(),
    supabase
      .from("profiles")
      .select("first_name, last_name, account_type")
      .returns<ProfileSummary[]>(),
  ]);

  const profileAccountTypes = new Map<string, AccountType>();
  for (const p of profiles ?? []) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    if (name) profileAccountTypes.set(name, normalizeAccountType(p.account_type));
  }

  // Group by reviewer_name — each unique reviewer = a "person on the app"
  const memberMap = new Map<string, { accountType: AccountType; totalPlaces: number; lastPlace: string | null }>();
  for (const r of filterGlobalTrendingReviews((reviews ?? []) as Review[])) {
    const existing = memberMap.get(r.reviewer_name);
    if (!existing) {
      memberMap.set(r.reviewer_name, {
        accountType: profileAccountTypes.get(r.reviewer_name) ?? "private",
        totalPlaces: 1,
        lastPlace: r.restaurant_name,
      });
    } else {
      memberMap.set(r.reviewer_name, {
        accountType: existing.accountType,
        totalPlaces: existing.totalPlaces + 1,
        lastPlace: existing.lastPlace,
      });
    }
  }

  // Include registered users who haven't posted any reviews yet
  for (const p of profiles ?? []) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    if (name && !memberMap.has(name)) {
      memberMap.set(name, {
        accountType: normalizeAccountType(p.account_type),
        totalPlaces: 0,
        lastPlace: null,
      });
    }
  }

  const circleMembers: CircleMember[] = Array.from(memberMap.entries()).map(
    ([name, data]) => ({ name, ...data })
  );

  return <PeopleTab initialCircle={circleMembers} />;
}
