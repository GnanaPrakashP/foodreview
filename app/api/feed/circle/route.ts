import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { parseCircleFeedCursor, serializeCircleFeedCursor } from "@/lib/circle-feed";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PostEngagementState } from "@/lib/server/post-engagement-state";
import type { Review } from "@/lib/types";
import { resolveHomeMediaAccess, type HomeMediaCoverDto } from "@/lib/server/post-media-access";
import { loadCanonicalCircleFeedPage, type CanonicalCircleFeedPage } from "@/lib/server/canonical-circle-feed";
import { beginRequestPerformanceTrace, tracedJson } from "@/lib/server/request-performance";

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
  const trace = beginRequestPerformanceTrace(req, "api.feed.circle");
  const { actor } = await getRouteActor(req);
  if (!actor) return tracedJson(trace, { error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(
    Math.max(Math.floor(parseNumber(req.nextUrl.searchParams.get("limit"), CIRCLE_FEED_PAGE_SIZE)), 1),
    CIRCLE_FEED_PAGE_SIZE
  );
  const refreshMode = req.nextUrl.searchParams.get("refresh") === "1";
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCircleFeedCursor(rawCursor);
  const excludePostIds = parseCsvIds(req.nextUrl.searchParams.get("excludeSeen"));

  if (rawCursor && !cursor) {
    return tracedJson(trace, { error: "Invalid cursor" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const page = await loadCanonicalCircleFeedPage(admin, actor, {
      cursor,
      limit,
      excludePostIds,
      bypassCache: refreshMode && !cursor,
      trace,
    });
    if (!page.myName) {
      return tracedJson(trace, { error: "Unauthorized" }, { status: 401 });
    }
    const mediaAssetIds = page.reviews.flatMap((review) => {
      const cover = review.media_items?.[0];
      return cover?.media_asset_id ? [cover.media_asset_id] : [];
    });
    const engagementByPostId = buildPageEngagementStates(page);
    const accountTypeByReviewer = new Map(Object.entries(page.accountTypeMap));
    const requestStatusByReviewer = new Map(Object.entries(page.requestStatusMap));
    const authorisedMedia = await trace.measure(
      "media",
      "feed.media_authorization",
      () => resolveHomeMediaAccess(admin, mediaAssetIds, actor.userId, trace, undefined, {
        includeCoverThumbnail: true
      })
    );
    const mediaByAssetId = new Map((authorisedMedia as HomeMediaCoverDto[]).map((item) => [item.mediaAssetId, item]));
    const responseBody = await trace.measure("assembly", "feed.response_assembly", () => ({
      nextCursor: serializeCircleFeedCursor(page.nextCursor),
      posts: page.reviews.map((review) => reviewPostFromReview(
        review,
        page,
        engagementByPostId.get(review.id),
        requestStatusByReviewer,
        accountTypeByReviewer,
        mediaByAssetId
      )).filter((post) => {
        if (post.coverMedia && post.mediaCount > 0) return true;
        console.warn("[feed/circle] excluded published post with invalid media", { postId: post.id });
        return false;
      }),
      viewerName: page.myName
    }));
    return tracedJson(trace, responseBody);
  } catch (error) {
    console.error("[feed/circle] failed to load page:", error);
    return tracedJson(trace, { error: "Unable to load feed" }, { status: 500 });
  }
}

function reviewPostFromReview(
  review: Review,
  page: CanonicalCircleFeedPage,
  engagement: PostEngagementState | undefined,
  requestStatusByReviewer: Map<string, CirclePostRequestStatus>,
  accountTypeByReviewer: Map<string, "public" | "private">,
  mediaByAssetId: Map<string, HomeMediaCoverDto>
) {
  const displayName = page.profileMap[review.reviewer_name] ?? review.reviewer_name;
  const authorAvatar = page.authorAvatarMap[review.reviewer_name] ?? null;
  const isPublicDiscovery = review.reviewer_name !== page.myName && !page.joinedCircles.includes(review.reviewer_name);
  const cover = review.media_items?.[0];
  const authorisedCover = cover?.media_asset_id ? mediaByAssetId.get(cover.media_asset_id) : null;
  const legacyCoverUrl = !cover?.media_asset_id ? cover?.public_url ?? null : null;
  const mediaType = authorisedCover?.mediaType ?? (cover?.media_type === "video" ? "video" : "image");
  const legacyVersion = legacyCoverUrl
    ? createHash("sha256").update(legacyCoverUrl).digest("hex").slice(0, 16)
    : null;
  const coverMedia = authorisedCover || legacyCoverUrl ? {
    cacheRevision: authorisedCover?.cacheRevision ?? 1,
    deliveryDerivative: authorisedCover?.deliveryDerivative ?? "legacy",
    feedUrl: authorisedCover?.feedUrl ?? (mediaType === "image" ? legacyCoverUrl : null),
    expiresAt: authorisedCover?.expiresAt ?? null,
    height: authorisedCover?.height ?? cover?.height ?? 450,
    isLegacy: !authorisedCover,
    mediaAssetId: authorisedCover?.mediaAssetId ?? cover?.media_asset_id ?? `legacy:${review.id}:${cover?.position ?? 0}:${legacyVersion}`,
    mediaType,
    placeholder: authorisedCover?.placeholder ?? cover?.placeholder ?? null,
    playbackUrl: authorisedCover?.playbackUrl ?? (mediaType === "video" ? legacyCoverUrl : null),
    posterUrl: authorisedCover?.posterUrl ?? (mediaType === "video" ? cover?.poster_url ?? legacyCoverUrl : null),
    thumbnailExpiresAt: authorisedCover?.thumbnailExpiresAt ?? null,
    thumbnailUrl: authorisedCover?.thumbnailUrl ?? null,
    width: authorisedCover?.width ?? cover?.width ?? 360
  } : null;
  const mediaCount = Math.max(review.media_count ?? review.media_items?.length ?? 0, coverMedia ? 1 : 0);
  const summary = page.tasteTrustSummaryMap[review.id];
  return {
    id: review.id,
    reviewerUsername: review.reviewer_name,
    authorName: displayName,
    authorInitials: initialsForName(displayName),
    authorProfileId: authorAvatar?.profileId ?? null,
    avatarMediaAssetId: authorAvatar?.avatarMediaAssetId ?? null,
    avatarCacheRevision: authorAvatar?.avatarCacheRevision ?? 1,
    avatarThumbnailUrl: authorAvatar?.avatarThumbnailUrl ?? null,
    avatarPlaceholder: authorAvatar?.avatarPlaceholder ?? null,
    restaurantId: review.restaurant_id,
    restaurantName: review.restaurant_name,
    area: review.area,
    restaurantAddress: review.restaurant_address,
    restaurantLat: review.restaurant_lat,
    restaurantLng: review.restaurant_lng,
    items: (review.items ?? []).map((item) => ({ name: item.name, rating: item.rating })),
    body: review.body,
    tags: review.tags ?? [],
    updatedAt: review.updated_at,
    mediaCount,
    coverMedia,
    visibility: review.visibility === "circle" || review.visibility === "me" ? review.visibility : "public",
    createdAt: review.created_at,
    likeCount: engagement?.likeCount ?? page.likeCountMap[review.id] ?? 0,
    commentCount: engagement?.commentCount ?? page.commentMap[review.id]?.count ?? 0,
    likedByMe: engagement?.likedByMe ?? page.likedByMeMap[review.id] ?? false,
    bookmarkedByMe: engagement?.bookmarkedByMe ?? page.bookmarkedPostMap[review.id] ?? false,
    isPublicDiscovery,
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
