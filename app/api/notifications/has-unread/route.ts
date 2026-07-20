import { NextRequest, NextResponse } from "next/server";
import { getNotificationRouteContext, isNotificationSchemaError, unauthorized } from "../_utils";

export async function GET(req: NextRequest) {
  const { supabase, viewer } = await getNotificationRouteContext(req);
  if (!viewer) return unauthorized();

  const recipientFilter = viewer.name
    ? `recipient_user_id.eq.${viewer.id},recipient_name.eq.${viewer.name}`
    : `recipient_user_id.eq.${viewer.id}`;
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .or(recipientFilter)
    .eq("is_read", false)
    .eq("read", false)
    .is("deleted_at", null)
    .limit(1);

  if (error) {
    if (isNotificationSchemaError(error)) {
      return NextResponse.json({ error: "Notification deployment contract unavailable" }, { status: 503 });
    }
    console.error("[notifications] unread existence lookup failed");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hasUnread: (data?.length ?? 0) > 0 });
}
