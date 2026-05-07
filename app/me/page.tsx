import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import MeClient from "@/components/me/MeClient";
import { getCircleRelationshipsForName } from "@/lib/circle-db";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const myName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "";

  if (!myName) return <MeClient allReviews={[]} />;

  const [relationships, { data: reviews }] = await Promise.all([
    getCircleRelationshipsForName(supabase, myName),
    supabase
      .from("reviews")
      .select("*")
      .eq("reviewer_name", myName)
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<Review[]>(),
  ]);

  return (
    <MeClient
      allReviews={reviews ?? []}
      initialMyName={myName}
      initialCircle={[...relationships.circleMembers]}
    />
  );
}
