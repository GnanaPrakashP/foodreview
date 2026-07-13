import { NextRequest, NextResponse } from "next/server";
import type { Notification } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayName } from "@/lib/profile-names";
import { NOTIFICATION_SELECT } from "@/lib/selects";
import { filterValidNotifications, getNotificationRouteContext, isNotificationSchemaError, mergeNotifications, unauthorized } from "./_utils";
import { decodeStableTimestampCursor, encodeStableTimestampCursor } from "@/lib/server/stable-cursor";

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
  const { supabase, viewer } = await getNotificationRouteContext(req);
  if (!viewer) return unauthorized();

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 30);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? Math.floor(limitParam) : 30, 1), 50);
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = decodeStableTimestampCursor(rawCursor);
  if (rawCursor && !cursor) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  const recipientFilter = viewer.name
    ? `recipient_user_id.eq.${viewer.id},recipient_name.eq.${viewer.name}`
    : `recipient_user_id.eq.${viewer.id}`;
  let pageQuery = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .or(recipientFilter)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (cursor) {
    pageQuery = pageQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const unreadQuery = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .or(recipientFilter)
    .eq("is_read", false)
    .eq("read", false)
    .is("deleted_at", null);
  const [{ data, error }, { count: unreadCount, error: unreadError }] = await Promise.all([
    pageQuery.limit(limit + 1),
    unreadQuery,
  ]);
  if (error || unreadError) {
    if (isNotificationSchemaError(error) || isNotificationSchemaError(unreadError)) {
      return NextResponse.json({ error: "Notification deployment contract unavailable" }, { status: 503 });
    }
    console.error("[notifications] paginated list failed");
    return NextResponse.json({ error: error?.message ?? unreadError?.message }, { status: 500 });
  }

  const selected = mergeNotifications(data as unknown as Notification[]).slice(0, limit);
  const validNotifications = await filterValidNotifications(supabase, selected);
  const profileMap = await buildNotificationProfileMap(supabase, validNotifications);
  const oldest = selected[selected.length - 1];

  return NextResponse.json({
    nextCursor: (data ?? []).length > limit && oldest
      ? encodeStableTimestampCursor({ createdAt: oldest.created_at, id: oldest.id })
      : null,
    notifications: validNotifications,
    profileMap,
    unreadCount: unreadCount ?? 0,
  });
}
