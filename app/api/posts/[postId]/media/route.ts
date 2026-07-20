import { NextRequest } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHomeCarouselMediaAccess } from "@/lib/server/post-media-access";
import {
  enforceRateLimit,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse
} from "@/lib/server/api-security";

export const runtime = "nodejs";

const METHODS = ["GET"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, context: { params: Promise<{ postId: string }> }) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "media.access", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const { postId } = await context.params;
  if (!UUID_RE.test(postId)) {
    return mobileApiJson(req, METHODS, { error: "Invalid post media request" }, { status: 400 });
  }

  try {
    const items = await resolveHomeCarouselMediaAccess(createAdminClient(), postId, actor.userId);
    if (items.length === 0) return mobileApiJson(req, METHODS, { error: "Post media unavailable" }, { status: 404 });
    return mobileApiJson(req, METHODS, { items });
  } catch {
    return mobileApiJson(req, METHODS, { error: "Unable to load post media" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
