import { NextRequest, NextResponse } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import type { Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { computeCommonRestaurants } from "@/lib/common-restaurants";

type ProfileRow = {
  id: string;
  username: string | null;
};

const COMMON_RESTAURANT_REVIEW_SELECT = [
  "reviewer_name",
  "restaurant_id",
  "restaurant_name",
  "photo_url",
  "photo_urls",
  "visibility",
  "deleted_at",
  "hidden_at",
  "reported_at",
  "status",
].join(", ");

interface Props {
  params: Promise<{ targetUserId: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const { targetUserId } = await params;
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const viewerName = actor.actorName;
  if (!viewerName) {
    return NextResponse.json({ error: "Viewer profile is missing a username" }, { status: 400 });
  }

  // Resolve targetUserId — accepts either a UUID or a username
  const decoded = decodeURIComponent(targetUserId);
  const targetQuery = supabase
    .from("profiles")
    .select("id, username")
    .eq(/^[0-9a-f-]{36}$/i.test(decoded) ? "id" : "username", decoded)
    .maybeSingle()
    .returns<ProfileRow>();
  const { data: targetProfile } = await targetQuery;
  const target = targetProfile as ProfileRow | null;
  if (!target?.username) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  const targetName = target.username;
  if (targetName === viewerName) {
    return NextResponse.json({ error: "Target user must be a different account" }, { status: 400 });
  }

  const [
    viewerCanSeeTargetCircle,
    targetCanSeeViewerCircle,
    { data: reviews },
  ] = await Promise.all([
    hasCircleAccess(supabase, targetName, viewerName),
    hasCircleAccess(supabase, viewerName, targetName),
    supabase
      .from("reviews")
      .select(COMMON_RESTAURANT_REVIEW_SELECT)
      .in("reviewer_name", [viewerName, targetName])
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .returns<Review[]>(),
  ]);

  const commonRestaurants = computeCommonRestaurants(reviews ?? [], viewerName, targetName, {
    firstCanSeeSecondCircle: viewerCanSeeTargetCircle,
    secondCanSeeFirstCircle: targetCanSeeViewerCircle,
  });

  return NextResponse.json({
    targetUserId: target.id,
    targetUsername: targetName,
    commonRestaurantCount: commonRestaurants.length,
    commonRestaurants,
  });
}
