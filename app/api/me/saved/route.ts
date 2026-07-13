import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { savedPostsForActor } from "@/lib/server/engagement-list";
import { getRouteActor } from "@/lib/server/route-supabase";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { decodeStableTimestampCursor, encodeStableTimestampCursor } from "@/lib/server/stable-cursor";

const DEFAULT_PAGE_SIZE = 30;

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = decodeStableTimestampCursor(rawCursor);
  if (rawCursor && !cursor) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_PAGE_SIZE));
  const data = await savedPostsForActor(db, actor.actorName, { cursor, limit });
  const profileMap = await buildProfileDisplayMap(db, data.reviews.map((r) => r.reviewer_name));
  return NextResponse.json({ ...data, nextCursor: encodeStableTimestampCursor(data.nextCursor), profileMap, myName: actor.actorName });
}
