import { NextRequest } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  boundedJsonError,
  enforceRateLimit,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson,
  requireIdempotencyKey
} from "@/lib/server/api-security";

export const runtime = "nodejs";

const METHODS = ["POST"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "media.intent", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  if (!requireIdempotencyKey(req)) {
    return mobileApiJson(req, METHODS, { error: "A valid idempotency key is required" }, { status: 400 });
  }
  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const assetId = typeof parsed.value?.assetId === "string" ? parsed.value.assetId.trim() : "";
  if (!UUID_RE.test(assetId)) {
    return mobileApiJson(req, METHODS, { error: "Invalid avatar asset" }, { status: 400 });
  }

  const { data, error } = await createAdminClient().rpc("activate_processed_avatar_asset_v1", {
    p_asset_id: assetId,
    p_user_id: actor.userId
  });
  if (error) return mobileApiJson(req, METHODS, { error: "Unable to update profile photo" }, { status: 500 });
  if (!data) return mobileApiJson(req, METHODS, { error: "Profile photo is not ready" }, { status: 409 });
  return mobileApiJson(req, METHODS, data);
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
