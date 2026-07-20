import { NextRequest } from "next/server";
import { resolveHomeMediaAccess, type HomeMediaDerivative, type RenewedHomeMedia } from "@/lib/server/post-media-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  boundedJsonError,
  enforceRateLimit,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson
} from "@/lib/server/api-security";

export const runtime = "nodejs";

const METHODS = ["POST"];
const MEDIA_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DERIVATIVES = new Set<HomeMediaDerivative>(["feed", "poster", "playback"]);

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "media.access", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  const parsed = await readBoundedJson<{ derivative?: unknown; mediaAssetId?: unknown }>(req, 1024);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const { derivative, mediaAssetId } = parsed.value ?? {};
  if (
    typeof mediaAssetId !== "string" ||
    !MEDIA_ASSET_ID_RE.test(mediaAssetId) ||
    typeof derivative !== "string" ||
    !DERIVATIVES.has(derivative as HomeMediaDerivative)
  ) {
    return mobileApiJson(req, METHODS, { error: "Invalid media renewal request" }, { status: 400 });
  }

  try {
    const renewed = await resolveHomeMediaAccess(
      createAdminClient(),
      [mediaAssetId],
      actor.userId,
      null,
      derivative as HomeMediaDerivative
    ) as RenewedHomeMedia[];
    if (!renewed[0]) return mobileApiJson(req, METHODS, { error: "Media unavailable" }, { status: 404 });
    return mobileApiJson(req, METHODS, renewed[0]);
  } catch {
    return mobileApiJson(req, METHODS, { error: "Unable to renew media" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
