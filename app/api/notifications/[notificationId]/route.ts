import { NextRequest, NextResponse } from "next/server";
import { NOTIFICATION_OWNERSHIP_SELECT } from "@/lib/selects";
import { getNotificationRouteContext, isNotificationSchemaError, unauthorized } from "../_utils";
import { enforceRateLimit, rateLimitResponse } from "@/lib/server/api-security";

const METHODS = ["DELETE"];

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ notificationId: string }> }) {
  const { supabase, viewer } = await getNotificationRouteContext(req);
  if (!viewer) return unauthorized();
  const rate = await enforceRateLimit(req, "mutation.social", { actorUserId: viewer.id });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const { notificationId } = await params;
  const { data: notification, error: readError } = await supabase
    .from("notifications")
    .select(NOTIFICATION_OWNERSHIP_SELECT)
    .eq("id", notificationId)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: "Unable to delete notification" }, { status: 500 });
  if (!notification || (notification.recipient_user_id && notification.recipient_user_id !== viewer.id) || (!notification.recipient_user_id && notification.recipient_name !== viewer.name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("notifications")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    if (isNotificationSchemaError(error)) {
      const { error: legacyError } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId);

      if (!legacyError) return NextResponse.json({ ok: true });
      return NextResponse.json({ error: "Unable to delete notification" }, { status: 500 });
    }
    return NextResponse.json({ error: "Unable to delete notification" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
