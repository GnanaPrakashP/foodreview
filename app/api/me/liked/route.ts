import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { likedPostsForActor } from "@/lib/server/engagement-list";
import { getRouteActor } from "@/lib/server/route-supabase";
import { buildProfileDisplayMap } from "@/lib/profile-display";

export async function GET() {
  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const data = await likedPostsForActor(db, actor.actorName);
  const profileMap = await buildProfileDisplayMap(db, data.reviews.map((r) => r.reviewer_name));
  return NextResponse.json({ ...data, profileMap, myName: actor.actorName });
}
