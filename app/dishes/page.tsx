import { createClient } from "@/lib/supabase/server";
import { getPopularDishes } from "@/lib/dishes";
import type { SlimReview } from "@/lib/dishes";
import type { Review } from "@/lib/types";
import DishSearch from "@/components/dishes/DishSearch";

export const revalidate = 300;

export default async function DishesPage() {
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, restaurant_name, reviewer_name, items, body, created_at")
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<Review[]>();

  const slim: SlimReview[] = (reviews ?? []).map((r) => ({
    id: r.id,
    restaurant_name: r.restaurant_name,
    reviewer_name: r.reviewer_name,
    items: r.items,
    body: r.body,
    created_at: r.created_at,
  }));

  const popularDishes = getPopularDishes(slim);

  return <DishSearch reviews={slim} popularDishes={popularDishes} />;
}
