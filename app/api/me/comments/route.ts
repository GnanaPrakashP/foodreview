import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { commentsForActor } from "@/lib/server/engagement-list";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const data = await commentsForActor(db, actor.actorName);
  const profileMap = await buildProfileDisplayMap(
    db,
    data.comments.map((comment) => comment.reviews?.reviewer_name)
  );
  return NextResponse.json({ ...data, profileMap, myName: actor.actorName });
}
