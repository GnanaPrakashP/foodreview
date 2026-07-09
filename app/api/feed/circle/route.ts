import { NextRequest, NextResponse } from "next/server";
import { getCircleFeedPage, parseCircleFeedCursor, serializeCircleFeedCursor } from "@/lib/circle-feed";
import { CIRCLE_FEED_PAGE_SIZE } from "@/lib/feed-config";
import { createRouteSupabase } from "@/lib/server/route-supabase";
import { getAccountTypesForNames } from "@/lib/circle-db";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FoodReactionState, PostEngagementState } from "@/lib/server/post-engagement-state";
import { displayFeedbackLabelForLabel } from "@/lib/taste-trust";
import type { Review } from "@/lib/types";

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
  const supabase = await createRouteSupabase(req);
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
    const admin = createAdminClient();
    const [engagementByPostId, accountTypeByReviewer, requestStatusByReviewer] = await Promise.all([
      buildPageEngagementStates(admin, page),
      buildReviewerAccountTypeMap(admin, page),
      buildCircleRequestStatusMap(admin, page),
    ]);
    return NextResponse.json({
      ...page,
      nextCursorString: serializeCircleFeedCursor(page.nextCursor),
      posts: page.reviews.map((review) => {
        const engagement = engagementByPostId.get(review.id);
        return {
          ...reviewPostFromReview(review, page, engagement, requestStatusByReviewer, accountTypeByReviewer),
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
  page: Awaited<ReturnType<typeof getCircleFeedPage>>,
  engagement: PostEngagementState | undefined,
  requestStatusByReviewer: Map<string, CirclePostRequestStatus>,
  accountTypeByReviewer: Map<string, "public" | "private">
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
    media: (review.media_items ?? []).map((item, index) => ({
      publicUrl: item.public_url,
      mediaType: item.media_type === "video" ? "video" : "image",
      position: item.position ?? index,
    })),
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

async function buildReviewerAccountTypeMap(
  db: ReturnType<typeof createAdminClient>,
  page: Awaited<ReturnType<typeof getCircleFeedPage>>
): Promise<Map<string, "public" | "private">> {
  const reviewerNames = Array.from(new Set(page.reviews.map((review) => review.reviewer_name).filter(Boolean)));
  const accountTypes = await getAccountTypesForNames(db, reviewerNames);
  return new Map(Object.entries(accountTypes).map(([name, accountType]) => [name, accountType === "private" ? "private" : "public"]));
}

async function buildCircleRequestStatusMap(
  db: ReturnType<typeof createAdminClient>,
  page: Awaited<ReturnType<typeof getCircleFeedPage>>
): Promise<Map<string, CirclePostRequestStatus>> {
  const statuses = new Map<string, CirclePostRequestStatus>();
  const joined = new Set(page.joinedCircles);
  const candidates = Array.from(
    new Set(
      page.reviews
        .map((review) => review.reviewer_name)
        .filter((name) => name && name !== page.myName)
    )
  );

  for (const reviewerName of candidates) {
    statuses.set(reviewerName, joined.has(reviewerName) ? "joined" : "idle");
  }

  const requestableNames = candidates.filter((name) => !joined.has(name));
  if (!page.myName || requestableNames.length === 0) return statuses;

  const { data, error } = await db
    .from("circle_requests")
    .select("receiver_name, status")
    .eq("sender_name", page.myName)
    .in("receiver_name", requestableNames);

  if (error) {
    console.error("[feed/circle] failed to load circle request statuses:", error.message);
    return statuses;
  }

  for (const row of (data ?? []) as Array<{ receiver_name?: string | null; status?: string | null }>) {
    if (!row.receiver_name) continue;
    if (row.status === "pending") statuses.set(row.receiver_name, "pending");
    if (row.status === "accepted") statuses.set(row.receiver_name, "joined");
  }

  return statuses;
}

function foodReactionForLabel(value: unknown): FoodReactionState {
  const label = displayFeedbackLabelForLabel(value);
  if (label === "Helpful") return "MUST_TRY";
  if (label === "Disagree") return "NOT_WORTH_IT";
  return null;
}

async function buildPageEngagementStates(
  db: ReturnType<typeof createAdminClient>,
  page: Awaited<ReturnType<typeof getCircleFeedPage>>
): Promise<Map<string, PostEngagementState>> {
  const postIds = page.reviews.map((review) => review.id).filter(Boolean);
  const myFeedbackByPostId = new Map<string, FoodReactionState>();

  if (page.viewerUserId && postIds.length > 0) {
    const { data, error } = await db
      .from("recommendation_feedback")
      .select("post_id, feedback_label")
      .eq("feedback_user_id", page.viewerUserId)
      .in("post_id", postIds);

    if (error) {
      console.error("[feed/circle] failed to load viewer feedback:", error.message);
    } else {
      for (const row of (data ?? []) as Array<{ feedback_label?: string | null; post_id?: string | null }>) {
        if (row.post_id) myFeedbackByPostId.set(row.post_id, foodReactionForLabel(row.feedback_label));
      }
    }
  }

  return new Map(page.reviews.map((review) => {
    const summary = page.tasteTrustSummaryMap[review.id];
    const state: PostEngagementState = {
      postId: review.id,
      likedByMe: page.likedByMeMap[review.id] ?? false,
      likeCount: page.likeCountMap[review.id] ?? 0,
      bookmarkedByMe: page.bookmarkedPostMap[review.id] ?? false,
      commentCount: page.commentMap[review.id]?.count ?? 0,
      foodReaction: myFeedbackByPostId.get(review.id) ?? null,
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
