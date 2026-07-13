import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { savedPostsForActor } from "@/lib/server/engagement-list";
import { getRouteActor } from "@/lib/server/route-supabase";
import { buildProfileDisplayMap } from "@/lib/profile-display";

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const data = await savedPostsForActor(db, actor.actorName);
  const profileMap = await buildProfileDisplayMap(db, data.reviews.map((r) => r.reviewer_name));
  return NextResponse.json({ ...data, profileMap, myName: actor.actorName });
}
