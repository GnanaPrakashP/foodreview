import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import MyListClient from "@/components/mylist/MyListClient";

export const dynamic = "force-dynamic";

export default async function MyListPage() {
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<Review[]>();

  return <MyListClient allReviews={reviews ?? []} />;
}
