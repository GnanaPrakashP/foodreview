import { NextRequest, NextResponse } from "next/server";
import { NOTIFICATION_OWNERSHIP_SELECT } from "@/lib/selects";
import { createRouteSupabase, getNotificationViewer, isNotificationSchemaError, unauthorized } from "../_utils";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ notificationId: string }> }) {
  const supabase = await createRouteSupabase();
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const { notificationId } = await params;
  const { data: notification, error: readError } = await supabase
    .from("notifications")
    .select(NOTIFICATION_OWNERSHIP_SELECT)
    .eq("id", notificationId)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
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
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
