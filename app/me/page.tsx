import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import MeClient from "@/components/me/MeClient";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<Review[]>();

  return <MeClient allReviews={reviews ?? []} />;
}
