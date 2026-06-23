import { supabase } from "@/api/supabase";
import { apiUrl } from "@/api/config";
import { addEngagementToRows } from "@/services/feeds";
import { getCurrentUserProfile } from "@/services/profiles";
import { removePushTokensForUser } from "@/services/notifications";
import { displayNameForProfile, REVIEW_SELECT, type ReviewRow } from "@/services/reviewMapper";
import type { ReviewPost } from "@/types/models";

type EngagementPostRow = {
  post_id: string | null;
};

type SavedPostRow = {
  id: string;
  restaurant_name: string;
  post_id: string | null;
};

type CommentRow = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
};

export type SavedPlaceItem = {
  id: string;
  restaurantName: string;
};

export type SettingsPostList = {
  posts: ReviewPost[];
};

export type SavedSettingsList = SettingsPostList & {
  places: SavedPlaceItem[];
};

export type SettingsCommentItem = {
  id: string;
  content: string;
  createdAt: string;
  post: ReviewPost | null;
};

export type NotificationSettings = {
  pushEnabled: boolean;
  memoryActivity: boolean;
  circleActivity: boolean;
  postEngagement: boolean;
};

export type BlockedUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export const defaultNotificationSettings: NotificationSettings = {
  pushEnabled: true,
  memoryActivity: true,
  circleActivity: true,
  postEngagement: true
};

type NotificationSettingsRow = {
  push_enabled: boolean;
  memory_activity: boolean;
  circle_activity: boolean;
  post_engagement: boolean;
};

type BlockedUserRow = {
  id: string;
  blocked_name: string;
};

async function getViewerProfile() {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in before opening settings");
  return profile;
}

async function getVisibleReviewRows(postIds: string[], viewerName: string): Promise<Map<string, ReviewRow>> {
  const uniquePostIds = Array.from(new Set(postIds.filter(Boolean)));
  if (uniquePostIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .in("id", uniquePostIds)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .returns<ReviewRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const circleOwners = Array.from(new Set(
    rows
      .filter((row) => row.visibility === "circle" && row.reviewer_name !== viewerName)
      .map((row) => row.reviewer_name)
  ));
  const accessibleCircleOwners = new Set<string>();

  if (circleOwners.length > 0) {
    const { data: memberships, error: membershipsError } = await supabase
      .from("circle_memberships")
      .select("user_name")
      .eq("member_name", viewerName)
      .in("user_name", circleOwners)
      .returns<Array<{ user_name: string }>>();

    if (membershipsError) throw new Error(membershipsError.message);
    for (const membership of memberships ?? []) accessibleCircleOwners.add(membership.user_name);
  }

  const visibleRows = rows.filter((row) => {
    if (row.reviewer_name === viewerName) return true;
    if (row.visibility === "public") return true;
    if (row.visibility === "circle") return accessibleCircleOwners.has(row.reviewer_name);
    return false;
  });

  return new Map(visibleRows.map((row) => [row.id, row]));
}

async function mapRowsToPosts(rows: ReviewRow[], viewerName: string): Promise<ReviewPost[]> {
  return addEngagementToRows(rows, viewerName);
}

export async function getLikedSettingsPosts(): Promise<SettingsPostList> {
  const viewer = await getViewerProfile();
  const { data, error } = await supabase
    .from("likes")
    .select("post_id")
    .eq("user_name", viewer.username)
    .order("created_at", { ascending: false })
    .returns<EngagementPostRow[]>();

  if (error) throw new Error(error.message);

  const postIds = (data ?? []).map((row) => row.post_id).filter((id): id is string => Boolean(id));
  const reviewMap = await getVisibleReviewRows(postIds, viewer.username);
  const rows = postIds.map((id) => reviewMap.get(id)).filter((row): row is ReviewRow => Boolean(row));

  return {
    posts: await mapRowsToPosts(rows, viewer.username)
  };
}

export async function getSavedSettingsItems(): Promise<SavedSettingsList> {
  const viewer = await getViewerProfile();
  const { data, error } = await supabase
    .from("wishlist")
    .select("id, restaurant_name, post_id")
    .eq("user_name", viewer.username)
    .order("created_at", { ascending: false })
    .returns<SavedPostRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const postIds = rows.map((row) => row.post_id).filter((id): id is string => Boolean(id));
  const reviewMap = await getVisibleReviewRows(postIds, viewer.username);
  const reviewRows = rows
    .map((row) => row.post_id ? reviewMap.get(row.post_id) ?? null : null)
    .filter((row): row is ReviewRow => Boolean(row));
  // Only genuine place-only saves (no post_id) count as "places". A bookmarked
  // post whose review is no longer visible is a dead bookmark, not a saved
  // place, so it is dropped rather than shown as a bare restaurant name.
  const places = rows
    .filter((row) => !row.post_id)
    .map((row) => ({
      id: row.id,
      restaurantName: row.restaurant_name
    }));

  return {
    places,
    posts: await mapRowsToPosts(reviewRows, viewer.username)
  };
}

export async function getSettingsComments(): Promise<SettingsCommentItem[]> {
  const viewer = await getViewerProfile();
  const { data, error } = await supabase
    .from("comments")
    .select("id, post_id, content, created_at")
    .eq("user_name", viewer.username)
    .order("created_at", { ascending: false })
    .returns<CommentRow[]>();

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const reviewMap = await getVisibleReviewRows(rows.map((row) => row.post_id), viewer.username);
  const commentRows = rows.map((row) => ({ comment: row, review: reviewMap.get(row.post_id) ?? null }));
  const posts = await mapRowsToPosts(
    commentRows.map(({ review }) => review).filter((review): review is ReviewRow => Boolean(review)),
    viewer.username
  );
  const postMap = new Map(posts.map((post) => [post.id, post]));

  return commentRows.map(({ comment }) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.created_at,
    post: postMap.get(comment.post_id) ?? null
  }));
}

function isMissingRelation(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    error?.code === "PGRST205" ||
    /schema cache|does not exist|could not find/i.test(message);
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const viewer = await getViewerProfile();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("push_enabled, memory_activity, circle_activity, post_engagement")
    .eq("user_name", viewer.username)
    .maybeSingle<NotificationSettingsRow>();

  if (error) {
    if (isMissingRelation(error)) return defaultNotificationSettings;
    throw new Error(error.message);
  }
  if (!data) return defaultNotificationSettings;

  return {
    pushEnabled: data.push_enabled,
    memoryActivity: data.memory_activity,
    circleActivity: data.circle_activity,
    postEngagement: data.post_engagement
  };
}

export async function updateNotificationSettings(next: NotificationSettings): Promise<NotificationSettings> {
  const viewer = await getViewerProfile();
  const { error } = await supabase
    .from("notification_settings")
    .upsert({
      user_name: viewer.username,
      push_enabled: next.pushEnabled,
      memory_activity: next.memoryActivity,
      circle_activity: next.circleActivity,
      post_engagement: next.postEngagement,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_name" });

  if (error) throw new Error(error.message);

  // When the user turns push off entirely, stop sending to their devices.
  if (!next.pushEnabled) {
    await removePushTokensForUser(viewer.username).catch(() => {});
  }

  return next;
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const viewer = await getViewerProfile();
  const { data, error } = await supabase
    .from("blocked_users")
    .select("id, blocked_name")
    .eq("blocker_name", viewer.username)
    .order("created_at", { ascending: false })
    .returns<BlockedUserRow[]>();

  if (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const usernames = rows.map((row) => row.blocked_name);
  if (usernames.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("username, first_name, last_name, avatar_url")
    .in("username", usernames)
    .returns<Array<{ username: string; first_name: string; last_name: string; avatar_url: string | null }>>();

  if (profilesError) throw new Error(profilesError.message);

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.username, profile]));

  return rows.map((row) => {
    const profile = profileMap.get(row.blocked_name);
    return {
      id: row.id,
      username: row.blocked_name,
      avatarUrl: profile?.avatar_url ?? null,
      displayName: profile
        ? displayNameForProfile({ firstName: profile.first_name, lastName: profile.last_name, username: profile.username })
        : row.blocked_name
    };
  });
}

export async function blockUser(username: string): Promise<void> {
  const viewer = await getViewerProfile();
  const target = username.trim().toLowerCase().replace(/^@/, "");
  if (!target) throw new Error("Choose someone to block");
  if (target === viewer.username) throw new Error("You can't block yourself");

  const { error } = await supabase
    .from("blocked_users")
    .upsert({ blocker_name: viewer.username, blocked_name: target }, { onConflict: "blocker_name,blocked_name" });

  if (error) throw new Error(error.message);
}

export async function unblockUser(username: string): Promise<void> {
  const viewer = await getViewerProfile();
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_name", viewer.username)
    .eq("blocked_name", username);

  if (error) throw new Error(error.message);
}

export async function deleteCurrentAccount() {
  await getViewerProfile();

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before deleting your account");

  const response = await fetch(apiUrl("/api/delete-account"), {
    headers: {
      Authorization: `Bearer ${token}`
    },
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "Could not delete account");

  // The RPC removes the auth user; clear the local session regardless.
  await supabase.auth.signOut().catch(() => {});
}
