import { NextRequest, NextResponse } from "next/server";
import { getCircleFeedPage, parseCircleFeedCursor } from "@/lib/circle-feed";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { createRouteSupabase } from "@/app/api/notifications/_utils";

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabase();
  const limit = parseNumber(req.nextUrl.searchParams.get("limit"), CIRCLE_FEED_PAGE_SIZE);
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCircleFeedCursor(rawCursor);

  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  try {
    const page = await getCircleFeedPage(supabase, { cursor, limit });
    if (!page.myName) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(page);
  } catch (error) {
    console.error("[feed/circle] failed to load page:", error);
    return NextResponse.json({ error: "Unable to load feed" }, { status: 500 });
  }
}
