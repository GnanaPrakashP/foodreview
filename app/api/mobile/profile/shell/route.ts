import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";

const PROFILE_SELECT = "id, first_name, last_name, username, avatar_url, bio, account_type, trust_score, trust_level, confirmed_recommendations_count, positive_confirmations_count, negative_confirmations_count, total_feedback_points, created_at";

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createAdminClient();
  const [profileResult, statsResult, circleResult] = await Promise.all([
    db.from("profiles").select(PROFILE_SELECT).eq("id", actor.userId).maybeSingle(),
    db.rpc("profile_post_stats", { p_username: actor.actorName }).maybeSingle(),
    db.from("circle_memberships").select("member_name", { count: "exact", head: true }).eq("user_name", actor.actorName),
  ]);
  if (profileResult.error || statsResult.error || circleResult.error) {
    console.error("[mobile/profile/shell] bounded shell query failed");
    return NextResponse.json({ error: "Profile deployment contract unavailable" }, { status: 503 });
  }
  if (!profileResult.data) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const row = profileResult.data;
  const stats = statsResult.data as {
    total_visits?: number | string | null;
    unique_dishes?: number | string | null;
    unique_places?: number | string | null;
  } | null;
  const profile = {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    accountType: row.account_type === "private" ? "private" : "public",
    trustScore: Number(row.trust_score ?? 20),
    trustLevel: row.trust_level ?? "New Reviewer",
    confirmedRecommendationsCount: Number(row.confirmed_recommendations_count ?? 0),
    positiveConfirmationsCount: Number(row.positive_confirmations_count ?? 0),
    negativeConfirmationsCount: Number(row.negative_confirmations_count ?? 0),
    totalFeedbackPoints: Number(row.total_feedback_points ?? 0),
    createdAt: row.created_at,
  };
  return NextResponse.json({
    circleCount: circleResult.count ?? 0,
    displayName: actor.displayName,
    profile,
    stats: {
      totalVisits: Number(stats?.total_visits ?? 0),
      uniqueDishes: Number(stats?.unique_dishes ?? 0),
      uniquePlaces: Number(stats?.unique_places ?? 0),
    },
  });
}
