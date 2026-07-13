import { NextRequest, NextResponse } from "next/server";
import { getMePageData, invalidateMePageCacheForNames, type MeCursor } from "@/lib/me-page-data";
import { invalidatePeoplePageCacheForNames } from "@/lib/people-page-data";
import { invalidateCircleFeedCacheForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { tasteTrustSummaryFromProfile } from "@/lib/taste-trust";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserProfileReputation } from "@/lib/server/reputation";
import { enforceRateLimit, rateLimitResponse } from "@/lib/server/api-security";

const ME_PAGE_MIN_LIMIT = 1;
const ME_PAGE_MAX_LIMIT = 100;

// reviews.id is a UUID (gen_random_uuid() in schema)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Strict ISO 8601 datetime to prevent PostgREST filter injection via cursor values
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const POST_METHODS = ["POST"];

function displayNameFromProfile(
  profile: { first_name?: string | null; last_name?: string | null } | null,
  fallback: string
) {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return fullName || fallback;
}

export async function GET(req: NextRequest) {
  try {
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const myName = actor.actorName;
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, bio, trust_score, trust_level, confirmed_recommendations_count, positive_confirmations_count, negative_confirmations_count, total_feedback_points")
      .eq("id", actor.userId)
      .maybeSingle();
    const displayName = displayNameFromProfile(profile, actor.displayName);
    const bio = (profile?.bio as string | null) || "";

    if (!myName) return NextResponse.json({ reviews: [], circleMembers: [], hasMore: false, nextCursor: null });

    const rawLimit = req.nextUrl.searchParams.get("limit");
    const limit = rawLimit !== null
      ? Math.min(ME_PAGE_MAX_LIMIT, Math.max(ME_PAGE_MIN_LIMIT, parseInt(rawLimit, 10) || ME_PAGE_MIN_LIMIT))
      : undefined;

    const rawCursor = req.nextUrl.searchParams.get("cursor");
    let cursor: MeCursor | null = null;
    if (rawCursor) {
      try {
        const parsed = JSON.parse(rawCursor);
        if (
          typeof parsed?.createdAt !== "string" ||
          typeof parsed?.id !== "string" ||
          !ISO_DATETIME_RE.test(parsed.createdAt) ||
          !UUID_RE.test(parsed.id)
        ) {
          return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
        }
        cursor = { createdAt: parsed.createdAt, id: parsed.id };
      } catch {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    const [data, reputation] = await Promise.all([
      getMePageData(supabase, myName, { cursor, limit }),
      getUserProfileReputation(createAdminClient(), actor.userId),
    ]);
    return NextResponse.json({ ...data, myName, displayName, bio, tasteTrust: tasteTrustSummaryFromProfile(profile), reputation });
  } catch (error) {
    console.error("[me] failed to load:", error);
    return NextResponse.json({ error: "Unable to load profile" }, { status: 500 });
  }
}

// Called by the settings page after account-type changes to drop stale server-side
// private-cache entries for this user (me-page, people-page).
export async function POST(req: NextRequest) {
  try {
    const { actor } = await getRouteActor(req);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rate = await enforceRateLimit(req, "mutation.social", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, POST_METHODS, rate);
    const myName = actor.actorName;
    if (myName) {
      invalidateMePageCacheForNames([myName]);
      invalidatePeoplePageCacheForNames([myName]);
      // Circle feed is tagged by member names, so this also clears viewers who have
      // this user in their circle — important when account type / visibility changes.
      invalidateCircleFeedCacheForNames([myName]);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[me invalidate] failed:", error);
    return NextResponse.json({ error: "Unable to invalidate" }, { status: 500 });
  }
}
