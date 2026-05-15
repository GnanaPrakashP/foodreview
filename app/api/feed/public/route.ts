import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CIRCLE_FEED_PAGE_SIZE, CIRCLE_FEED_MAX_PAGE_SIZE } from "@/lib/feed-config";
import { parseCircleFeedCursor } from "@/lib/circle-feed";
import type { Review, Comment } from "@/lib/types";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { normalizeReview } from "@/lib/server/normalize-review";

const REVIEW_SELECT = [
  "id",
  "reviewer_name",
  "restaurant_id",
  "restaurant_name",
  "area",
  "restaurant_address",
  "restaurant_lat",
  "restaurant_lng",
  "items",
  "body",
  "photo_url",
  "review_photos(public_url, position)",
  "visibility",
  "created_at",
  "deleted_at",
  "hidden_at",
  "reported_at",
  "status",
].join(", ");

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  const limit = Math.min(
    CIRCLE_FEED_MAX_PAGE_SIZE,
    Math.max(1, parseNumber(req.nextUrl.searchParams.get("limit"), CIRCLE_FEED_PAGE_SIZE))
  );
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCircleFeedCursor(rawCursor);
  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  // excludeNames: circle members + the viewer themselves — their posts already appear above the divider
  const excludeParam = req.nextUrl.searchParams.get("exclude") ?? "";
  const excludeNames = excludeParam
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  const myName = req.nextUrl.searchParams.get("viewer") ?? "";

  try {
    const db = createAdminClient();

    let query = db
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    // Fetch extra rows so we can filter out excluded names and still fill the page
    const fetchLimit = Math.min(200, (excludeNames.length + 1) * limit + limit);
    const { data: rawRows, error } = await query.limit(fetchLimit);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const excludeSet = new Set(excludeNames);
    const filtered = ((rawRows ?? []) as unknown[])
      .map((r) => normalizeReview(r as Parameters<typeof normalizeReview>[0]))
      .filter((r) => !excludeSet.has(r.reviewer_name));

    const hasMore = filtered.length > limit;
    const reviews = filtered.slice(0, limit);
    const nextCursor = hasMore && reviews.length > 0
      ? { createdAt: reviews[reviews.length - 1].created_at, id: reviews[reviews.length - 1].id }
      : null;

    const postIds = reviews.map((r) => r.id);

    const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }, profileMap] = postIds.length > 0
      ? await Promise.all([
          db.from("likes").select("post_id, user_name").in("post_id", postIds),
          db
            .from("comments")
            .select("id, post_id, user_name, content, created_at")
            .in("post_id", postIds)
            .order("created_at", { ascending: false }),
          myName && postIds.length > 0
            ? db
                .from("wishlist")
                .select("post_id")
                .eq("user_name", myName)
                .in("post_id", postIds)
            : Promise.resolve({ data: [] }),
          Promise.resolve().then(() => buildProfileDisplayMap(db, reviews.map((r) => r.reviewer_name))),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, {}];

    const likeCountMap: Record<string, number> = {};
    const likedByMeMap: Record<string, boolean> = {};
    for (const like of (rawLikes ?? []) as { post_id: string; user_name: string }[]) {
      likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
      if (like.user_name === myName) likedByMeMap[like.post_id] = true;
    }

    const bookmarkedPostMap: Record<string, boolean> = {};
    for (const item of (rawWishlist ?? []) as { post_id: string | null }[]) {
      if (item.post_id) bookmarkedPostMap[item.post_id] = true;
    }

    type CommentRow = Comment & { post_id: string };
    const commentMap: Record<string, { count: number; top: Comment }> = {};
    for (const comment of (rawComments ?? []) as unknown as CommentRow[]) {
      const ex = commentMap[comment.post_id];
      if (!ex) {
        commentMap[comment.post_id] = { count: 1, top: comment };
      } else {
        ex.count++;
      }
    }

    return NextResponse.json({
      reviews,
      likeCountMap,
      commentMap,
      likedByMeMap,
      bookmarkedPostMap,
      profileMap,
      hasMore,
      nextCursor,
    });
  } catch (err) {
    console.error("[feed/public] failed:", err);
    return NextResponse.json({ error: "Unable to load public feed" }, { status: 500 });
  }
}
