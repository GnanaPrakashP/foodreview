import { NextRequest } from "next/server";
import { resolvePostMediaAccess } from "@/lib/server/post-media-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { boundedJsonError, enforceRateLimit, mobileApiJson, mobileOptions, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

export const runtime = "nodejs";

const METHODS = ["POST"];
const MEDIA_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  const rate = await enforceRateLimit(req, "media.access", { actorUserId: actor?.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  const parsed = await readBoundedJson<{ assetIds?: unknown }>(req, 8192);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const body = parsed.value;
  const assetIds = Array.isArray(body?.assetIds)
    ? body.assetIds.filter((id: unknown): id is string => typeof id === "string" && MEDIA_ASSET_ID_RE.test(id)).slice(0, 50)
    : [];
  if (assetIds.length === 0) return mobileApiJson(req, METHODS, { media: [] });

  try {
    const media = await resolvePostMediaAccess(createAdminClient(), assetIds, actor?.actorName ?? "");
    return mobileApiJson(req, METHODS, { media });
  } catch {
    return mobileApiJson(req, METHODS, { error: "Unable to authorize post media" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
