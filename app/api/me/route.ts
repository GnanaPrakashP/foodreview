import { NextRequest, NextResponse } from "next/server";
import { getMePageData, invalidateMePageCacheForNames, type MeCursor } from "@/lib/me-page-data";
import { invalidatePeoplePageCacheForNames } from "@/lib/people-page-data";
import { invalidateTrendingPageCacheForNames } from "@/lib/trending-page-data";
import { createRouteSupabase } from "@/lib/server/route-supabase";

const ME_PAGE_MIN_LIMIT = 1;
const ME_PAGE_MAX_LIMIT = 100;

// reviews.id is a UUID (gen_random_uuid() in schema)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Strict ISO 8601 datetime to prevent PostgREST filter injection via cursor values
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function getMyName(user: { user_metadata?: Record<string, unknown>; email?: string | null }) {
  return (user.user_metadata?.username as string) || user.email?.split("@")[0] || "";
}

function displayNameFromProfile(
  profile: { first_name?: string | null; last_name?: string | null } | null,
  fallback: string
) {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return fullName || fallback;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myName = getMyName(user);
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, bio")
      .eq("id", user.id)
      .maybeSingle();
    const metadataDisplayName =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      myName;
    const displayName = displayNameFromProfile(profile, metadataDisplayName);
    const bio = (profile?.bio as string | null) || (user.user_metadata?.bio as string) || "";

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

    const data = await getMePageData(supabase, myName, { cursor, limit });
    return NextResponse.json({ ...data, myName, displayName, bio });
  } catch (error) {
    console.error("[me] failed to load:", error);
    return NextResponse.json({ error: "Unable to load profile" }, { status: 500 });
  }
}

// Called by the settings page after account-type changes to drop stale server-side
// private-cache entries for this user (me-page, people-page, trending).
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const myName = getMyName(user);
    if (myName) {
      invalidateMePageCacheForNames([myName]);
      invalidatePeoplePageCacheForNames([myName]);
      invalidateTrendingPageCacheForNames([myName]);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[me invalidate] failed:", error);
    return NextResponse.json({ error: "Unable to invalidate" }, { status: 500 });
  }
}
