import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteSupabase } from "@/lib/server/route-supabase";
import { loadProfileReviewsPage, parseProfileReviewsCursor } from "@/lib/profile-reviews";

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ targetUserId: string }> }) {
  const { targetUserId } = await params;
  const ownerName = decodeURIComponent(targetUserId);
  const limit = parseNumber(req.nextUrl.searchParams.get("limit"), 24);
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseProfileReviewsCursor(rawCursor);
  const restaurantName = req.nextUrl.searchParams.get("restaurantName")?.trim() || null;

  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    const viewerName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
    const page = await loadProfileReviewsPage(createAdminClient(), ownerName, viewerName, {
      cursor,
      limit,
      restaurantName,
    });
    return NextResponse.json(page);
  } catch (error) {
    console.error("[users/reviews] failed:", error);
    return NextResponse.json({ error: "Unable to load reviews" }, { status: 500 });
  }
}
