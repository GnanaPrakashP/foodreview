import { createClient } from "@/lib/supabase/server";
import PeopleTab from "@/components/people/PeopleTab";
import type { Review } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface CircleMember {
  name: string;
  totalPlaces: number;
  lastPlace: string | null;
}

export default async function PeoplePage() {
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("reviewer_name, restaurant_name, created_at")
    .order("created_at", { ascending: false })
    .returns<Pick<Review, "reviewer_name" | "restaurant_name" | "created_at">[]>();

  // Group by reviewer_name — each unique reviewer = a "person on the app"
  const memberMap = new Map<string, { totalPlaces: number; lastPlace: string | null }>();
  for (const r of reviews ?? []) {
    const existing = memberMap.get(r.reviewer_name);
    if (!existing) {
      memberMap.set(r.reviewer_name, {
        totalPlaces: 1,
        lastPlace: r.restaurant_name,
      });
    } else {
      memberMap.set(r.reviewer_name, {
        totalPlaces: existing.totalPlaces + 1,
        lastPlace: existing.lastPlace, // already set to most recent (ordered desc)
      });
    }
  }

  const circleMembers: CircleMember[] = Array.from(memberMap.entries()).map(
    ([name, data]) => ({ name, ...data })
  );

  return <PeopleTab initialCircle={circleMembers} />;
}
