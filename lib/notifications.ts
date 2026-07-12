import { hasCircleAccess } from "@/lib/circle-db";
import { profileDisplayName } from "@/lib/profile-names";
import { LEGACY_NOTIFICATION_SELECT, NOTIFICATION_SELECT } from "@/lib/selects";
import type { Json, Notification, Review } from "@/lib/types";

type NotificationDb = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => any;
};

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
} | null | undefined;

export type NotificationEntityType = "USER" | "POST" | "RESTAURANT" | "CIRCLE_REQUEST" | "TABLE_MEMORY" | "SYSTEM";

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
  | "TABLE_MEMORY_INVITE"
  | "COMMON_RESTAURANT_SCORE_UPDATED"
  | "ACHIEVEMENT_UNLOCKED"
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
  actorDisplayName?: string | null;
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
  push?: boolean;
};

type PushSettingsRow = {
  circle_activity?: boolean | null;
  memory_activity?: boolean | null;
  post_engagement?: boolean | null;
  push_enabled?: boolean | null;
};

type PushTokenRow = {
  expo_push_token: string | null;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_BATCH_SIZE = 100;

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

export function notificationProfileName(profile: Pick<ProfileRow, "first_name" | "last_name" | "username">): string {
  return profile.username || profileDisplayName(profile);
}

// Expects usernames (profile.username), not display names. Callers must pass username strings;
// display-name lookups will silently produce no match.
async function resolveProfiles(db: NotificationDb, names: string[]): Promise<Map<string, ProfileRow>> {
  const wanted = new Set(names.map((name) => name.trim()).filter(Boolean));
  const resolved = new Map<string, ProfileRow>();
  if (wanted.size === 0) return resolved;

  const { data, error } = await db
    .from("profiles")
    .select("id, first_name, last_name, username, avatar_url")
    .in("username", [...wanted]);

  if (error) {
    console.warn("[notifications] profile lookup failed:", error.message);
    return resolved;
  }

  for (const profile of (data ?? []) as ProfileRow[]) {
    const namesForProfile = [profileDisplayName(profile), profile.username].filter(Boolean);
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

// Maps a notification type to the preference category that gates it. Returns
// null for types that are always delivered (e.g. system announcements).
function notificationCategoryForType(type: string): "circle_activity" | "post_engagement" | null {
  const value = type.toLowerCase();
  if (value.includes("circle")) return "circle_activity";
  if (value.includes("like") || value.includes("comment") || value.includes("reply") || value.includes("thread")) {
    return "post_engagement";
  }
  return null;
}

// Returns false only when the recipient has explicitly disabled the category.
// Any error (e.g. the helper not deployed yet) defaults to enabled so we never
// silently drop notifications because of a backend gap.
async function isNotificationCategoryEnabled(db: NotificationDb, recipientName: string, type: string): Promise<boolean> {
  const category = notificationCategoryForType(type);
  if (!category || !db.rpc) return true;
  try {
    const { data, error } = await db.rpc("notification_category_enabled", {
      p_user_name: recipientName,
      p_category: category,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

function pushPreferenceColumnForType(type: string): keyof PushSettingsRow | null {
  if (type === "TABLE_MEMORY_INVITE") return "memory_activity";
  return notificationCategoryForType(type);
}

async function isPushNotificationEnabled(db: NotificationDb, recipientName: string, type: string): Promise<boolean> {
  const category = pushPreferenceColumnForType(type);
  if (!category) return false;

  try {
    const { data, error } = await db
      .from("notification_settings")
      .select("push_enabled, memory_activity, circle_activity, post_engagement")
      .eq("user_name", recipientName)
      .maybeSingle();

    if (error || !data) return true;

    const settings = data as PushSettingsRow;
    if (settings.push_enabled === false) return false;
    return settings[category] !== false;
  } catch {
    return true;
  }
}

function socialPushCopy(input: CreateNotificationInput): { body: string; title: string } | null {
  const actor = input.actorDisplayName?.trim() || input.actorName?.trim() || "Someone";

  switch (input.type) {
    case "POST_LIKED":
      return { title: "New like", body: `${actor} liked your post` };
    case "POST_COMMENTED":
      return { title: "New comment", body: `${actor} commented on your post` };
    case "THREAD_REPLY":
      return { title: "New reply", body: `${actor} replied in a discussion you joined` };
    case "CIRCLE_REQUEST_RECEIVED":
      return { title: "Circle request", body: `${actor} requested to join your circle` };
    case "CIRCLE_REQUEST_ACCEPTED":
      return { title: "Circle request accepted", body: `${actor} accepted your circle request` };
    case "ADDED_TO_CIRCLE":
    case "MUTUAL_CIRCLE_CREATED":
      return { title: "Circle", body: `${actor} joined your circle` };
    case "CIRCLE_POST_CREATED":
      return { title: "New circle post", body: `${actor} shared a new food post` };
    case "TABLE_MEMORY_INVITE":
      return { title: "Table Memory", body: "You have a new memory room invite." };
    default:
      return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function compactPushData(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [key, stringValue(value)] as const)
      .filter(([, value]) => Boolean(value))
  );
}

async function expoPushTokensForRecipient(db: NotificationDb, recipientName: string): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("push_tokens")
      .select("expo_push_token")
      .eq("user_name", recipientName);

    if (error) return [];
    return Array.from(new Set(
      ((data ?? []) as PushTokenRow[])
        .map((row) => row.expo_push_token)
        .filter((token): token is string => Boolean(token))
    ));
  } catch {
    return [];
  }
}

async function sendExpoPushMessages(messages: Array<Record<string, unknown>>) {
  for (let index = 0; index < messages.length; index += EXPO_PUSH_BATCH_SIZE) {
    const batch = messages.slice(index, index + EXPO_PUSH_BATCH_SIZE);
    const response = await fetch(EXPO_PUSH_URL, {
      body: JSON.stringify(batch),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) throw new Error(`expo_push_failed_${response.status}`);
  }
}

async function sendPushForNotification(
  db: NotificationDb,
  input: CreateNotificationInput,
  notification: Pick<Notification, "id"> | null | undefined,
  recipientUserId?: string | null
): Promise<void> {
  try {
    const recipientName = input.recipientName.trim();
    if (!recipientName) return;

    const copy = socialPushCopy(input);
    if (!copy) return;
    if (!(await isPushNotificationEnabled(db, recipientName, input.type))) return;

    const tokens = await expoPushTokensForRecipient(db, recipientName);
    if (tokens.length === 0) return;

    const roomId = input.entityType === "TABLE_MEMORY" ? input.entityId : null;
    const data = compactPushData({
      actorName: input.actorName,
      entityId: input.entityId ?? input.postId,
      entityType: input.entityType,
      notificationId: notification?.id,
      notificationType: input.type,
      postId: input.postId ?? (input.entityType === "POST" ? input.entityId : null),
      recipientName,
      recipientUserId,
      roomId,
      type: input.entityType === "TABLE_MEMORY" ? "table-memory" : "social-notification",
    });

    await sendExpoPushMessages(tokens.map((to) => ({
      body: copy.body,
      data,
      sound: "default",
      title: copy.title,
      to,
    })));
  } catch {
    // Push is best-effort; the durable in-app notification remains the source of truth.
  }
}

export async function createNotificationForNames(
  db: NotificationDb,
  input: CreateNotificationInput
): Promise<Notification | null> {
  const recipientName = input.recipientName.trim();
  const actorName = input.actorName?.trim() || null;
  if (!recipientName || (actorName && recipientName === actorName)) return null;
  if (!(await isNotificationCategoryEnabled(db, recipientName, input.type))) return null;

  const profiles = await resolveProfiles(db, [recipientName, actorName ?? ""]);
  const recipientProfile = profiles.get(recipientName);
  const actorProfile = actorName ? profiles.get(actorName) : null;
  const entityId = input.entityId ?? input.postId ?? null;
  const oldType = legacyType(input.type);

  if (input.dedupe && actorName && entityId) {
    const { data: existing, error: existingError } = await db
      .from("notifications")
      .select(NOTIFICATION_SELECT)
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
        .select(LEGACY_NOTIFICATION_SELECT)
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
    .select(NOTIFICATION_SELECT)
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
        .select(LEGACY_NOTIFICATION_SELECT)
        .single();

      if (!legacyError) {
        if (input.push) {
          await sendPushForNotification(db, input, legacyData as Pick<Notification, "id">, recipientProfile?.id);
        }
        return legacyData as Notification;
      }
      console.warn("[notifications] legacy insert failed:", legacyError.message, legacyError.code, legacyError.details);
      return null;
    }
    console.warn("[notifications] insert failed:", error.message, error.code, error.details);
    return null;
  }

  if (input.push) {
    await sendPushForNotification(db, input, data as Notification, recipientProfile?.id);
  }

  return data as Notification;
}

// Upsert a CIRCLE_REQUEST_RECEIVED notification: reuse any existing row (even soft-deleted)
// for the same actor→recipient pair so cancel/resend cycles never accumulate duplicate rows.
export async function upsertCircleRequestNotification(
  db: NotificationDb,
  input: {
    actorDisplayName?: string | null;
    recipientName: string;
    actorName: string;
    message: string;
    requestId: string | null;
    push?: boolean;
  }
): Promise<void> {
  if (!(await isNotificationCategoryEnabled(db, input.recipientName, "CIRCLE_REQUEST_RECEIVED"))) return;

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
    .select("id, entity_id, deleted_at")
    .eq("recipient_name", input.recipientName)
    .eq("actor_name", input.actorName)
    .in("type", ["CIRCLE_REQUEST_RECEIVED", "circle_request"])
    .order("created_at", { ascending: false })
    .limit(1);

  const row = existing?.[0] as { deleted_at?: string | null; entity_id?: string | null; id: string } | undefined;
  const shouldPush = !row || Boolean(row.deleted_at) || (input.requestId && row.entity_id !== input.requestId);
  const pushInput: CreateNotificationInput = {
    actorDisplayName: input.actorDisplayName,
    actorName: input.actorName,
    entityId: input.requestId,
    entityType: "CIRCLE_REQUEST",
    message: input.message,
    metadata,
    recipientName: input.recipientName,
    title: "Circle request",
    type: "CIRCLE_REQUEST_RECEIVED",
  };

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
    if (input.push !== false && shouldPush) {
      await sendPushForNotification(db, pushInput, row);
    }
    return;
  }

  const { data: inserted, error } = await db.from("notifications").insert({
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
  }).select("id").maybeSingle();
  if (isNotificationSchemaError(error)) {
    const { data: legacyInserted } = await db.from("notifications").insert({
      recipient_name: input.recipientName,
      actor_name: input.actorName,
      type: "circle_request",
      post_id: null,
      content: input.message,
      read: false,
    }).select("id").maybeSingle();
    if (input.push !== false) {
      await sendPushForNotification(db, pushInput, legacyInserted as Pick<Notification, "id"> | null);
    }
    return;
  }

  if (input.push !== false) {
    await sendPushForNotification(db, pushInput, inserted as Pick<Notification, "id"> | null);
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

export async function createPostLikeNotification(db: NotificationDb, review: Review, actorName: string, actorDisplayName?: string) {
  if (review.visibility === "me") return null;
  if (!(await canViewReview(db, review, actorName))) return null;
  const displayName = actorDisplayName || actorName;
  const input: CreateNotificationInput = {
    recipientName: review.reviewer_name,
    actorName,
    actorDisplayName: displayName,
    type: "POST_LIKED",
    title: "New like",
    message: `${displayName} liked your post`,
    entityType: "POST",
    entityId: review.id,
    postId: review.id,
    restaurantName: review.restaurant_name,
    metadata: {
      restaurantName: review.restaurant_name,
      thumbnailUrl: review.photo_urls?.[0] ?? review.photo_url ?? null,
    },
    dedupe: true,
  };
  const notification = await createNotificationForNames(db, input);
  if (notification) await sendPushForNotification(db, input, notification);
  return notification;
}

export async function createPostCommentNotifications(
  db: NotificationDb,
  review: Review,
  actorName: string,
  comment: { id: string; content: string },
  priorCommenters: string[],
  actorDisplayName?: string
) {
  if (review.visibility === "me") return;
  if (!(await canViewReview(db, review, actorName))) return;

  const displayName = actorDisplayName || actorName;
  const preview = comment.content.slice(0, 80);
  const ownerInput: CreateNotificationInput = {
    recipientName: review.reviewer_name,
    actorName,
    actorDisplayName: displayName,
    type: "POST_COMMENTED",
    title: "New comment",
    message: `${displayName} commented on your post`,
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
  };
  const ownerNotification = await createNotificationForNames(db, ownerInput);

  const recipients = Array.from(new Set(priorCommenters)).filter((name) => name && name !== actorName && name !== review.reviewer_name);
  const threadNotifications = await Promise.all(recipients.map(async (recipientName) => {
    const threadInput: CreateNotificationInput = {
      recipientName,
      actorName,
      actorDisplayName: displayName,
      type: "THREAD_REPLY",
      title: "New reply",
      message: `${displayName} replied in a discussion you joined`,
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
    };
    const notification = await createNotificationForNames(db, threadInput);
    return { input: threadInput, notification };
  }));

  await Promise.all([
    { input: ownerInput, notification: ownerNotification },
    ...threadNotifications,
  ].map(({ input, notification }) => notification ? sendPushForNotification(db, input, notification) : Promise.resolve()));
}

export async function createCirclePostNotifications(db: NotificationDb, review: Review) {
  if (review.visibility === "me") return;

  const [{ data, error }, { data: reviewerProfile }] = await Promise.all([
    db.from("circle_memberships").select("member_name").eq("user_name", review.reviewer_name),
    db.from("profiles").select("first_name, last_name").eq("username", review.reviewer_name).maybeSingle(),
  ]);

  if (error) {
    console.warn("[notifications] circle post recipients failed:", error.message);
    return;
  }

  const reviewerDisplay = profileDisplayName(
    reviewerProfile as { first_name: string | null; last_name: string | null } | null,
    review.reviewer_name
  );

  const recipients = Array.from(new Set(((data ?? []) as { member_name: string }[]).map((row) => row.member_name)))
    .filter((name) => name && name !== review.reviewer_name);

  const notifications = await Promise.all(recipients.map(async (recipientName) => {
    const input: CreateNotificationInput = {
      recipientName,
      actorName: review.reviewer_name,
      actorDisplayName: reviewerDisplay,
      type: "CIRCLE_POST_CREATED",
      title: "New circle post",
      message: `${reviewerDisplay} posted about ${review.restaurant_name}`,
      entityType: "POST",
      entityId: review.id,
      postId: review.id,
      restaurantName: review.restaurant_name,
      metadata: {
        restaurantName: review.restaurant_name,
        thumbnailUrl: review.photo_urls?.[0] ?? review.photo_url ?? null,
      },
      dedupe: true,
    };
    const notification = await createNotificationForNames(db, input);
    return { input, notification };
  }));

  await Promise.all(
    notifications.map(({ input, notification }) =>
      notification ? sendPushForNotification(db, input, notification) : Promise.resolve()
    )
  );
}
