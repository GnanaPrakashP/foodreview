import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { likedPostsForActor } from "@/lib/server/engagement-list";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function GET() {
  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const data = await likedPostsForActor(db, actor.actorName);
  return NextResponse.json({ ...data, myName: actor.actorName });
}
