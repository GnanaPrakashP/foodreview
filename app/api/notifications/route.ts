import { NextRequest, NextResponse } from "next/server";
import type { Notification } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayName } from "@/lib/profile-names";
import { LEGACY_NOTIFICATION_SELECT, NOTIFICATION_SELECT } from "@/lib/selects";
import { createRouteSupabase, filterValidNotifications, getNotificationViewer, isNotificationSchemaError, mergeNotifications, unauthorized } from "./_utils";

type ProfileLookupDb = {
  from: (table: string) => any;
};

type ProfileRow = {
  id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

async function buildNotificationProfileMap(
  fallbackDb: ProfileLookupDb,
  notifications: Notification[]
): Promise<Record<string, string>> {
  const actorNames = Array.from(new Set(notifications.map((n) => n.actor_name?.trim()).filter(Boolean))) as string[];
  const actorIds = Array.from(new Set(notifications.map((n) => n.actor_user_id).filter(Boolean))) as string[];
  const aliasesById = new Map<string, string[]>();
  for (const notification of notifications) {
    if (!notification.actor_user_id || !notification.actor_name) continue;
    const aliases = aliasesById.get(notification.actor_user_id) ?? [];
    aliases.push(notification.actor_name);
    aliasesById.set(notification.actor_user_id, aliases);
  }

  const profileMap: Record<string, string> = {};
  if (actorNames.length === 0 && actorIds.length === 0) return profileMap;

  let profileDb: ProfileLookupDb = fallbackDb;
  try {
    profileDb = createAdminClient();
  } catch {
    profileDb = fallbackDb;
  }

  const [byUsername, byId] = await Promise.all([
    actorNames.length > 0
      ? profileDb
          .from("profiles")
          .select("id, username, first_name, last_name")
          .in("username", actorNames)
      : Promise.resolve({ data: [], error: null }),
    actorIds.length > 0
      ? profileDb
          .from("profiles")
          .select("id, username, first_name, last_name")
          .in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const profile of ([...(byUsername.data ?? []), ...(byId.data ?? [])] as ProfileRow[])) {
    const name = profileDisplayName(profile);
    if (!name) continue;
    if (profile.username) profileMap[profile.username] = name;
    if (profile.id) {
      for (const alias of aliasesById.get(profile.id) ?? []) {
        profileMap[alias] = name;
      }
    }
  }

  return profileMap;
}

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabase(req);
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 100);

  const byIdPromise = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("recipient_user_id", viewer.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const byNamePromise = viewer.name
    ? supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT)
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
        .select(LEGACY_NOTIFICATION_SELECT)
        .eq("recipient_name", viewer.name)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (legacyError) {
        console.error("[notifications] legacy list failed:", legacyError.message, legacyError.code, legacyError.details);
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }

      const merged = mergeNotifications(legacy as unknown as Notification[]).slice(0, limit);
      const validNotifications = await filterValidNotifications(supabase, merged);
      return NextResponse.json({
        notifications: validNotifications,
        profileMap: await buildNotificationProfileMap(supabase, validNotifications),
      });
    }

    console.error("[notifications] list failed:", byIdError ?? byNameError);
    return NextResponse.json({ error: byIdError?.message ?? byNameError?.message }, { status: 500 });
  }

  const merged = mergeNotifications(
    byId as unknown as Notification[],
    byName as unknown as Notification[]
  ).slice(0, limit);
  const validNotifications = await filterValidNotifications(supabase, merged);
  const profileMap = await buildNotificationProfileMap(supabase, validNotifications);

  return NextResponse.json({ notifications: validNotifications, profileMap });
}
