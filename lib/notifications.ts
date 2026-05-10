import { hasCircleAccess } from "@/lib/circle-db";
import type { Json, Notification, Review } from "@/lib/types";

type NotificationDb = {
  from: (table: string) => any;
};

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
} | null | undefined;

export type NotificationEntityType = "USER" | "POST" | "RESTAURANT" | "CIRCLE_REQUEST" | "SYSTEM";

export type NotificationType =
  | "CIRCLE_REQUEST_RECEIVED"
  | "CIRCLE_REQUEST_ACCEPTED"
  | "CIRCLE_REQUEST_REJECTED"
  | "ADDED_TO_CIRCLE"
  | "MUTUAL_CIRCLE_CREATED"
  | "POST_LIKED"
  | "POST_COMMENTED"
  | "THREAD_REPLY"
  | "CIRCLE_POST_CREATED"
  | "COMMON_RESTAURANT_SCORE_UPDATED"
  | "SYSTEM_ANNOUNCEMENT";

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string | null;
};

type CreateNotificationInput = {
  recipientName: string;
  actorName?: string | null;
  type: NotificationType;
  title?: string;
  message: string;
  entityType: NotificationEntityType;
  entityId?: string | null;
  postId?: string | null;
  restaurantName?: string | null;
  content?: string | null;
  metadata?: Record<string, Json | undefined>;
  dedupe?: boolean;
};

function isNotificationSchemaError(error: SupabaseLikeError): boolean {
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

function legacyType(type: NotificationType): string {
  if (type === "POST_LIKED") return "like";
  if (type === "POST_COMMENTED") return "comment";
  if (type === "THREAD_REPLY") return "also_commented";
  if (type === "CIRCLE_REQUEST_RECEIVED") return "circle_request";
  if (type === "CIRCLE_REQUEST_ACCEPTED") return "circle_accepted";
  if (type === "ADDED_TO_CIRCLE" || type === "MUTUAL_CIRCLE_CREATED") return "circle_added";
  if (type === "CIRCLE_POST_CREATED") return "circle_post";
  return type;
}

function fullName(profile: Pick<ProfileRow, "first_name" | "last_name">): string {
  return `${profile.first_name} ${profile.last_name}`.trim();
}

export function notificationProfileName(profile: Pick<ProfileRow, "first_name" | "last_name" | "username">): string {
  return fullName(profile) || profile.username;
}

async function resolveProfiles(db: NotificationDb, names: string[]): Promise<Map<string, ProfileRow>> {
  const wanted = new Set(names.map((name) => name.trim()).filter(Boolean));
  const resolved = new Map<string, ProfileRow>();
  if (wanted.size === 0) return resolved;

  const { data, error } = await db
    .from("profiles")
    .select("id, first_name, last_name, username, avatar_url")
    .limit(1000);

  if (error) {
    console.warn("[notifications] profile lookup failed:", error.message);
    return resolved;
  }

  for (const profile of (data ?? []) as ProfileRow[]) {
    const namesForProfile = [fullName(profile), profile.username].filter(Boolean);
    for (const name of namesForProfile) {
      if (wanted.has(name)) resolved.set(name, profile);
    }
  }

  return resolved;
}

export async function getAuthenticatedProfileName(db: NotificationDb, userId: string): Promise<string | null> {
  const { data } = await db
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", userId)
    .maybeSingle();

  return data ? notificationProfileName(data) : null;
}

export function notificationUrl(notification: Pick<Notification, "entity_type" | "entity_id" | "post_id" | "actor_name" | "restaurant_name" | "metadata">): string {
  const metadata = notification.metadata && typeof notification.metadata === "object" && !Array.isArray(notification.metadata)
    ? notification.metadata
    : {};

  if (notification.entity_type === "POST" || notification.post_id) {
    return `/reviews/${encodeURIComponent(notification.post_id ?? notification.entity_id ?? "")}`;
  }
  if (notification.entity_type === "USER" && notification.actor_name) {
    return `/people/${encodeURIComponent(notification.actor_name)}`;
  }
  if (notification.entity_type === "RESTAURANT") {
    const restaurant = typeof metadata.restaurantName === "string" ? metadata.restaurantName : notification.restaurant_name;
    if (restaurant) return `/trending/${encodeURIComponent(restaurant)}`;
  }
  return "/notifications";
}

export async function createNotificationForNames(
  db: NotificationDb,
  input: CreateNotificationInput
): Promise<Notification | null> {
  const recipientName = input.recipientName.trim();
  const actorName = input.actorName?.trim() || null;
  if (!recipientName || (actorName && recipientName === actorName)) return null;

  const profiles = await resolveProfiles(db, [recipientName, actorName ?? ""]);
  const recipientProfile = profiles.get(recipientName);
  const actorProfile = actorName ? profiles.get(actorName) : null;
  const entityId = input.entityId ?? input.postId ?? null;
  const oldType = legacyType(input.type);

  if (input.dedupe && actorName && entityId) {
    const { data: existing, error: existingError } = await db
      .from("notifications")
      .select("*")
      .eq("recipient_name", recipientName)
      .eq("actor_name", actorName)
      .eq("type", input.type)
      .eq("entity_type", input.entityType)
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (isNotificationSchemaError(existingError)) {
      const legacyPostId = input.postId ?? (input.entityType === "POST" ? entityId : null);
      let legacyQuery = db
        .from("notifications")
        .select("*")
        .eq("recipient_name", recipientName)
        .eq("actor_name", actorName)
        .eq("type", oldType);

      if (legacyPostId) legacyQuery = legacyQuery.eq("post_id", legacyPostId);

      const { data: legacyExisting } = await legacyQuery
        .order("created_at", { ascending: false })
        .limit(1);

      if (legacyExisting?.[0]) return legacyExisting[0] as Notification;
    }

    const row = existing?.[0] as Notification | undefined;
    if (row) {
      const { error: updateError } = await db
        .from("notifications")
        .update({
          title: input.title ?? row.title,
          message: input.message,
          content: input.content ?? row.content,
          metadata: { ...(row.metadata as Record<string, Json> | null ?? {}), ...(input.metadata ?? {}) },
          read: false,
          is_read: false,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (isNotificationSchemaError(updateError)) {
        await db
          .from("notifications")
          .update({ content: input.content ?? row.content, read: false })
          .eq("id", row.id);
      }
      return { ...row, message: input.message, read: false, is_read: false, deleted_at: null };
    }
  }

  const row = {
    recipient_user_id: recipientProfile?.id ?? null,
    actor_user_id: actorProfile?.id ?? null,
    recipient_name: recipientName,
    actor_name: actorName,
    type: input.type,
    title: input.title ?? null,
    message: input.message,
    entity_type: input.entityType,
    entity_id: entityId,
    metadata: input.metadata ?? {},
    is_read: false,
    post_id: input.postId ?? (input.entityType === "POST" ? entityId : null),
    restaurant_name: input.restaurantName ?? null,
    content: input.content ?? null,
    read: false,
  };

  const { data, error } = await db
    .from("notifications")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (isNotificationSchemaError(error)) {
      const { data: legacyData, error: legacyError } = await db
        .from("notifications")
        .insert({
          recipient_name: recipientName,
          actor_name: actorName,
          type: oldType,
          post_id: input.postId ?? (input.entityType === "POST" ? entityId : null),
          restaurant_name: input.restaurantName ?? null,
          content: input.content ?? input.message,
          read: false,
        })
        .select("*")
        .single();

      if (!legacyError) return legacyData as Notification;
      console.warn("[notifications] legacy insert failed:", legacyError.message, legacyError.code, legacyError.details);
      return null;
    }
    console.warn("[notifications] insert failed:", error.message, error.code, error.details);
    return null;
  }

  return data as Notification;
}

// Upsert a CIRCLE_REQUEST_RECEIVED notification: reuse any existing row (even soft-deleted)
// for the same actor→recipient pair so cancel/resend cycles never accumulate duplicate rows.
export async function upsertCircleRequestNotification(
  db: NotificationDb,
  input: {
    recipientName: string;
    actorName: string;
    message: string;
    requestId: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const metadata = {
    senderName: input.actorName,
    receiverName: input.recipientName,
    requestId: input.requestId,
    status: "pending",
  };

  // Look for any existing notification (including soft-deleted) for this pair
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("recipient_name", input.recipientName)
    .eq("actor_name", input.actorName)
    .in("type", ["CIRCLE_REQUEST_RECEIVED", "circle_request"])
    .order("created_at", { ascending: false })
    .limit(1);

  const row = existing?.[0] as { id: string } | undefined;

  if (row) {
    const { error } = await db
      .from("notifications")
      .update({
        message: input.message,
        entity_id: input.requestId,
        metadata,
        is_read: false,
        read: false,
        deleted_at: null,
        updated_at: now,
      })
      .eq("id", row.id);
    if (isNotificationSchemaError(error)) {
      await db
        .from("notifications")
        .update({
          content: input.message,
          read: false,
          created_at: now,
        })
        .eq("id", row.id);
    }
    return;
  }

  const { error } = await db.from("notifications").insert({
    recipient_name: input.recipientName,
    actor_name: input.actorName,
    type: "CIRCLE_REQUEST_RECEIVED",
    title: "Circle request",
    message: input.message,
    entity_type: "CIRCLE_REQUEST",
    entity_id: input.requestId,
    metadata,
    is_read: false,
    read: false,
  });
  if (isNotificationSchemaError(error)) {
    await db.from("notifications").insert({
      recipient_name: input.recipientName,
      actor_name: input.actorName,
      type: "circle_request",
      post_id: null,
      content: input.message,
      read: false,
    });
  }
}

// Remove like notification when a post is unliked.
export async function removeLikeNotification(
  db: NotificationDb,
  postId: string,
  actorName: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("notifications")
    .update({ deleted_at: now, updated_at: now })
    .eq("actor_name", actorName)
    .eq("post_id", postId)
    .in("type", ["POST_LIKED", "like"])
    .is("deleted_at", null);

  if (isNotificationSchemaError(error)) {
    await db
      .from("notifications")
      .delete()
      .eq("actor_name", actorName)
      .eq("post_id", postId)
      .eq("type", "like");
  }
}

// Remove comment notification when a comment is deleted.
export async function removeCommentNotification(
  db: NotificationDb,
  commentId: string
): Promise<void> {
  const now = new Date().toISOString();
  // commentId is stored in metadata.commentId; filter by entity_id which points to the post,
  // so we query by type and then filter. Supabase supports jsonb containment via @> operator.
  await db
    .from("notifications")
    .update({ deleted_at: now, updated_at: now })
    .in("type", ["POST_COMMENTED", "comment"])
    .contains("metadata", { commentId })
    .is("deleted_at", null);
}

export async function canViewReview(db: NotificationDb, review: Pick<Review, "reviewer_name" | "visibility">, viewerName: string): Promise<boolean> {
  if (!viewerName) return false;
  if (viewerName === review.reviewer_name) return true;
  if (review.visibility === "public") return true;
  if (review.visibility === "circle") return hasCircleAccess(db, review.reviewer_name, viewerName);
  return false;
}

export async function createPostLikeNotification(db: NotificationDb, review: Review, actorName: string) {
  if (review.visibility === "me") return null;
  if (!(await canViewReview(db, review, actorName))) return null;
  return createNotificationForNames(db, {
    recipientName: review.reviewer_name,
    actorName,
    type: "POST_LIKED",
    title: "New like",
    message: `${actorName} liked your post`,
    entityType: "POST",
    entityId: review.id,
    postId: review.id,
    restaurantName: review.restaurant_name,
    metadata: {
      restaurantName: review.restaurant_name,
      thumbnailUrl: review.photo_urls?.[0] ?? review.photo_url ?? null,
    },
    dedupe: true,
  });
}

export async function createPostCommentNotifications(
  db: NotificationDb,
  review: Review,
  actorName: string,
  comment: { id: string; content: string },
  priorCommenters: string[]
) {
  if (review.visibility === "me") return;
  if (!(await canViewReview(db, review, actorName))) return;

  const preview = comment.content.slice(0, 80);
  await createNotificationForNames(db, {
    recipientName: review.reviewer_name,
    actorName,
    type: "POST_COMMENTED",
    title: "New comment",
    message: `${actorName} commented on your post`,
    entityType: "POST",
    entityId: review.id,
    postId: review.id,
    restaurantName: review.restaurant_name,
    content: preview,
    metadata: {
      commentId: comment.id,
      restaurantName: review.restaurant_name,
      thumbnailUrl: review.photo_urls?.[0] ?? review.photo_url ?? null,
    },
  });

  const recipients = Array.from(new Set(priorCommenters)).filter((name) => name && name !== actorName && name !== review.reviewer_name);
  await Promise.all(recipients.map((recipientName) => createNotificationForNames(db, {
    recipientName,
    actorName,
    type: "THREAD_REPLY",
    title: "New reply",
    message: `${actorName} replied in a discussion you joined`,
    entityType: "POST",
    entityId: review.id,
    postId: review.id,
    restaurantName: review.restaurant_name,
    content: preview,
    metadata: {
      commentId: comment.id,
      restaurantName: review.restaurant_name,
      thumbnailUrl: review.photo_urls?.[0] ?? review.photo_url ?? null,
    },
  })));
}

export async function createCirclePostNotifications(db: NotificationDb, review: Review) {
  if (review.visibility === "me") return;

  const { data, error } = await db
    .from("circle_memberships")
    .select("member_name")
    .eq("user_name", review.reviewer_name);

  if (error) {
    console.warn("[notifications] circle post recipients failed:", error.message);
    return;
  }

  const recipients = Array.from(new Set(((data ?? []) as { member_name: string }[]).map((row) => row.member_name)))
    .filter((name) => name && name !== review.reviewer_name);

  await Promise.all(recipients.map((recipientName) => createNotificationForNames(db, {
    recipientName,
    actorName: review.reviewer_name,
    type: "CIRCLE_POST_CREATED",
    title: "New circle post",
    message: `${review.reviewer_name} posted about ${review.restaurant_name}`,
    entityType: "POST",
    entityId: review.id,
    postId: review.id,
    restaurantName: review.restaurant_name,
    metadata: {
      restaurantName: review.restaurant_name,
      thumbnailUrl: review.photo_urls?.[0] ?? review.photo_url ?? null,
    },
    dedupe: true,
  })));
}
