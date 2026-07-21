import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";
import { mobileApiJson, mobileOptions } from "@/lib/server/api-security";
import { normalizeReview } from "@/lib/server/normalize-review";
import { buildFeedAssemblyMaps } from "@/lib/server/feed-assembly";
import {
  resolveHomeMediaAccess,
  resolvePostMediaAccess,
  type HomeMediaCoverDto,
  type PostMediaDto
} from "@/lib/server/post-media-access";
import { parseCircleFeedCursor, serializeCircleFeedCursor } from "@/lib/circle-feed";
import type { Review } from "@/lib/types";
import { canActorReadPost } from "@/lib/server/review-access";

type PublicFeedPayload = {
  hasMore?: boolean;
  nextCursor?: { createdAt: string; id: string } | null;
  reviews?: unknown[];
  viewerName?: string;
};

const METHODS = ["GET"];

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}

function parseLimit(raw: string | null) {
  const value = Number(raw ?? 24);
  return Math.min(Math.max(Number.isFinite(value) ? Math.floor(value) : 24, 1), 50);
}

function uuidOrNull(value: string | null) {
  const normalized = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function initialsForName(name: string) {
  return name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function mediaForReview(review: Review, mediaByAssetId: Map<string, PostMediaDto>) {
  return (review.media_items ?? []).flatMap((item, index) => {
    const authorised = item.media_asset_id ? mediaByAssetId.get(item.media_asset_id) : null;
    if (item.media_asset_id && !authorised) return [];
    return [{
      accessClass: authorised?.accessClass ?? "legacy_public",
      aspectRatio: authorised?.aspectRatio ?? null,
      expiresAt: authorised?.expiresAt ?? null,
      height: authorised?.height ?? item.height ?? null,
      mediaAssetId: item.media_asset_id ?? null,
      mediaType: authorised?.mediaType ?? item.media_type,
      placeholder: authorised?.placeholder ?? null,
      posterUrl: authorised?.posterUrl ?? item.poster_url ?? null,
      position: authorised?.position ?? item.position ?? index,
      publicUrl: authorised?.displayUrl ?? item.public_url,
      thumbnailUrl: authorised?.thumbnailUrl ?? item.thumbnail_url ?? null,
      width: authorised?.width ?? item.width ?? null,
    }];
  });
}

function compactProfileMediaForReview(
  review: Review,
  mediaByAssetId: Map<string, HomeMediaCoverDto>
) {
  const cover = review.media_items?.[0];
  if (!cover) return [];
  const authorised = cover.media_asset_id ? mediaByAssetId.get(cover.media_asset_id) : null;
  const legacyUrl = !cover.media_asset_id ? cover.public_url : null;
  if (!authorised && !legacyUrl) return [];

  const mediaType = authorised?.mediaType ?? (cover.media_type === "video" ? "video" : "image");
  const legacyVersion = legacyUrl
    ? createHash("sha256").update(legacyUrl).digest("hex").slice(0, 16)
    : null;
  const expiresAt = authorised?.expiresAt ?? null;
  const feedUrl = authorised?.feedUrl ?? (mediaType === "image" ? legacyUrl : null);
  const posterUrl = authorised?.posterUrl ?? (mediaType === "video" ? cover.poster_url ?? legacyUrl : null);
  const playbackUrl = authorised?.playbackUrl ?? (mediaType === "video" ? legacyUrl : null);
  const height = authorised?.height ?? cover.height ?? 450;
  const width = authorised?.width ?? cover.width ?? 360;

  return [{
    accessClass: review.visibility === "circle"
      ? "circle_post"
      : review.visibility === "me"
        ? "private_post"
        : "public_post",
    aspectRatio: width / height,
    cacheRevision: authorised?.cacheRevision ?? 1,
    expiresAt,
    feedExpiresAt: mediaType === "image" ? expiresAt : null,
    feedUrl,
    height,
    homeDelivery: true,
    homeDerivativeKind: authorised?.deliveryDerivative ?? "legacy",
    isLegacyHomeMedia: !authorised,
    mediaAssetId: authorised?.mediaAssetId ?? `legacy:${review.id}:${cover.position ?? 0}:${legacyVersion}`,
    mediaType,
    placeholder: authorised?.placeholder ?? cover.placeholder ?? null,
    playbackExpiresAt: mediaType === "video" ? expiresAt : null,
    playbackUrl,
    posterExpiresAt: mediaType === "video" ? expiresAt : null,
    posterUrl,
    position: 0,
    publicUrl: feedUrl ?? posterUrl ?? playbackUrl ?? "",
    thumbnailExpiresAt: authorised?.thumbnailExpiresAt ?? null,
    thumbnailUrl: authorised?.thumbnailUrl ?? cover.thumbnail_url ?? null,
    width
  }];
}

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") ?? "public";
  if (!new Set(["public", "restaurant", "dish", "detail", "profile"]).has(scope)) {
    return mobileApiJson(req, METHODS, { error: "Invalid feed scope" }, { status: 400 });
  }
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = parseCircleFeedCursor(rawCursor);
  if (rawCursor && !cursor) return mobileApiJson(req, METHODS, { error: "Invalid cursor" }, { status: 400 });

  const { actor } = await getRouteActor(req).catch(() => ({ actor: null }));
  const db = createAdminClient();
  const postId = uuidOrNull(req.nextUrl.searchParams.get("postId"));
  if (scope === "detail") {
    if (!postId) return mobileApiJson(req, METHODS, { error: "postId is required" }, { status: 400 });
    const access = await canActorReadPost(db, postId, actor?.actorName ?? "");
    if (!access.allowed) return mobileApiJson(req, METHODS, { error: access.error }, { status: access.status });
  }
  const { data, error } = await db.rpc("mobile_public_feed_page_v1", {
    p_canonical_dish_id: uuidOrNull(req.nextUrl.searchParams.get("canonicalDishId")),
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_dish_normalized_name: req.nextUrl.searchParams.get("dishName")?.trim().toLowerCase() || null,
    p_limit: parseLimit(req.nextUrl.searchParams.get("limit")),
    p_place_id: req.nextUrl.searchParams.get("placeId")?.trim() || null,
    p_post_id: postId,
    p_profile_name: req.nextUrl.searchParams.get("profileName")?.trim() || null,
    p_restaurant_address: req.nextUrl.searchParams.get("restaurantAddress")?.trim() || null,
    p_restaurant_name: req.nextUrl.searchParams.get("restaurantName")?.trim() || null,
    p_scope: scope,
    p_viewer_user_id: actor?.userId ?? null,
  });
  if (error) {
    console.error("[mobile/feed] canonical RPC failed:", error.message);
    return mobileApiJson(req, METHODS, { error: "Mobile feed deployment contract unavailable" }, { status: 503 });
  }

  const payload = (data ?? {}) as PublicFeedPayload;
  const reviews = (payload.reviews ?? []).map((row) => normalizeReview(row as Parameters<typeof normalizeReview>[0]));
  const maps = await buildFeedAssemblyMaps(db, reviews, {
    includeTasteTrust: true,
    viewerName: actor?.actorName ?? null,
    viewerUserId: actor?.userId ?? null,
  });
  const useCompactProfileMedia = scope === "profile" && Boolean(actor?.userId);
  const mediaAssetIds = reviews.flatMap((review) => {
    const items = useCompactProfileMedia ? (review.media_items ?? []).slice(0, 1) : review.media_items ?? [];
    return items.flatMap((item) => item.media_asset_id ? [item.media_asset_id] : []);
  });
  const profileMediaByAssetId = useCompactProfileMedia
    ? new Map((await resolveHomeMediaAccess(db, mediaAssetIds, actor?.userId ?? "", undefined, undefined, {
      includeCoverThumbnail: true
    }) as HomeMediaCoverDto[]).map((item) => [item.mediaAssetId, item]))
    : new Map<string, HomeMediaCoverDto>();
  const mediaByAssetId = useCompactProfileMedia
    ? new Map<string, PostMediaDto>()
    : new Map((await resolvePostMediaAccess(db, mediaAssetIds, actor?.actorName ?? "")).map((item) => [item.id, item]));

  const posts = reviews.map((review) => {
    const authorName = maps.profileMap[review.reviewer_name] ?? review.reviewer_name;
    const summary = maps.tasteTrustSummaryMap[review.id];
    return {
      id: review.id,
      reviewerName: review.reviewer_name,
      reviewerUsername: review.reviewer_name,
      authorName,
      authorInitials: initialsForName(authorName),
      restaurantId: review.restaurant_id,
      restaurantName: review.restaurant_name,
      area: review.area,
      restaurantAddress: review.restaurant_address,
      restaurantLat: review.restaurant_lat,
      restaurantLng: review.restaurant_lng,
      restaurantPrimaryType: (review as Review & { restaurant_primary_type?: string | null }).restaurant_primary_type ?? null,
      restaurantTypes: (review as Review & { restaurant_types?: string[] | null }).restaurant_types ?? [],
      items: review.items ?? [],
      body: review.body,
      tags: review.tags ?? [],
      media: useCompactProfileMedia
        ? compactProfileMediaForReview(review, profileMediaByAssetId)
        : mediaForReview(review, mediaByAssetId),
      mediaCount: useCompactProfileMedia
        ? Math.max(review.media_count ?? review.media_items?.length ?? 0, review.media_items?.[0] ? 1 : 0)
        : undefined,
      visibility: review.visibility === "circle" || review.visibility === "me" ? review.visibility : "public",
      status: review.status ?? "active",
      createdAt: review.created_at,
      likeCount: maps.likeCountMap[review.id] ?? 0,
      commentCount: maps.commentMap[review.id]?.count ?? 0,
      likedByMe: maps.likedByMeMap[review.id] ?? false,
      bookmarkedByMe: maps.bookmarkedPostMap[review.id] ?? false,
      foodReaction: maps.foodReactionMap[review.id] ?? null,
      mustTryCount: summary?.feedback_counts.Helpful ?? 0,
      notWorthItCount: summary?.feedback_counts.Disagree ?? 0,
    };
  }).filter((post) => !useCompactProfileMedia || post.media.length === 1);

  return mobileApiJson(req, METHODS, {
    hasMore: Boolean(payload.hasMore),
    nextCursor: serializeCircleFeedCursor(payload.nextCursor),
    posts,
    viewerName: actor?.actorName ?? payload.viewerName ?? "",
  });
}
