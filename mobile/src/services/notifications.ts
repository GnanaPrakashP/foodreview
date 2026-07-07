import Constants from "expo-constants";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "@/api/supabase";
import { getCurrentUserProfile } from "@/services/profiles";
import type { AppNotification, NotificationsPage } from "@/types/models";

type PushRegistrationResult =
  | { granted: true; token: string }
  | { granted: false; reason: string };

export type NotificationPermissionSummary = {
  canAskAgain: boolean;
  granted: boolean;
  status: ExpoNotifications.PermissionStatus | "unavailable";
};

type NotificationsModule = typeof import("expo-notifications");

type NotificationRow = {
  id: string;
  recipient_user_id?: string | null;
  actor_user_id?: string | null;
  recipient_name?: string | null;
  actor_name?: string | null;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: unknown;
  is_read?: boolean | null;
  post_id?: string | null;
  restaurant_name?: string | null;
  content?: string | null;
  read?: boolean | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
};

type ProfileLookupRow = {
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string;
};

type ActorSummary = {
  avatarUrl: string | null;
  displayName: string;
};

let notificationsModulePromise: Promise<NotificationsModule | null> | null = null;
let notificationHandlerConfigured = false;

const NOTIFICATION_SELECT = [
  "id",
  "recipient_user_id",
  "actor_user_id",
  "recipient_name",
  "actor_name",
  "type",
  "title",
  "message",
  "entity_type",
  "entity_id",
  "metadata",
  "is_read",
  "post_id",
  "restaurant_name",
  "content",
  "read",
  "created_at",
  "updated_at",
  "deleted_at"
].join(", ");

const LEGACY_NOTIFICATION_SELECT = [
  "id",
  "recipient_name",
  "actor_name",
  "type",
  "post_id",
  "restaurant_name",
  "content",
  "read",
  "created_at"
].join(", ");

function isAndroidExpoGo() {
  return Platform.OS === "android" && Constants.appOwnership === "expo";
}

export async function loadNotificationsModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web") return null;
  if (isAndroidExpoGo()) return null;

  notificationsModulePromise ??= import("expo-notifications")
    .then((Notifications) => {
      if (!notificationHandlerConfigured) {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: false,
            shouldSetBadge: true,
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true
          })
        });
        notificationHandlerConfigured = true;
      }
      return Notifications;
    })
    .catch(() => null);

  return notificationsModulePromise;
}

function isMissingPushTokensTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /push_tokens|schema cache|relation .*push_tokens.* does not exist/i.test(message);
}

function isMissingNotificationsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /notifications|schema cache|relation .*notifications.* does not exist/i.test(message);
}

function isNotificationSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("recipient_user_id") ||
    message.includes("actor_user_id") ||
    message.includes("entity_type") ||
    message.includes("entity_id") ||
    message.includes("is_read") ||
    message.includes("deleted_at") ||
    message.includes("metadata") ||
    message.includes("message");
}

function notificationProjectId() {
  return Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

async function ensureNotificationPermission(Notifications: NotificationsModule) {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function getNotificationPermissionSummary(): Promise<NotificationPermissionSummary> {
  const Notifications = await loadNotificationsModule();
  if (!Notifications) {
    return {
      canAskAgain: false,
      granted: false,
      status: "unavailable"
    };
  }

  const permission = await Notifications.getPermissionsAsync();
  return {
    canAskAgain: permission.canAskAgain,
    granted: permission.granted,
    status: permission.status
  };
}

export async function registerForPushNotifications(username: string): Promise<PushRegistrationResult> {
  if (Platform.OS === "web") {
    return { granted: false, reason: "Push notifications are only registered on native devices." };
  }

  const Notifications = await loadNotificationsModule();
  if (!Notifications) {
    return { granted: false, reason: "Push notifications are unavailable in this build." };
  }

  const permissionGranted = await ensureNotificationPermission(Notifications);
  if (!permissionGranted) {
    return { granted: false, reason: "Notification permission was not granted." };
  }

  const projectId = notificationProjectId();
  if (!projectId) {
    return { granted: false, reason: "Missing EAS project id for Expo push notifications." };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("table-memory", {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: "Table memory",
      vibrationPattern: [0, 180, 120, 180]
    });
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("push_tokens")
    .upsert({
      expo_push_token: token.data,
      platform: Platform.OS,
      updated_at: now,
      user_name: username
    }, { onConflict: "expo_push_token" });

  if (error) {
    if (isMissingPushTokensTable(error)) {
      return { granted: false, reason: "Push token table is missing." };
    }
    throw new Error(error.message);
  }

  return { granted: true, token: token.data };
}

export async function removePushTokensForUser(username: string): Promise<void> {
  if (!username) return;
  const { error } = await supabase
    .from("push_tokens")
    .delete()
    .eq("user_name", username);

  if (error && !isMissingPushTokensTable(error)) {
    throw new Error(error.message);
  }
}

function displayNameForProfile(row: ProfileLookupRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.username;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function notificationEffectiveDate(notification: Pick<AppNotification, "createdAt" | "updatedAt"> | NotificationRow) {
  if ("createdAt" in notification) return notification.updatedAt || notification.createdAt;
  return notification.updated_at || notification.created_at;
}

function notificationTimestamp(notification: Pick<AppNotification, "createdAt" | "updatedAt"> | NotificationRow) {
  const value = new Date(notificationEffectiveDate(notification)).getTime();
  return Number.isFinite(value) ? value : 0;
}

function mergeNotificationRows(...groups: (NotificationRow[] | null | undefined)[]) {
  const byId = new Map<string, NotificationRow>();
  for (const group of groups) {
    for (const row of group ?? []) byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) => notificationTimestamp(b) - notificationTimestamp(a));
}

async function profileMapForNotifications(rows: NotificationRow[]): Promise<Record<string, ActorSummary>> {
  const actorNames = Array.from(new Set(rows.map((row) => row.actor_name?.trim()).filter(Boolean))) as string[];
  if (actorNames.length === 0) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("username, first_name, last_name, avatar_url")
    .in("username", actorNames)
    .returns<ProfileLookupRow[]>();

  if (error) return {};

  return Object.fromEntries((data ?? []).map((row) => [
    row.username,
    {
      avatarUrl: row.avatar_url,
      displayName: displayNameForProfile(row)
    }
  ]));
}

function notificationDisplayMessage(row: NotificationRow, actor: string) {
  const storedMessage = typeof row.message === "string" ? row.message.trim() : "";
  const type = row.type ?? "";

  if (type === "POST_LIKED" || type === "like") return `${actor} liked your post`;
  if (type === "POST_COMMENTED" || type === "comment") return `${actor} commented on your post`;
  if (type === "THREAD_REPLY" || type === "also_commented") return `${actor} replied in a discussion you joined`;
  if (type === "CIRCLE_REQUEST_RECEIVED" || type === "circle_request") return `${actor} requested to join your circle`;
  if (type === "CIRCLE_REQUEST_ACCEPTED" || type === "circle_accepted") return `${actor} accepted your circle request`;
  if (type === "ADDED_TO_CIRCLE" || type === "MUTUAL_CIRCLE_CREATED" || type === "circle_added") return `${actor} joined your circle`;
  if (type === "CIRCLE_POST_CREATED" || type === "circle_post") {
    return `${actor} posted about ${row.restaurant_name ?? "a restaurant"}`;
  }
  if (type === "TABLE_MEMORY_INVITE" && storedMessage) return storedMessage;
  if (storedMessage) return storedMessage;
  return "You have a new notification";
}

function notificationDestination(row: NotificationRow, metadata: Record<string, unknown>): AppNotification["destination"] {
  const postId = row.post_id ?? (row.entity_type === "POST" ? row.entity_id : null);
  if (postId) return { type: "post", postId };

  if (row.entity_type === "USER" && row.actor_name) return { type: "person", username: row.actor_name };
  if (row.entity_type === "CIRCLE_REQUEST" && row.actor_name) return { type: "person", username: row.actor_name };
  if (typeof metadata.actorName === "string") return { type: "person", username: metadata.actorName };
  if (row.actor_name) return { type: "person", username: row.actor_name };

  return { type: "notification" };
}

function circleRequestStatus(row: NotificationRow, metadata: Record<string, unknown>): AppNotification["circleRequestStatus"] {
  const status = typeof metadata.status === "string" ? metadata.status : "";
  if (status === "accepted" || status === "rejected") return status;
  if (row.type === "CIRCLE_REQUEST_RECEIVED" || row.type === "circle_request") return "pending";
  return "none";
}

function mapNotification(row: NotificationRow, profileMap: Record<string, ActorSummary>): AppNotification {
  const metadata = metadataRecord(row.metadata);
  const actorName = row.actor_name ?? null;
  const actorSummary = actorName ? profileMap[actorName] : null;
  const actorDisplayName = actorSummary?.displayName ?? actorName ?? "Someone";
  const thumbnailUrl = typeof metadata.thumbnailUrl === "string" ? metadata.thumbnailUrl : null;
  const postId = row.post_id ?? (row.entity_type === "POST" ? row.entity_id ?? null : null);
  const updatedAt = row.updated_at ?? row.created_at;

  return {
    id: row.id,
    recipientUserId: row.recipient_user_id ?? null,
    actorUserId: row.actor_user_id ?? null,
    recipientName: row.recipient_name ?? "",
    actorName,
    actorDisplayName,
    actorAvatarUrl: actorSummary?.avatarUrl ?? null,
    type: row.type ?? "SYSTEM_ANNOUNCEMENT",
    title: row.title ?? null,
    message: row.message ?? null,
    entityType: row.entity_type ?? (postId ? "POST" : null),
    entityId: row.entity_id ?? postId,
    metadata,
    isRead: Boolean(row.is_read || row.read),
    postId,
    restaurantName: row.restaurant_name ?? null,
    content: row.content ?? null,
    createdAt: row.created_at,
    updatedAt,
    deletedAt: row.deleted_at ?? null,
    thumbnailUrl,
    displayMessage: notificationDisplayMessage(row, actorDisplayName),
    destination: notificationDestination(row, metadata),
    circleRequestStatus: circleRequestStatus(row, metadata)
  };
}

async function validateCircleRequestNotifications(
  rows: NotificationRow[],
  viewerName: string
): Promise<NotificationRow[]> {
  const circleRows = rows.filter((row) => row.type === "CIRCLE_REQUEST_RECEIVED" || row.type === "circle_request");
  if (circleRows.length === 0 || !viewerName) return rows;

  const senderNames = Array.from(new Set(circleRows.map((row) => row.actor_name).filter(Boolean))) as string[];
  if (senderNames.length === 0) return rows.filter((row) => !circleRows.includes(row));

  const { data, error } = await supabase
    .from("circle_requests")
    .select("sender_name, receiver_name")
    .eq("receiver_name", viewerName)
    .eq("status", "pending")
    .in("sender_name", senderNames)
    .returns<Array<{ sender_name: string; receiver_name: string }>>();

  if (error) return rows;

  const pendingSet = new Set((data ?? []).map((row) => `${row.sender_name}:${row.receiver_name}`));
  const latestPerPair = new Map<string, NotificationRow>();
  const invalidIds: string[] = [];

  for (const row of circleRows) {
    const key = `${row.actor_name ?? ""}:${row.recipient_name ?? viewerName}`;
    if (!row.actor_name || !pendingSet.has(key)) {
      invalidIds.push(row.id);
      continue;
    }
    const existing = latestPerPair.get(key);
    if (!existing || notificationTimestamp(row) > notificationTimestamp(existing)) {
      if (existing) invalidIds.push(existing.id);
      latestPerPair.set(key, row);
    } else {
      invalidIds.push(row.id);
    }
  }

  if (invalidIds.length > 0) {
    const now = new Date().toISOString();
    supabase
      .from("notifications")
      .update({ deleted_at: now, updated_at: now })
      .in("id", invalidIds)
      .then(() => {});
  }

  const validCircleIds = new Set(Array.from(latestPerPair.values()).map((row) => row.id));
  return rows.filter((row) => !circleRows.includes(row) || validCircleIds.has(row.id));
}

export async function listNotifications(limit = 50): Promise<NotificationsPage> {
  const profile = await getCurrentUserProfile();
  if (!profile) return { notifications: [], unreadCount: 0 };

  const byUserIdPromise = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("recipient_user_id", profile.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<NotificationRow[]>();

  const byNamePromise = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("recipient_name", profile.username)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<NotificationRow[]>();

  const [byUserId, byName] = await Promise.all([byUserIdPromise, byNamePromise]);
  if (byUserId.error || byName.error) {
    if (isMissingNotificationsTable(byUserId.error) || isMissingNotificationsTable(byName.error)) {
      return { notifications: [], unreadCount: 0 };
    }
    if (isNotificationSchemaError(byUserId.error) || isNotificationSchemaError(byName.error)) {
      const { data, error } = await supabase
        .from("notifications")
        .select(LEGACY_NOTIFICATION_SELECT)
        .eq("recipient_name", profile.username)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<NotificationRow[]>();

      if (error) {
        if (isMissingNotificationsTable(error)) return { notifications: [], unreadCount: 0 };
        throw new Error(error.message);
      }

      const profileMap = await profileMapForNotifications(data ?? []);
      const notifications = (data ?? []).map((row) => mapNotification(row, profileMap));
      return {
        notifications,
        unreadCount: notifications.filter((notification) => !notification.isRead).length
      };
    }
    throw new Error(byUserId.error?.message ?? byName.error?.message ?? "Could not load notifications");
  }

  const mergedRows = mergeNotificationRows(byUserId.data, byName.data).slice(0, limit);
  const validRows = await validateCircleRequestNotifications(mergedRows, profile.username);
  const profileMap = await profileMapForNotifications(validRows);
  const notifications = validRows.map((row) => mapNotification(row, profileMap));

  return {
    notifications,
    unreadCount: notifications.filter((notification) => !notification.isRead).length
  };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read: true, updated_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    if (isNotificationSchemaError(error)) {
      const { error: legacyError } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", notificationId);
      if (!legacyError) return;
      throw new Error(legacyError.message);
    }
    if (isMissingNotificationsTable(error)) return;
    throw new Error(error.message);
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const profile = await getCurrentUserProfile();
  if (!profile) return;

  const now = new Date().toISOString();
  const updates = await Promise.all([
    supabase
      .from("notifications")
      .update({ is_read: true, read: true, updated_at: now })
      .eq("recipient_user_id", profile.id)
      .is("deleted_at", null),
    supabase
      .from("notifications")
      .update({ is_read: true, read: true, updated_at: now })
      .eq("recipient_name", profile.username)
      .is("deleted_at", null)
  ]);

  const error = updates.find((result) => result.error)?.error;
  if (error) {
    if (isNotificationSchemaError(error)) {
      const { error: legacyError } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("recipient_name", profile.username)
        .eq("read", false);
      if (!legacyError) return;
      throw new Error(legacyError.message);
    }
    if (isMissingNotificationsTable(error)) return;
    throw new Error(error.message);
  }
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    if (isNotificationSchemaError(error)) {
      const { error: legacyError } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId);
      if (!legacyError) return;
      throw new Error(legacyError.message);
    }
    if (isMissingNotificationsTable(error)) return;
    throw new Error(error.message);
  }
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("is_read.eq.false,read.eq.false");

  if (error) {
    if (isMissingNotificationsTable(error)) return 0;
    throw new Error(error.message);
  }

  return count ?? 0;
}
