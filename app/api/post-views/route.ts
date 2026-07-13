import { NextRequest, NextResponse } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSeenPostIdsForUser } from "@/lib/server/post-views";
import { boundedJsonError, enforceRateLimit, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

const METHODS = ["POST"];

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const rate = await enforceRateLimit(req, "mutation.activity", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const parsed = await readBoundedJson<{ postIds?: unknown }>(req, 16 * 1024);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const payload = parsed.value;
  const postIds = Array.isArray(payload?.postIds)
    ? payload.postIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (postIds.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const result = await recordSeenPostIdsForUser(createAdminClient(), actor.userId, postIds);
  if (!result.ok) {
    return NextResponse.json({ error: "Unable to record post views" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: result.count });
}
