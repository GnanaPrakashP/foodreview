import { NextRequest } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import {
  abandonIdempotency,
  boundedJsonError,
  claimIdempotency,
  completeIdempotency,
  enforceRateLimit,
  idempotencyFailure,
  mobileApiError,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson
} from "@/lib/server/api-security";
import { createAdminClient } from "@/lib/supabase/admin";

const METHODS = ["POST"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  let activeClaim: Awaited<ReturnType<typeof claimIdempotency>> | null = null;
  try {
    const { actor } = await getRouteActor(req);
    if (!actor) return mobileApiError(req, METHODS, "authentication_required", "Authentication required", 401);
    const rate = await enforceRateLimit(req, "media.intent", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

    const parsed = await readBoundedJson<Record<string, unknown>>(req, 2048);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const assetId = typeof parsed.value?.assetId === "string"
      ? parsed.value.assetId.trim()
      : "";
    if (!UUID_PATTERN.test(assetId)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid media asset", 400);
    }

    const claim = await claimIdempotency(req, "media.processing.retry", actor.userId, { assetId });
    activeClaim = claim;
    if (claim.state !== "claimed") return idempotencyFailure(req, METHODS, claim);

    const admin = createAdminClient();
    const { data: asset, error: assetError } = await admin
      .from("media_assets")
      .select("id,owner_id,owner_name,status,surface,source_deleted_at")
      .eq("id", assetId)
      .maybeSingle<{
        id: string;
        owner_id: string;
        owner_name: string;
        source_deleted_at: string | null;
        status: string;
        surface: string;
      }>();
    if (assetError) throw assetError;
    if (
      !asset ||
      asset.owner_id !== actor.userId ||
      asset.owner_name !== actor.actorName ||
      asset.surface !== "memory"
    ) {
      await abandonIdempotency(claim).catch(() => undefined);
      activeClaim = null;
      return mobileApiError(req, METHODS, "invalid_input", "Media asset not found", 404);
    }

    const { data: job, error: jobError } = await admin
      .from("media_processing_jobs")
      .select("id,status,failure_class")
      .eq("asset_id", assetId)
      .maybeSingle<{ failure_class: string | null; id: string; status: string }>();
    if (jobError) throw jobError;
    if (!job) {
      await abandonIdempotency(claim).catch(() => undefined);
      activeClaim = null;
      return mobileApiError(req, METHODS, "invalid_input", "Media processing job not found", 404);
    }

    let state = job.status;
    if (["queued", "running", "retry_wait", "succeeded"].includes(job.status)) {
      // Already progressing (or complete) is an idempotent success.
    } else if (
      job.status === "dead_letter" &&
      job.failure_class === "retryable" &&
      asset.status === "failed" &&
      asset.source_deleted_at === null
    ) {
      const { data: requeued, error: requeueError } = await admin.rpc("requeue_media_processing_job", {
        p_job_id: job.id,
        p_operator: "mobile-owner-retry"
      });
      if (requeueError) throw requeueError;
      if (requeued !== true) {
        await abandonIdempotency(claim).catch(() => undefined);
        activeClaim = null;
        return mobileApiError(req, METHODS, "permanent_denial", "Media processing cannot be retried", 409);
      }
      state = "queued";
    } else {
      await abandonIdempotency(claim).catch(() => undefined);
      activeClaim = null;
      return mobileApiError(req, METHODS, "permanent_denial", "Media processing cannot be retried", 409);
    }

    const responseBody = { assetId, ok: true, state };
    await completeIdempotency(claim, 200, responseBody);
    activeClaim = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch {
    if (activeClaim?.state === "claimed") {
      await abandonIdempotency(activeClaim).catch(() => undefined);
    }
    return mobileApiError(req, METHODS, "temporary_failure", "Unable to retry media processing", 500);
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
