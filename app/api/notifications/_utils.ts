import { NextRequest, NextResponse } from "next/server";
import type { Json, Notification } from "@/lib/types";
import { createRouteSupabase, getRouteActor } from "@/lib/server/route-supabase";

export { createRouteSupabase };

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
} | null | undefined;

export async function getNotificationRouteContext(req: NextRequest) {
  const { actor, supabase } = await getRouteActor(req);
  return {
    supabase,
    viewer: actor ? { id: actor.userId, name: actor.actorName } : null,
  };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function effectiveDate(n: Notification): number {
  return new Date(n.updated_at || n.created_at).getTime();
}

export function mergeNotifications(...groups: (Notification[] | null | undefined)[]): Notification[] {
  const byId = new Map<string, Notification>();
  for (const group of groups) {
    for (const notification of group ?? []) byId.set(notification.id, normalizeNotification(notification));
  }
  return Array.from(byId.values()).sort((a, b) => effectiveDate(b) - effectiveDate(a));
}

export function isNotificationSchemaError(error: SupabaseLikeError): boolean {
  const message = error?.message ?? "";
  return error?.code === "42703"
    || error?.code === "PGRST204"
    || error?.code === "PGRST202"
    || message.includes("recipient_user_id")
    || message.includes("actor_user_id")
    || message.includes("entity_type")
    || message.includes("entity_id")
    || message.includes("is_read")
    || message.includes("deleted_at")
    || message.includes("metadata")
    || message.includes("message")
    || message.includes("notification_inbox_");
}

type SupabaseDb = Awaited<ReturnType<typeof createRouteSupabase>>;

// Returns the subset of notifications whose backing entity still exists/is valid.
// Also soft-deletes the invalid ones as a side effect (fire-and-forget).
export async function filterValidNotifications(
  supabase: SupabaseDb,
  notifications: Notification[]
): Promise<Notification[]> {
  const retiredThreadNotifs = notifications.filter(
    (n) => n.type === "THREAD_REPLY" || n.type === "also_commented"
  );
  const circleNotifs = notifications.filter(
    (n) => n.type === "CIRCLE_REQUEST_RECEIVED" || n.type === "circle_request"
  );
  const resolvedCircleNotifs = circleNotifs.filter((notification) => {
    const metadata = notification.metadata && typeof notification.metadata === "object" && !Array.isArray(notification.metadata)
      ? notification.metadata as Record<string, Json | undefined>
      : {};
    return metadata.status === "accepted" || metadata.status === "rejected";
  });
  const pendingCircleNotifs = circleNotifs.filter((notification) => !resolvedCircleNotifs.includes(notification));
  const likeNotifs = notifications.filter(
    (n) => (n.type === "POST_LIKED" || n.type === "like") && n.post_id && n.actor_name
  );
  const commentNotifs = notifications.filter(
    (n) => n.type === "POST_COMMENTED" || n.type === "comment"
  );
  const otherNotifs = notifications.filter(
    (n) => !retiredThreadNotifs.includes(n) && !circleNotifs.includes(n) && !likeNotifs.includes(n) && !commentNotifs.includes(n)
  );

  const [validCircleIds, validCommentIds] = await Promise.all([
    validateCircleRequestNotifs(supabase, pendingCircleNotifs),
    validateCommentNotifs(supabase, commentNotifs),
  ]);
  // Like notifications are not validated against the likes table — RLS prevents the
  // recipient from reading the liker's row, causing false negatives. Cleanup happens
  // via removeLikeNotification when someone unlikes.
  const validLikeIds = likeNotifs.map((n) => n.id);

  const validCircleSet = new Set(validCircleIds);
  const validLikeSet = new Set(validLikeIds);
  const validCommentSet = new Set(validCommentIds);

  const invalidIds = [
    ...retiredThreadNotifs,
    ...pendingCircleNotifs.filter((n) => !validCircleSet.has(n.id)),
    ...likeNotifs.filter((n) => !validLikeSet.has(n.id)),
    ...commentNotifs.filter((n) => !validCommentSet.has(n.id)),
  ].map((n) => n.id);

  if (invalidIds.length > 0) {
    const now = new Date().toISOString();
    supabase
      .from("notifications")
      .update({ deleted_at: now, updated_at: now })
      .in("id", invalidIds)
      .then(() => {});
  }

  return [
    ...otherNotifs,
    ...resolvedCircleNotifs,
    ...pendingCircleNotifs.filter((n) => validCircleSet.has(n.id)),
    ...likeNotifs.filter((n) => validLikeSet.has(n.id)),
    ...commentNotifs.filter((n) => validCommentSet.has(n.id)),
  ].sort((a, b) => effectiveDate(b) - effectiveDate(a));
}

async function validateCircleRequestNotifs(supabase: SupabaseDb, notifs: Notification[]): Promise<string[]> {
  if (notifs.length === 0) return [];
  const senderNames = [...new Set(notifs.map((n) => n.actor_name).filter(Boolean))] as string[];
  const { data } = await supabase
    .from("circle_requests")
    .select("sender_name, receiver_name")
    .eq("status", "pending")
    .in("sender_name", senderNames);

  const pendingSet = new Set((data ?? []).map((r: { sender_name: string; receiver_name: string }) => `${r.sender_name}:${r.receiver_name}`));

  // Per (actor, recipient) pair, keep only the most recently-updated notification row.
  // Old data may have accumulated multiple rows from repeated send/cancel cycles —
  // all of them would pass the pending-request check, so we deduplicate here.
  const latestPerPair = new Map<string, Notification>();
  for (const n of notifs) {
    if (!n.actor_name || !pendingSet.has(`${n.actor_name}:${n.recipient_name}`)) continue;
    const key = `${n.actor_name}:${n.recipient_name}`;
    const existing = latestPerPair.get(key);
    if (!existing || effectiveDate(n) > effectiveDate(existing)) {
      latestPerPair.set(key, n);
    }
  }
  return [...latestPerPair.values()].map((n) => n.id);
}


async function validateCommentNotifs(supabase: SupabaseDb, notifs: Notification[]): Promise<string[]> {
  if (notifs.length === 0) return [];

  const commentIds = notifs
    .map((n) => {
      const meta = n.metadata && typeof n.metadata === "object" && !Array.isArray(n.metadata)
        ? n.metadata as Record<string, Json | undefined>
        : {};
      return typeof meta.commentId === "string" ? meta.commentId : null;
    })
    .filter(Boolean) as string[];

  if (commentIds.length === 0) return notifs.map((n) => n.id);

  const { data } = await supabase
    .from("comments")
    .select("id")
    .in("id", commentIds);

  const existingCommentIds = new Set((data ?? []).map((c: { id: string }) => c.id));

  return notifs
    .filter((n) => {
      const meta = n.metadata && typeof n.metadata === "object" && !Array.isArray(n.metadata)
        ? n.metadata as Record<string, Json | undefined>
        : {};
      const commentId = typeof meta.commentId === "string" ? meta.commentId : null;
      return !commentId || existingCommentIds.has(commentId);
    })
    .map((n) => n.id);
}

export function normalizeNotification(row: Partial<Notification> & { id: string; created_at: string }): Notification {
  const type = row.type ?? "SYSTEM_ANNOUNCEMENT";
  const postId = row.post_id ?? null;
  return {
    id: row.id,
    recipient_user_id: row.recipient_user_id ?? null,
    actor_user_id: row.actor_user_id ?? null,
    recipient_name: row.recipient_name ?? "",
    actor_name: row.actor_name ?? null,
    type,
    title: row.title ?? null,
    message: row.message ?? null,
    entity_type: row.entity_type ?? (postId ? "POST" : type.includes("circle") || type.includes("CIRCLE") ? "CIRCLE_REQUEST" : "SYSTEM"),
    entity_id: row.entity_id ?? postId,
    metadata: row.metadata ?? {},
    is_read: row.is_read ?? row.read ?? false,
    post_id: postId,
    restaurant_name: row.restaurant_name ?? null,
    content: row.content ?? null,
    read: row.read ?? row.is_read ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    deleted_at: row.deleted_at ?? null,
  };
}
