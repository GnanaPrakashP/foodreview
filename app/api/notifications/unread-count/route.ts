import { NextRequest, NextResponse } from "next/server";
import {
  createRouteSupabase,
  filterValidNotifications,
  getNotificationViewer,
  isNotificationSchemaError,
  mergeNotifications,
  unauthorized,
} from "../_utils";
import type { Notification } from "@/lib/types";

const UNREAD_NOTIFICATION_SELECT = [
  "id",
  "recipient_name",
  "actor_name",
  "type",
  "metadata",
  "is_read",
  "post_id",
  "read",
  "created_at",
  "updated_at",
].join(", ");

const LEGACY_UNREAD_NOTIFICATION_SELECT = [
  "id",
  "recipient_name",
  "actor_name",
  "type",
  "post_id",
  "read",
  "created_at",
].join(", ");

function isUnread(notification: Notification): boolean {
  return !(notification.is_read || notification.read);
}

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabase(req);
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const byIdPromise = supabase
    .from("notifications")
    .select(UNREAD_NOTIFICATION_SELECT)
    .eq("recipient_user_id", viewer.id)
    .eq("is_read", false)
    .eq("read", false)
    .is("deleted_at", null);

  const byNamePromise = viewer.name
    ? supabase
        .from("notifications")
        .select(UNREAD_NOTIFICATION_SELECT)
        .eq("recipient_name", viewer.name)
        .eq("is_read", false)
        .eq("read", false)
        .is("deleted_at", null)
    : Promise.resolve({ data: [], error: null });

  const [{ data: byId, error: idError }, { data: byName, error: nameError }] = await Promise.all([byIdPromise, byNamePromise]);
  if (idError || nameError) {
    if (isNotificationSchemaError(idError) || isNotificationSchemaError(nameError)) {
      if (!viewer.name) return NextResponse.json({ unreadCount: 0 });

      const { data: legacy, error: legacyError } = await supabase
        .from("notifications")
        .select(LEGACY_UNREAD_NOTIFICATION_SELECT)
        .eq("recipient_name", viewer.name)
        .eq("read", false);

      if (legacyError) {
        console.error("[notifications] legacy unread count failed:", legacyError.message, legacyError.code, legacyError.details);
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }

      const merged = mergeNotifications(legacy as unknown as Notification[]);
      const validNotifications = await filterValidNotifications(supabase, merged);
      return NextResponse.json({ unreadCount: validNotifications.filter(isUnread).length });
    }

    console.error("[notifications] unread count failed:", idError ?? nameError);
    return NextResponse.json({ error: idError?.message ?? nameError?.message }, { status: 500 });
  }

  const merged = mergeNotifications(
    byId as unknown as Notification[],
    byName as unknown as Notification[]
  );
  const validNotifications = await filterValidNotifications(supabase, merged);
  return NextResponse.json({ unreadCount: validNotifications.filter(isUnread).length });
}
