import { NextRequest } from "next/server";
import type { Review } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { REVIEW_SELECT } from "@/lib/selects";
import {
  createCirclePostNotifications,
} from "@/lib/notifications";
import { getRouteActor } from "@/lib/server/route-supabase";
import {
  abandonIdempotency,
  boundedJsonError,
  claimIdempotency,
  completeIdempotency,
  enforceRateLimit,
  idempotencyFailure,
  mobileApiJson,
  rateLimitResponse,
  readBoundedJson,
} from "@/lib/server/api-security";

type NotificationEvent =
  | { event: "POST_LIKED"; reviewId: string }
  | { event: "POST_UNLIKED"; reviewId: string }
  | { event: "POST_COMMENTED"; reviewId: string; commentId: string }
  | { event: "POST_COMMENT_DELETED"; commentId: string }
  | { event: "CIRCLE_POST_CREATED"; reviewId: string };

const METHODS = ["POST"];

const SERVER_OWNED_ENGAGEMENT_EVENTS = new Set([
  "POST_LIKED",
  "POST_UNLIKED",
  "POST_COMMENTED",
  "POST_COMMENT_DELETED",
]);

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Authentication required" }, { status: 401 });
  const rate = await enforceRateLimit(req, "notification.event", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const admin = createAdminClient();
  const parsed = await readBoundedJson<NotificationEvent>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const payload = parsed.value;
  if (!payload || typeof payload.event !== "string") return mobileApiJson(req, METHODS, { error: "Invalid request" }, { status: 400 });
  const actorName = actor.actorName;

  if (SERVER_OWNED_ENGAGEMENT_EVENTS.has(payload.event)) {
    return mobileApiJson(req, METHODS, { error: "Engagement notifications are handled by mutation routes" }, { status: 410 });
  }

  if (payload.event !== "CIRCLE_POST_CREATED") {
    return mobileApiJson(req, METHODS, { error: "Unsupported event" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(payload.reviewId)) return mobileApiJson(req, METHODS, { error: "Invalid review" }, { status: 400 });

  const { data: review, error: reviewError } = await admin
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("id", payload.reviewId)
    .maybeSingle();

  if (reviewError) return mobileApiJson(req, METHODS, { error: "Unable to create notification" }, { status: 500 });
  if (!review) return mobileApiJson(req, METHODS, { error: "Post not found" }, { status: 404 });

  if ((review as unknown as Review).reviewer_name !== actorName) {
    return mobileApiJson(req, METHODS, { error: "Invalid actor" }, { status: 400 });
  }
  const idempotency = await claimIdempotency(req, "notification.event", actor.userId, payload);
  if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
  try {
    await createCirclePostNotifications(admin, review as unknown as Review);
  } catch {
    await abandonIdempotency(idempotency);
    return mobileApiJson(req, METHODS, { error: "Unable to create notification" }, { status: 503 });
  }
  const responseBody = { ok: true };
  await completeIdempotency(idempotency, 200, responseBody);
  return mobileApiJson(req, METHODS, responseBody);
}
