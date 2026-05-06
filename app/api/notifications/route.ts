import { NextRequest, NextResponse } from "next/server";
import type { Notification } from "@/lib/types";
import { createRouteSupabase, filterValidNotifications, getNotificationViewer, isNotificationSchemaError, mergeNotifications, unauthorized } from "./_utils";

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabase();
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 100);

  const byIdPromise = supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", viewer.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const byNamePromise = viewer.name
    ? supabase
        .from("notifications")
        .select("*")
        .eq("recipient_name", viewer.name)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit)
    : Promise.resolve({ data: [], error: null });

  const [{ data: byId, error: byIdError }, { data: byName, error: byNameError }] = await Promise.all([byIdPromise, byNamePromise]);
  if (byIdError || byNameError) {
    if (isNotificationSchemaError(byIdError) || isNotificationSchemaError(byNameError)) {
      if (!viewer.name) return NextResponse.json({ notifications: [] });

      const { data: legacy, error: legacyError } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_name", viewer.name)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (legacyError) {
        console.error("[notifications] legacy list failed:", legacyError.message, legacyError.code, legacyError.details);
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }

      const merged = mergeNotifications(legacy as Notification[]).slice(0, limit);
      return NextResponse.json({ notifications: await filterValidNotifications(supabase, merged) });
    }

    console.error("[notifications] list failed:", byIdError ?? byNameError);
    return NextResponse.json({ error: byIdError?.message ?? byNameError?.message }, { status: 500 });
  }

  const merged = mergeNotifications(byId as Notification[], byName as Notification[]).slice(0, limit);
  return NextResponse.json({ notifications: await filterValidNotifications(supabase, merged) });
}
