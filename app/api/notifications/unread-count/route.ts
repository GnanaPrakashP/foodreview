import { NextResponse } from "next/server";
import { createRouteSupabase, getNotificationViewer, isNotificationSchemaError, unauthorized } from "../_utils";

export async function GET() {
  const supabase = await createRouteSupabase();
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const byIdPromise = supabase
    .from("notifications")
    .select("id")
    .eq("recipient_user_id", viewer.id)
    .eq("is_read", false)
    .is("deleted_at", null);

  const byNamePromise = viewer.name
    ? supabase
        .from("notifications")
        .select("id")
        .eq("recipient_name", viewer.name)
        .eq("is_read", false)
        .is("deleted_at", null)
    : Promise.resolve({ data: [], error: null });

  const [{ data: byId, error: idError }, { data: byName, error: nameError }] = await Promise.all([byIdPromise, byNamePromise]);
  if (idError || nameError) {
    if (isNotificationSchemaError(idError) || isNotificationSchemaError(nameError)) {
      if (!viewer.name) return NextResponse.json({ unreadCount: 0 });

      const { data: legacy, error: legacyError } = await supabase
        .from("notifications")
        .select("id")
        .eq("recipient_name", viewer.name)
        .eq("read", false);

      if (legacyError) {
        console.error("[notifications] legacy unread count failed:", legacyError.message, legacyError.code, legacyError.details);
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }

      return NextResponse.json({ unreadCount: (legacy ?? []).length });
    }

    console.error("[notifications] unread count failed:", idError ?? nameError);
    return NextResponse.json({ error: idError?.message ?? nameError?.message }, { status: 500 });
  }

  const ids = new Set([...(byId ?? []), ...(byName ?? [])].map((row) => row.id));
  return NextResponse.json({ unreadCount: ids.size });
}
