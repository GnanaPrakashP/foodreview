import { NextRequest, NextResponse } from "next/server";
import { parseCircleFeedCursor, serializeCircleFeedCursor } from "@/lib/circle-feed";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PostEngagementState } from "@/lib/server/post-engagement-state";
import type { Review } from "@/lib/types";
import { resolvePostMediaAccess, type PostMediaDto } from "@/lib/server/post-media-access";
import { loadCanonicalCircleFeedPage, type CanonicalCircleFeedPage } from "@/lib/server/canonical-circle-feed";

type CirclePostRequestStatus = "idle" | "pending" | "joined";

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
  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = parseNumber(req.nextUrl.searchParams.get("limit"), CIRCLE_FEED_PAGE_SIZE);
  const refreshMode = req.nextUrl.searchParams.get("refresh") === "1";
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCircleFeedCursor(rawCursor);
  const excludePostIds = parseCsvIds(req.nextUrl.searchParams.get("excludeSeen"));

  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const page = await loadCanonicalCircleFeedPage(admin, actor, {
      cursor,
      limit,
      excludePostIds,
      bypassCache: refreshMode && !cursor,
    });
    if (!page.myName) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const mediaAssetIds = page.reviews.flatMap((review) => (review.media_items ?? []).map((item) => item.media_asset_id).filter((id): id is string => Boolean(id)));
    const engagementByPostId = buildPageEngagementStates(page);
    const accountTypeByReviewer = new Map(Object.entries(page.accountTypeMap));
    const requestStatusByReviewer = new Map(Object.entries(page.requestStatusMap));
    const authorisedMedia = await resolvePostMediaAccess(admin, mediaAssetIds, page.myName);
    const mediaByAssetId = new Map(authorisedMedia.map((item) => [item.id, item]));
    return NextResponse.json({
      ...page,
      nextCursorString: serializeCircleFeedCursor(page.nextCursor),
      posts: page.reviews.map((review) => {
        const engagement = engagementByPostId.get(review.id);
        return {
          ...reviewPostFromReview(review, page, engagement, requestStatusByReviewer, accountTypeByReviewer, mediaByAssetId),
          engagement,
        };
      }),
    });
  } catch (error) {
    console.error("[feed/circle] failed to load page:", error);
    return NextResponse.json({ error: "Unable to load feed" }, { status: 500 });
  }
}

function reviewPostFromReview(
  review: Review,
  page: CanonicalCircleFeedPage,
  engagement: PostEngagementState | undefined,
  requestStatusByReviewer: Map<string, CirclePostRequestStatus>,
  accountTypeByReviewer: Map<string, "public" | "private">,
  mediaByAssetId: Map<string, PostMediaDto>
) {
  const displayName = page.profileMap[review.reviewer_name] ?? review.reviewer_name;
  const context = review.reviewer_name === page.myName
    ? "your post"
    : page.joinedCircles.includes(review.reviewer_name)
      ? "from your circle"
      : "suggested by CircleBites";
  const summary = page.tasteTrustSummaryMap[review.id];
  return {
    id: review.id,
    reviewerName: review.reviewer_name,
    reviewerUsername: review.reviewer_name,
    authorName: displayName,
    authorInitials: initialsForName(displayName),
    restaurantId: review.restaurant_id,
    restaurantName: review.restaurant_name,
    area: review.area,
    restaurantAddress: review.restaurant_address,
    restaurantLat: review.restaurant_lat,
    restaurantLng: review.restaurant_lng,
    items: review.items ?? [],
    body: review.body,
    tags: review.tags ?? [],
    media: (review.media_items ?? []).flatMap((item, index) => {
      const authorised = item.media_asset_id ? mediaByAssetId.get(item.media_asset_id) : null;
      if (item.media_asset_id && !authorised) return [];
      return [{
        accessClass: authorised?.accessClass ?? "legacy_public",
        aspectRatio: authorised?.aspectRatio ?? null,
        expiresAt: authorised?.expiresAt ?? null,
        mediaAssetId: item.media_asset_id ?? null,
        mediaType: authorised?.mediaType ?? (item.media_type === "video" ? "video" : "image"),
        placeholder: authorised?.placeholder ?? null,
        posterUrl: authorised?.posterUrl ?? null,
        position: authorised?.position ?? item.position ?? index,
        publicUrl: authorised?.displayUrl ?? item.public_url,
        thumbnailUrl: authorised?.thumbnailUrl ?? null,
      }];
    }),
    visibility: review.visibility === "circle" || review.visibility === "me" ? review.visibility : "public",
    status: review.status ?? "active",
    createdAt: review.created_at,
    likeCount: engagement?.likeCount ?? page.likeCountMap[review.id] ?? 0,
    commentCount: engagement?.commentCount ?? page.commentMap[review.id]?.count ?? 0,
    likedByMe: engagement?.likedByMe ?? page.likedByMeMap[review.id] ?? false,
    bookmarkedByMe: engagement?.bookmarkedByMe ?? page.bookmarkedPostMap[review.id] ?? false,
    feedContextLabel: context,
    feedSectionLabel: context === "suggested by CircleBites" ? "Suggested for you" : "Circles you're in",
    isPublicDiscovery: context === "suggested by CircleBites",
    circleRequestAccountType: accountTypeByReviewer.get(review.reviewer_name) ?? null,
    circleRequestStatus: requestStatusByReviewer.get(review.reviewer_name) ?? "idle",
    foodReaction: engagement?.foodReaction ?? null,
    mustTryCount: engagement?.mustTryCount ?? summary?.feedback_counts?.Helpful ?? 0,
    notWorthItCount: engagement?.notWorthItCount ?? summary?.feedback_counts?.Disagree ?? 0,
  };
}

function buildPageEngagementStates(page: CanonicalCircleFeedPage): Map<string, PostEngagementState> {
  return new Map(page.reviews.map((review) => {
    const summary = page.tasteTrustSummaryMap[review.id];
    const state: PostEngagementState = {
      postId: review.id,
      likedByMe: page.likedByMeMap[review.id] ?? false,
      likeCount: page.likeCountMap[review.id] ?? 0,
      bookmarkedByMe: page.bookmarkedPostMap[review.id] ?? false,
      commentCount: page.commentMap[review.id]?.count ?? 0,
      foodReaction: page.foodReactionMap[review.id] ?? null,
      mustTryCount: summary?.feedback_counts?.Helpful ?? 0,
      notWorthItCount: summary?.feedback_counts?.Disagree ?? 0,
    };
    return [review.id, state] as const;
  }));
}

function initialsForName(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}
