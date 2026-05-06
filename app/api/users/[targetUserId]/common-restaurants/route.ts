import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { computeCommonRestaurants } from "@/lib/common-restaurants";

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
};

interface Props {
  params: Promise<{ targetUserId: string }>;
}

function profileName(profile: Pick<ProfileRow, "first_name" | "last_name">): string {
  return `${profile.first_name} ${profile.last_name}`.trim();
}

function findProfile(profiles: ProfileRow[], target: string): ProfileRow | null {
  const decoded = decodeURIComponent(target);
  return profiles.find((profile) =>
    profile.id === decoded ||
    profile.username === decoded ||
    profileName(profile) === decoded
  ) ?? null;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { targetUserId } = await params;
  const supabase = await createClient();

  const [{ data: { user } }, { data: profiles }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, username")
      .limit(1000)
      .returns<ProfileRow[]>(),
  ]);

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const profileRows = profiles ?? [];
  const viewerProfile = profileRows.find((profile) => profile.id === user.id);
  const viewerName = viewerProfile ? profileName(viewerProfile) : user.user_metadata?.full_name ?? "";
  const targetProfile = findProfile(profileRows, targetUserId);

  if (!viewerName) {
    return NextResponse.json({ error: "Viewer profile is missing a name" }, { status: 400 });
  }
  if (!targetProfile) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  const targetName = profileName(targetProfile);
  if (!targetName || targetName === viewerName) {
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
    targetUserId: targetProfile.id,
    commonRestaurantCount: commonRestaurants.length,
    commonRestaurants,
  });
}
