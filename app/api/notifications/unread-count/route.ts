import { NextResponse } from "next/server";
import {
  createRouteSupabase,
  filterValidNotifications,
  getNotificationViewer,
  isNotificationSchemaError,
  mergeNotifications,
  unauthorized,
} from "../_utils";
import type { Notification } from "@/lib/types";

function isUnread(notification: Notification): boolean {
  return !(notification.is_read || notification.read);
}

export async function GET() {
  const supabase = await createRouteSupabase();
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const byIdPromise = supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", viewer.id)
    .is("deleted_at", null);

  const byNamePromise = viewer.name
    ? supabase
        .from("notifications")
        .select("*")
        .eq("recipient_name", viewer.name)
        .is("deleted_at", null)
    : Promise.resolve({ data: [], error: null });

  const [{ data: byId, error: idError }, { data: byName, error: nameError }] = await Promise.all([byIdPromise, byNamePromise]);
  if (idError || nameError) {
    if (isNotificationSchemaError(idError) || isNotificationSchemaError(nameError)) {
      if (!viewer.name) return NextResponse.json({ unreadCount: 0 });

      const { data: legacy, error: legacyError } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_name", viewer.name)
        .eq("read", false);

      if (legacyError) {
        console.error("[notifications] legacy unread count failed:", legacyError.message, legacyError.code, legacyError.details);
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }

      const merged = mergeNotifications(legacy as Notification[]);
      const validNotifications = await filterValidNotifications(supabase, merged);
      return NextResponse.json({ unreadCount: validNotifications.filter(isUnread).length });
    }

    console.error("[notifications] unread count failed:", idError ?? nameError);
    return NextResponse.json({ error: idError?.message ?? nameError?.message }, { status: 500 });
  }

  const merged = mergeNotifications(byId, byName);
  const validNotifications = await filterValidNotifications(supabase, merged);
  return NextResponse.json({ unreadCount: validNotifications.filter(isUnread).length });
}
