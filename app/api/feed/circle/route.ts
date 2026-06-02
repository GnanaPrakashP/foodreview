import { NextRequest, NextResponse } from "next/server";
import { getCircleFeedPage, parseCircleFeedCursor } from "@/lib/circle-feed";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { createRouteSupabase } from "@/lib/server/route-supabase";

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsvIds(value: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, 200);
}

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabase();
  const limit = parseNumber(req.nextUrl.searchParams.get("limit"), CIRCLE_FEED_PAGE_SIZE);
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCircleFeedCursor(rawCursor);
  const refreshMode = req.nextUrl.searchParams.get("refresh") === "1";
  const excludePostIds = parseCsvIds(req.nextUrl.searchParams.get("excludeSeen"));

  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  try {
    const page = await getCircleFeedPage(supabase, {
      cursor,
      limit,
      bypassCache: refreshMode && !cursor,
      excludePostIds,
    });
    if (!page.myName) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(page);
  } catch (error) {
    console.error("[feed/circle] failed to load page:", error);
    return NextResponse.json({ error: "Unable to load feed" }, { status: 500 });
  }
}
