import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabase, getNotificationViewer, isNotificationSchemaError, unauthorized } from "../_utils";

export async function PATCH(req: NextRequest) {
  const supabase = await createRouteSupabase(req);
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const now = new Date().toISOString();
  const updates = [
    supabase
      .from("notifications")
      .update({ is_read: true, read: true, updated_at: now })
      .eq("recipient_user_id", viewer.id)
      .is("deleted_at", null),
  ];

  if (viewer.name) {
    updates.push(
      supabase
        .from("notifications")
        .update({ is_read: true, read: true, updated_at: now })
        .eq("recipient_name", viewer.name)
        .is("deleted_at", null)
    );
  }

  const results = await Promise.all(updates);
  const error = results.find((result) => result.error)?.error;
  if (error) {
    if (isNotificationSchemaError(error) && viewer.name) {
      const { error: legacyError } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("recipient_name", viewer.name)
        .eq("read", false);

      if (!legacyError) return NextResponse.json({ ok: true });
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
