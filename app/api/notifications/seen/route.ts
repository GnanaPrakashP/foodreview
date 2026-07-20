import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, rateLimitResponse } from "@/lib/server/api-security";
import { getNotificationRouteContext, isNotificationSchemaError, unauthorized } from "../_utils";

const METHODS = ["PATCH"];

export async function PATCH(req: NextRequest) {
  const { supabase, viewer } = await getNotificationRouteContext(req);
  if (!viewer) return unauthorized();
  const rate = await enforceRateLimit(req, "mutation.activity", { actorUserId: viewer.id });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const { error } = await supabase.rpc("notification_inbox_mark_seen");
  if (error) {
    if (isNotificationSchemaError(error)) {
      return NextResponse.json({ error: "Notification deployment contract unavailable" }, { status: 503 });
    }
    console.error("[notifications] inbox seen update failed");
    return NextResponse.json({ error: "Unable to update notification inbox" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
