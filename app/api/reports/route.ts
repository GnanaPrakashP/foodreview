import { NextRequest } from "next/server";
import { canActorReadPost } from "@/lib/server/review-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";
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

const TARGET_TYPES = new Set(["review", "comment", "profile", "media"]);
const REASONS = new Set(["spam", "harassment", "unsafe", "off_topic", "copyright", "other"]);
const MAX_DETAILS_LENGTH = 1000;
const METHODS = ["POST"];

type ReportTargetType = "review" | "comment" | "profile" | "media";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function canReportTarget(
  db: ReturnType<typeof createAdminClient>,
  actorName: string,
  targetType: ReportTargetType,
  targetId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (targetType === "review") {
    if (!isValidUuid(targetId)) return { ok: false, status: 400, error: "Invalid target id" };
    const access = await canActorReadPost(db, targetId, actorName);
    return access.allowed ? { ok: true } : { ok: false, status: access.status, error: access.error };
  }

  if (targetType === "comment") {
    if (!isValidUuid(targetId)) return { ok: false, status: 400, error: "Invalid target id" };
    const { data: comment, error } = await db
      .from("comments")
      .select("post_id")
      .eq("id", targetId)
      .maybeSingle<{ post_id: string }>();
    if (error || !comment) return { ok: false, status: 404, error: "Comment not found" };
    const access = await canActorReadPost(db, comment.post_id, actorName);
    return access.allowed ? { ok: true } : { ok: false, status: access.status, error: access.error };
  }

  if (targetType === "media") {
    if (!isValidUuid(targetId)) return { ok: false, status: 400, error: "Invalid target id" };
    const { data: media, error } = await db
      .from("review_photos")
      .select("review_id")
      .eq("id", targetId)
      .maybeSingle<{ review_id: string }>();
    if (error || !media) return { ok: false, status: 404, error: "Media not found" };
    const access = await canActorReadPost(db, media.review_id, actorName);
    return access.allowed ? { ok: true } : { ok: false, status: access.status, error: access.error };
  }

  const username = targetId.toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { ok: false, status: 400, error: "Invalid profile target" };
  const { data: profile, error } = await db
    .from("profiles")
    .select("username")
    .eq("username", username)
    .maybeSingle<{ username: string }>();
  if (error || !profile) return { ok: false, status: 404, error: "Profile not found" };
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Authentication required" }, { status: 401 });

  const rate = await enforceRateLimit(req, "mutation.report", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const body = parsed.value;
  const targetType = cleanString(body?.targetType).toLowerCase() as ReportTargetType;
  const targetId = cleanString(body?.targetId);
  const reason = cleanString(body?.reason).toLowerCase();
  const details = cleanString(body?.details);

  if (!TARGET_TYPES.has(targetType)) return mobileApiJson(req, METHODS, { error: "Invalid target type" }, { status: 400 });
  if (!targetId || targetId.length > 128) return mobileApiJson(req, METHODS, { error: "Invalid target id" }, { status: 400 });
  if (!REASONS.has(reason)) return mobileApiJson(req, METHODS, { error: "Invalid report reason" }, { status: 400 });
  if (details.length > MAX_DETAILS_LENGTH) return mobileApiJson(req, METHODS, { error: "Report details are too long" }, { status: 400 });

  const db = createAdminClient();
  const target = await canReportTarget(db, actor.actorName, targetType, targetId);
  if (!target.ok) return mobileApiJson(req, METHODS, { error: target.error }, { status: target.status });
  const idempotency = await claimIdempotency(req, "mutation.report", actor.userId, {
    details, reason, targetId, targetType,
  });
  if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);

  const { data, error } = await db
    .from("content_reports")
    .insert({
      reporter_id: actor.userId,
      reporter_name: actor.actorName,
      target_type: targetType,
      target_id: targetType === "profile" ? targetId.toLowerCase() : targetId,
      reason,
      details: details || null,
      status: "open",
    })
    .select("id, status, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      const responseBody = { duplicate: true, ok: true };
      await completeIdempotency(idempotency, 200, responseBody);
      return mobileApiJson(req, METHODS, responseBody);
    }
    await abandonIdempotency(idempotency);
    return mobileApiJson(req, METHODS, { error: "Could not create report" }, { status: 500 });
  }
  const responseBody = { ok: true, report: data };
  await completeIdempotency(idempotency, 200, responseBody);
  return mobileApiJson(req, METHODS, responseBody);
}
