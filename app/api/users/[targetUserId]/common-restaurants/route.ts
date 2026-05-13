import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { computeCommonRestaurants } from "@/lib/common-restaurants";

type ProfileRow = {
  id: string;
  username: string | null;
};

interface Props {
  params: Promise<{ targetUserId: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { targetUserId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .maybeSingle()
    .returns<ProfileRow>();

  const viewerName = (viewerProfile as ProfileRow | null)?.username
    || (user.user_metadata?.username as string)
    || user.email?.split("@")[0]
    || "";
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
      .select("*")
      .in("reviewer_name", [viewerName, targetName])
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
