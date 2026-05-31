import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CIRCLE_FEED_PAGE_SIZE, CIRCLE_FEED_MAX_PAGE_SIZE } from "@/lib/feed-config";
import { parseCircleFeedCursor } from "@/lib/circle-feed";
import type { Comment } from "@/lib/types";
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
  "tags",
  "photo_url",
  "photo_urls",
  "review_photos(public_url, media_type, position)",
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

function parseCoordinate(value: string | null, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function nearbyBounds(lat: number, lng: number, radiusKm = 30) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
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

  // Explore top picks and public posts are based on the whole public user base.
  // Keep an explicit exclude override for callers that need a narrower view.
  const excludeParam = req.nextUrl.searchParams.get("exclude") ?? "";
  const excludeSeenParam = req.nextUrl.searchParams.get("excludeSeen") ?? "";
  const myName = req.nextUrl.searchParams.get("viewer") ?? "";
  const excludeSynthetic = req.nextUrl.searchParams.get("excludeSynthetic") === "1";
  // When true, return an empty result set rather than falling back to base rows when all
  // candidates are excluded. Used by Circle suggested-fallback to avoid reintroducing seen posts.
  const strictExclude = req.nextUrl.searchParams.get("strictExclude") === "1";
  const placeId = req.nextUrl.searchParams.get("placeId")?.trim() || "";
  const restaurantName = req.nextUrl.searchParams.get("restaurantName")?.trim() || "";
  const lat = parseCoordinate(req.nextUrl.searchParams.get("lat"), -90, 90);
  const lng = parseCoordinate(req.nextUrl.searchParams.get("lng"), -180, 180);
  const bounds = lat != null && lng != null ? nearbyBounds(lat, lng) : null;

  try {
    const db = createAdminClient();
    const excludeNames = Array.from(new Set([
      ...excludeParam
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    ].filter(Boolean)));
    const excludeSeenSet = new Set(
      excludeSeenParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );

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

    if (bounds) {
      query = query
        .gte("restaurant_lat", bounds.minLat)
        .lte("restaurant_lat", bounds.maxLat)
        .gte("restaurant_lng", bounds.minLng)
        .lte("restaurant_lng", bounds.maxLng);
    }

    if (placeId) query = query.eq("restaurant_id", placeId);
    else if (restaurantName) query = query.eq("restaurant_name", restaurantName);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    // Fetch extra rows so we can filter out excluded names/seen posts and still fill the page.
    const maxFetchLimit = excludeSynthetic || excludeSeenSet.size > 0 ? 500 : 200;
    const fetchLimit = Math.min(
      maxFetchLimit,
      (excludeNames.length + 1) * limit + limit + excludeSeenSet.size + (excludeSynthetic ? 200 : 0)
    );
    const { data: rawRows, error } = await query.limit(fetchLimit);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const excludeSet = new Set(excludeNames);
    const baseFiltered = ((rawRows ?? []) as unknown[])
      .map((r) => normalizeReview(r as Parameters<typeof normalizeReview>[0]))
      .filter((r) => !excludeSet.has(r.reviewer_name))
      .filter((r) => !excludeSynthetic || !/^e2e_/i.test(r.reviewer_name) && !/^e2e\b/i.test(r.restaurant_name));
    const unseenFiltered = excludeSeenSet.size > 0
      ? baseFiltered.filter((r) => !excludeSeenSet.has(r.id))
      : baseFiltered;
    // strictExclude: no fallback to base rows — return empty rather than reintroduce seen posts.
    const filtered = unseenFiltered.length > 0 ? unseenFiltered : (strictExclude ? [] : baseFiltered);

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
