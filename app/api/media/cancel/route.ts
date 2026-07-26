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
    const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const rawIds = parsed.value?.assetIds;
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 10) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid media selection", 400);
    }
    const assetIds = Array.from(new Set(
      rawIds.filter((value): value is string => typeof value === "string" && UUID_PATTERN.test(value))
    )).sort();
    if (assetIds.length !== rawIds.length) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid media selection", 400);
    }

    const claim = await claimIdempotency(req, "media.upload.cancel", actor.userId, { assetIds });
    activeClaim = claim;
    if (claim.state !== "claimed") return idempotencyFailure(req, METHODS, claim);

    const { data, error } = await createAdminClient().rpc("cancel_owned_media_uploads_v1", {
      p_asset_ids: assetIds,
      p_owner_id: actor.userId
    });
    if (error) throw error;
    const responseBody = { cancelled: Number(data) || 0, ok: true };
    await completeIdempotency(claim, 200, responseBody);
    activeClaim = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch {
    if (activeClaim?.state === "claimed") {
      await abandonIdempotency(activeClaim).catch(() => undefined);
    }
    return mobileApiError(req, METHODS, "temporary_failure", "Unable to cancel media", 500);
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
