import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import MyListClient from "@/components/mylist/MyListClient";

export const dynamic = "force-dynamic";

export default async function MyListPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const myName = (user?.user_metadata?.username as string) ?? "";

  if (!myName) return <MyListClient allReviews={[]} />;

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("reviewer_name", myName)
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<Review[]>();

  return <MyListClient allReviews={reviews ?? []} />;
}
