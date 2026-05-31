import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";
import { normalizeReview } from "@/lib/server/normalize-review";
import { canActorReadPost } from "@/lib/server/review-access";
import type { Review } from "@/lib/types";

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

type LikeRow = { post_id: string; user_name: string };
type WishlistRow = { post_id: string | null; restaurant_name: string };
type FeedbackRow = { post_id: string; feedback_value: number };
type TriedRow = { source_post_id: string | null; place_id: string | null; dish_id: string | null; created_at: string };
type CircleRow = { member_name: string };

type CandidateGroup = {
  key: string;
  dishName: string;
  placeName: string;
  placeId: string | null;
  postId: string;
  imageUrl: string | null;
  distanceKm: number | null;
  reviewers: Set<string>;
  circleReviewers: Set<string>;
  postIds: Set<string>;
  latestCreatedAt: string;
  likeCount: number;
  saveCount: number;
  positiveFeedback: number;
  totalFeedback: number;
  triedAt: string | null;
  saved: boolean;
  score: number;
};

function parseCoordinate(value: string | null, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function nearbyBounds(lat: number, lng: number, radiusKm = 35) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLng: lng - lngDelta, maxLng: lng + lngDelta };
}

function distanceKm(fromLat: number | null, fromLng: number | null, toLat: number | null, toLng: number | null) {
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) return null;
  const earthKm = 6371;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function slug(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pairKey(dishName: string, review: Review) {
  const placeKey = review.restaurant_id?.trim() || slug(review.restaurant_name);
  return `${slug(dishName)}::${placeKey}`;
}

function dishFromItem(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const name = (item as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function itemRating(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const rating = Number((item as { rating?: unknown }).rating);
  return Number.isFinite(rating) ? rating : null;
}

function firstImage(review: Review) {
  return review.media_items?.find((item) => item.media_type === "image")?.public_url
    ?? review.photo_urls?.[0]
    ?? review.photo_url
    ?? null;
}

function reasonFor(group: CandidateGroup) {
  const positiveRatio = group.totalFeedback > 0 ? group.positiveFeedback / group.totalFeedback : null;
  if (group.triedAt) return "Already marked tried";
  if (group.circleReviewers.size > 0) {
    return `Loved by ${group.circleReviewers.size} ${group.circleReviewers.size === 1 ? "person" : "people"} in your circle`;
  }
  if (group.saveCount >= 3) return "Highly saved near you";
  if (positiveRatio != null && positiveRatio >= 0.8) return `${Math.round(positiveRatio * 100)}% positive feedback`;
  const ageMs = Date.now() - new Date(group.latestCreatedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs <= 7 * 24 * 60 * 60 * 1000) return "Trending this week";
  return "Popular nearby and you haven't tried it yet";
}

function buildScore(group: CandidateGroup) {
  const positiveRatio = group.totalFeedback > 0 ? group.positiveFeedback / group.totalFeedback : 0.75;
  const ageDays = Math.max(0, (Date.now() - new Date(group.latestCreatedAt).getTime()) / (24 * 60 * 60 * 1000));
  const freshnessBonus = Math.max(0, 10 - ageDays) * 1.2;
  const distanceBonus = group.distanceKm == null ? 0 : Math.max(0, 20 - group.distanceKm) * 1.6;
  const triedPenalty = group.triedAt ? 120 : 0;
  return (
    group.circleReviewers.size * 45 +
    group.reviewers.size * 8 +
    group.likeCount * 3 +
    group.saveCount * 5 +
    positiveRatio * 18 +
    freshnessBonus +
    distanceBonus -
    triedPenalty
  );
}

async function loadReviews(db: { from: (table: string) => any }, circleMembers: string[], lat: number | null, lng: number | null) {
  const bounds = lat != null && lng != null ? nearbyBounds(lat, lng) : null;
  const applyReviewFilters = (query: any) => {
    let next = query
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(300);
    if (bounds) {
      next = next
        .gte("restaurant_lat", bounds.minLat)
        .lte("restaurant_lat", bounds.maxLat)
        .gte("restaurant_lng", bounds.minLng)
        .lte("restaurant_lng", bounds.maxLng);
    }
    return next;
  };

  const publicQuery = applyReviewFilters(db.from("reviews").select(REVIEW_SELECT).eq("visibility", "public"));
  const circleQuery = circleMembers.length > 0
    ? applyReviewFilters(db.from("reviews").select(REVIEW_SELECT).eq("visibility", "circle").in("reviewer_name", circleMembers))
    : Promise.resolve({ data: [], error: null });

  const [publicResult, circleResult] = await Promise.all([publicQuery, circleQuery]);
  if (publicResult.error) throw new Error(publicResult.error.message);
  if (circleResult.error) throw new Error(circleResult.error.message);

  const byId = new Map<string, Review>();
  for (const row of [...(publicResult.data ?? []), ...(circleResult.data ?? [])]) {
    const review = normalizeReview(row as Parameters<typeof normalizeReview>[0]);
    if (review.items?.length && review.reviewer_name) byId.set(review.id, review);
  }
  return Array.from(byId.values());
}

async function loadCircleMembers(db: { from: (table: string) => any }, actorName: string | null) {
  if (!actorName) return [];
  const { data, error } = await db
    .from("circle_memberships")
    .select("member_name")
    .eq("user_name", actorName);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CircleRow[]).map((row) => row.member_name).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const lat = parseCoordinate(req.nextUrl.searchParams.get("lat"), -90, 90);
  const lng = parseCoordinate(req.nextUrl.searchParams.get("lng"), -180, 180);

  try {
    const { actor } = await getRouteActor();
    const db = createAdminClient();
    const circleMembers = await loadCircleMembers(db, actor?.actorName ?? null);
    const circleSet = new Set(circleMembers);
    const reviews = await loadReviews(db, circleMembers, lat, lng);
    const postIds = reviews.map((review) => review.id);
    const restaurantNames = Array.from(new Set(reviews.map((review) => review.restaurant_name).filter(Boolean)));

    const [likesResult, postWishlistResult, placeWishlistResult, feedbackResult, triedResult] = postIds.length > 0
      ? await Promise.all([
          db.from("likes").select("post_id, user_name").in("post_id", postIds),
          db.from("wishlist").select("post_id, restaurant_name").in("post_id", postIds),
          restaurantNames.length > 0
            ? db.from("wishlist").select("post_id, restaurant_name").is("post_id", null).in("restaurant_name", restaurantNames)
            : Promise.resolve({ data: [], error: null }),
          db.from("recommendation_feedback").select("post_id, feedback_value").in("post_id", postIds),
          actor
            ? db.from("user_tried_items").select("source_post_id, place_id, dish_id, created_at").eq("user_id", actor.userId)
            : Promise.resolve({ data: [], error: null }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

    for (const result of [likesResult, postWishlistResult, placeWishlistResult, feedbackResult, triedResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const likeCounts = new Map<string, number>();
    for (const like of (likesResult.data ?? []) as LikeRow[]) {
      likeCounts.set(like.post_id, (likeCounts.get(like.post_id) ?? 0) + 1);
    }

    const postSaveCounts = new Map<string, number>();
    const placeSaveCounts = new Map<string, number>();
    const mySavedPosts = new Set<string>();
    for (const save of ([...(postWishlistResult.data ?? []), ...(placeWishlistResult.data ?? [])]) as WishlistRow[]) {
      if (save.post_id) {
        postSaveCounts.set(save.post_id, (postSaveCounts.get(save.post_id) ?? 0) + 1);
      } else if (save.restaurant_name) {
        placeSaveCounts.set(save.restaurant_name, (placeSaveCounts.get(save.restaurant_name) ?? 0) + 1);
      }
    }

    if (actor && postIds.length > 0) {
      const { data: myWishlist, error } = await db
        .from("wishlist")
        .select("post_id")
        .eq("user_name", actor.actorName)
        .in("post_id", postIds);
      if (error) throw new Error(error.message);
      for (const save of (myWishlist ?? []) as { post_id: string | null }[]) {
        if (save.post_id) mySavedPosts.add(save.post_id);
      }
    }

    const feedbackByPost = new Map<string, { total: number; positive: number; negative: number }>();
    for (const feedback of (feedbackResult.data ?? []) as FeedbackRow[]) {
      const current = feedbackByPost.get(feedback.post_id) ?? { total: 0, positive: 0, negative: 0 };
      current.total++;
      if (feedback.feedback_value >= 0.7) current.positive++;
      if (feedback.feedback_value < 0) current.negative++;
      feedbackByPost.set(feedback.post_id, current);
    }

    const triedByPost = new Map<string, string>();
    const triedByPair = new Map<string, string>();
    for (const tried of (triedResult.data ?? []) as TriedRow[]) {
      if (tried.source_post_id) triedByPost.set(tried.source_post_id, tried.created_at);
      if (tried.place_id && tried.dish_id) triedByPair.set(`${slug(tried.dish_id)}::${tried.place_id}`, tried.created_at);
    }

    const groups = new Map<string, CandidateGroup>();
    for (const review of reviews) {
      if (actor?.actorName && review.reviewer_name === actor.actorName) continue;

      for (const item of review.items ?? []) {
        const dishName = dishFromItem(item);
        if (!dishName) continue;
        const rating = itemRating(item);
        if (rating != null && rating < 3) continue;

        const key = pairKey(dishName, review);
        const existing = groups.get(key);
        const imageUrl = firstImage(review);
        const reviewDistance = distanceKm(lat, lng, review.restaurant_lat, review.restaurant_lng);
        const feedback = feedbackByPost.get(review.id);
        const triedAt = triedByPost.get(review.id) ?? triedByPair.get(key) ?? null;

        if (!existing) {
          groups.set(key, {
            key,
            dishName,
            placeName: review.restaurant_name,
            placeId: review.restaurant_id,
            postId: review.id,
            imageUrl,
            distanceKm: reviewDistance,
            reviewers: new Set([review.reviewer_name]),
            circleReviewers: circleSet.has(review.reviewer_name) ? new Set([review.reviewer_name]) : new Set(),
            postIds: new Set([review.id]),
            latestCreatedAt: review.created_at,
            likeCount: likeCounts.get(review.id) ?? 0,
            saveCount: (postSaveCounts.get(review.id) ?? 0) + (placeSaveCounts.get(review.restaurant_name) ?? 0),
            positiveFeedback: feedback?.positive ?? 0,
            totalFeedback: feedback?.total ?? 0,
            triedAt,
            saved: mySavedPosts.has(review.id),
            score: 0,
          });
          continue;
        }

        existing.reviewers.add(review.reviewer_name);
        if (circleSet.has(review.reviewer_name)) existing.circleReviewers.add(review.reviewer_name);
        existing.postIds.add(review.id);
        existing.likeCount += likeCounts.get(review.id) ?? 0;
        existing.saveCount += (postSaveCounts.get(review.id) ?? 0) + (placeSaveCounts.get(review.restaurant_name) ?? 0);
        existing.positiveFeedback += feedback?.positive ?? 0;
        existing.totalFeedback += feedback?.total ?? 0;
        existing.saved = existing.saved || mySavedPosts.has(review.id);
        if (!existing.triedAt && triedAt) existing.triedAt = triedAt;
        if (reviewDistance != null && (existing.distanceKm == null || reviewDistance < existing.distanceKm)) {
          existing.distanceKm = reviewDistance;
        }
        if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
        if (new Date(review.created_at).getTime() > new Date(existing.latestCreatedAt).getTime()) {
          existing.latestCreatedAt = review.created_at;
          existing.postId = review.id;
          existing.placeId = review.restaurant_id;
          existing.placeName = review.restaurant_name;
        }
      }
    }

    const items = Array.from(groups.values())
      .filter((group) => {
        if (group.totalFeedback >= 3 && group.positiveFeedback / group.totalFeedback < 0.45) return false;
        return group.reviewers.size > 0;
      })
      .map((group) => {
        group.score = buildScore(group);
        return {
          id: group.key,
          dishName: group.dishName,
          placeName: group.placeName,
          placeId: group.placeId,
          postId: group.postId,
          imageUrl: group.imageUrl,
          distanceKm: group.distanceKm == null ? null : Math.round(group.distanceKm * 10) / 10,
          reason: reasonFor(group),
          score: Math.round(group.score * 10) / 10,
          status: group.triedAt ? "tried" : "not_tried",
          saved: group.saved,
          triedAt: group.triedAt,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    return NextResponse.json({ items, myName: actor?.actorName ?? null });
  } catch (error) {
    console.error("[hungry/must-try] failed:", error);
    return NextResponse.json({ error: "Unable to load must-try items" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  const dishId = typeof body.dishName === "string" ? body.dishName.trim() : "";
  const placeId = typeof body.placeId === "string" && body.placeId.trim() ? body.placeId.trim() : null;

  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });

  const { actor } = await getRouteActor();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const db = createAdminClient();
    const access = await canActorReadPost(db, postId, actor.actorName);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data: review, error: reviewError } = await db
      .from("reviews")
      .select("id, reviewer_name, restaurant_id")
      .eq("id", postId)
      .maybeSingle<{ id: string; reviewer_name: string; restaurant_id: string | null }>();
    if (reviewError || !review) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (review.reviewer_name === actor.actorName) {
      return NextResponse.json({ error: "You cannot mark your own recommendation as tried" }, { status: 403 });
    }

    const { data: reviewerProfile } = await db
      .from("profiles")
      .select("id")
      .eq("username", review.reviewer_name)
      .maybeSingle<{ id: string }>();

    const row = {
      user_id: actor.userId,
      place_id: placeId ?? review.restaurant_id,
      dish_id: dishId || null,
      source_post_id: postId,
      source_user_id: reviewerProfile?.id ?? null,
      visibility: "private",
      tried_status: "tried",
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await db
      .from("user_tried_items")
      .select("id")
      .eq("user_id", actor.userId)
      .eq("source_post_id", postId)
      .maybeSingle<{ id: string }>();
    if (existingError) throw new Error(existingError.message);

    const result = existing?.id
      ? await db.from("user_tried_items").update(row).eq("id", existing.id).select("created_at").single()
      : await db.from("user_tried_items").insert(row).select("created_at").single();
    if (result.error) throw new Error(result.error.message);

    return NextResponse.json({ ok: true, status: "tried", triedAt: result.data?.created_at ?? new Date().toISOString() });
  } catch (error) {
    console.error("[hungry/must-try] failed to mark tried:", error);
    return NextResponse.json({ error: "Unable to mark item tried" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId")?.trim() ?? "";
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });

  const { actor } = await getRouteActor();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const db = createAdminClient();
    const { error } = await db
      .from("user_tried_items")
      .delete()
      .eq("user_id", actor.userId)
      .eq("source_post_id", postId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, status: "not_tried", triedAt: null });
  } catch (error) {
    console.error("[hungry/must-try] failed to unmark tried:", error);
    return NextResponse.json({ error: "Unable to update tried item" }, { status: 500 });
  }
}
