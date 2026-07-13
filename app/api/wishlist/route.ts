import { after, NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { canActorReadPost } from "@/lib/server/review-access";
import { recalculateUserReputation } from "@/lib/server/reputation";
import { getPostEngagementState } from "@/lib/server/post-engagement-state";
import { boundedJsonError, enforceRateLimit, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

const METHODS = ["POST", "DELETE"];

async function refreshPostAuthorReputation(db: { from: (table: string) => any }, postId: unknown): Promise<string> {
  if (typeof postId !== "string" || !postId.trim()) return "";
  const { data: review } = await db
    .from("reviews")
    .select("reviewer_name")
    .eq("id", postId.trim())
    .maybeSingle();
  const reviewerName = typeof review?.reviewer_name === "string" ? review.reviewer_name : "";
  if (!reviewerName) return "";

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("username", reviewerName)
    .maybeSingle();
  if (typeof profile?.id !== "string") return reviewerName;

  try {
    await recalculateUserReputation(db, profile.id);
  } catch (error) {
    console.error("[wishlist] Failed to refresh author reputation:", error);
  }
  return reviewerName;
}

function scheduleWishlistSideEffects(input: {
  actorName: string;
  postId: unknown;
}) {
  after(async () => {
    const writeDb = createAdminClient();
    const reviewerName = await refreshPostAuthorReputation(writeDb, input.postId);
    const names = [input.actorName];
    if (reviewerName && reviewerName !== input.actorName) names.push(reviewerName);
    invalidateSocialCachesForNames(names);
  });
}

export async function POST(req: NextRequest) {
  const parsed = await readBoundedJson<{ postId?: unknown; restaurantName?: unknown }>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const restaurantName = parsed.value?.restaurantName;
  const postId = parsed.value?.postId;
  if (typeof restaurantName !== "string" || !restaurantName.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const rate = await enforceRateLimit(req, "mutation.social", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const writeDb = createAdminClient();
  const restaurantNameValue = typeof restaurantName === "string" ? restaurantName.trim().slice(0, 200) : "";
  if (typeof postId === "string") {
    const access = await canActorReadPost(writeDb, postId, actor.actorName);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  }

  const { error } = await writeDb
    .from("wishlist")
    .insert({
      user_name: actor.actorName,
      restaurant_name: restaurantNameValue,
      post_id: typeof postId === "string" ? postId : null,
    });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  scheduleWishlistSideEffects({ actorName: actor.actorName, postId });
  const engagement = typeof postId === "string" && postId.trim()
    ? await getPostEngagementState(writeDb, postId.trim(), actor)
    : null;
  return NextResponse.json({ ok: true, engagement, ...(engagement ?? {}) });
}

export async function DELETE(req: NextRequest) {
  const parsed = await readBoundedJson<{ postId?: unknown; restaurantName?: unknown }>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const restaurantName = parsed.value?.restaurantName;
  const postId = parsed.value?.postId;
  if (
    (typeof postId !== "string" || !postId.trim()) &&
    (typeof restaurantName !== "string" || !restaurantName.trim())
  ) {
    return NextResponse.json({ error: "postId or restaurantName is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const rate = await enforceRateLimit(req, "mutation.social", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const writeDb = createAdminClient();
  const restaurantNameValue = typeof restaurantName === "string" ? restaurantName.trim().slice(0, 200) : "";
  let query = writeDb
    .from("wishlist")
    .delete()
    .eq("user_name", actor.actorName);

  query = typeof postId === "string" && postId.trim()
    ? query.eq("post_id", postId.trim())
    : query.eq("restaurant_name", restaurantNameValue).is("post_id", null);

  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  scheduleWishlistSideEffects({ actorName: actor.actorName, postId });
  const engagement = typeof postId === "string" && postId.trim()
    ? await getPostEngagementState(writeDb, postId.trim(), actor)
    : null;
  return NextResponse.json({ ok: true, engagement, ...(engagement ?? {}) });
}
