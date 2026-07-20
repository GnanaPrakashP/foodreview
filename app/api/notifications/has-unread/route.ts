import { NextRequest, NextResponse } from "next/server";
import { getNotificationRouteContext, isNotificationSchemaError, unauthorized } from "../_utils";

export async function GET(req: NextRequest) {
  const { supabase, viewer } = await getNotificationRouteContext(req);
  if (!viewer) return unauthorized();

  const { data, error } = await supabase.rpc("notification_inbox_has_unseen");

  if (error) {
    if (isNotificationSchemaError(error)) {
      return NextResponse.json({ error: "Notification deployment contract unavailable" }, { status: 503 });
    }
    console.error("[notifications] unseen existence lookup failed");
    return NextResponse.json({ error: "Unable to load notification state" }, { status: 500 });
  }

  return NextResponse.json({ hasUnread: data === true });
}
