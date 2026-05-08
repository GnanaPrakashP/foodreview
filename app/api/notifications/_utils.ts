import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthenticatedProfileName } from "@/lib/notifications";
import type { Json, Notification } from "@/lib/types";

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
} | null | undefined;

export async function createRouteSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
}

export async function getNotificationViewer(supabase: Awaited<ReturnType<typeof createRouteSupabase>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const name = await getAuthenticatedProfileName(supabase, user.id);
  return { id: user.id, name };
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
    || message.includes("recipient_user_id")
    || message.includes("actor_user_id")
    || message.includes("entity_type")
    || message.includes("entity_id")
    || message.includes("is_read")
    || message.includes("deleted_at")
    || message.includes("metadata")
    || message.includes("message");
}

type SupabaseDb = Awaited<ReturnType<typeof createRouteSupabase>>;

// Returns the subset of notifications whose backing entity still exists/is valid.
// Also soft-deletes the invalid ones as a side effect (fire-and-forget).
export async function filterValidNotifications(
  supabase: SupabaseDb,
  notifications: Notification[]
): Promise<Notification[]> {
  const circleNotifs = notifications.filter(
    (n) => n.type === "CIRCLE_REQUEST_RECEIVED" || n.type === "circle_request"
  );
  const likeNotifs = notifications.filter(
    (n) => (n.type === "POST_LIKED" || n.type === "like") && n.post_id && n.actor_name
  );
  const commentNotifs = notifications.filter(
    (n) => n.type === "POST_COMMENTED" || n.type === "comment"
  );
  const otherNotifs = notifications.filter(
    (n) => !circleNotifs.includes(n) && !likeNotifs.includes(n) && !commentNotifs.includes(n)
  );

  const [validCircleIds, validLikeIds, validCommentIds] = await Promise.all([
    validateCircleRequestNotifs(supabase, circleNotifs),
    validateLikeNotifs(supabase, likeNotifs),
    validateCommentNotifs(supabase, commentNotifs),
  ]);

  const validCircleSet = new Set(validCircleIds);
  const validLikeSet = new Set(validLikeIds);
  const validCommentSet = new Set(validCommentIds);

  const invalidIds = [
    ...circleNotifs.filter((n) => !validCircleSet.has(n.id)),
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
    ...circleNotifs.filter((n) => validCircleSet.has(n.id)),
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

async function validateLikeNotifs(supabase: SupabaseDb, notifs: Notification[]): Promise<string[]> {
  if (notifs.length === 0) return [];
  const postIds = [...new Set(notifs.map((n) => n.post_id).filter(Boolean))] as string[];
  const { data, error } = await supabase
    .from("likes")
    .select("post_id, user_name")
    .in("post_id", postIds);

  if (error) {
    return notifs.filter((n) => n.type === "like").map((n) => n.id);
  }

  if ((data ?? []).length === 0) {
    return notifs.filter((n) => n.type === "like").map((n) => n.id);
  }

  const likeSet = new Set((data ?? []).map((l: { post_id: string; user_name: string }) => `${l.user_name}:${l.post_id}`));

  // Keep only the most recently-updated like notification per (actor, post) pair.
  const latestPerPair = new Map<string, Notification>();
  for (const n of notifs) {
    if (!n.actor_name || !n.post_id || !likeSet.has(`${n.actor_name}:${n.post_id}`)) continue;
    const key = `${n.actor_name}:${n.post_id}`;
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
