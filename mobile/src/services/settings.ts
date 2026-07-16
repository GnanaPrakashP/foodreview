import { supabase } from "@/api/supabase";
import { apiUrl } from "@/api/config";
import { authorizedApiHeaders, authorizedJson } from "@/api/client";
import { addEngagementToRows } from "@/services/feeds";
import { getCurrentUserProfile } from "@/services/profiles";
import { removePushTokensForUser } from "@/services/notifications";
import { displayNameForProfile, mapReviewPost, REVIEW_SELECT, type ReviewRow } from "@/services/reviewMapper";
import type { ReviewPost } from "@/types/models";
import { fetchPostMediaAccess } from "@/services/postMediaAccess";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";

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
  nextCursor: string | null;
  posts: ReviewPost[];
};

export type SavedSettingsList = SettingsPostList & {
  places: SavedPlaceItem[];
};

type EngagementFeedResponse = {
  bookmarkedPostMap?: Record<string, boolean>;
  commentMap?: Record<string, { count?: number }>;
  likeCountMap?: Record<string, number>;
  likedByMeMap?: Record<string, boolean>;
  myName?: string;
  nextCursor?: string | null;
  placeItems?: Array<{ id: string; restaurant_name: string }>;
  profileMap?: Record<string, string>;
  reviews?: ReviewRow[];
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

export type AccountDeletionAccepted = {
  accepted: true;
  jobId: string;
  status: string;
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

async function authorizedSettingsJson(path: string, init: RequestInit & { body?: string }, action: string) {
  const headers = await authorizedApiHeaders(action, init.method ?? "GET");
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...headers,
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "Could not update settings");
  return payload;
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

async function mapEngagementFeedPosts(payload: EngagementFeedResponse) {
  const reviews = payload.reviews ?? [];
  const mediaByAssetId = await fetchPostMediaAccess(reviews.flatMap((row) => (
    row.review_photos ?? []
  ).map((media) => media.media_asset_id).filter((id): id is string => Boolean(id))));
  return reviews.map((row) => mapReviewPost(row, {
    bookmarkedByMe: payload.bookmarkedPostMap?.[row.id] ?? false,
    commentCount: payload.commentMap?.[row.id]?.count ?? 0,
    displayName: payload.profileMap?.[row.reviewer_name] ?? row.reviewer_name,
    likedByMe: payload.likedByMeMap?.[row.id] ?? false,
    likeCount: payload.likeCountMap?.[row.id] ?? 0,
    mediaByAssetId,
    reviewerUsername: row.reviewer_name
  }));
}

export async function getLikedSettingsPosts(cursor?: string | null): Promise<SettingsPostList> {
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  const payload = await authorizedJson<EngagementFeedResponse>(`/api/me/liked?${params.toString()}`, { method: "GET" }, {
    action: "loading liked posts",
    timeoutMs: 12_000
  });
  return { nextCursor: payload.nextCursor ?? null, posts: await mapEngagementFeedPosts(payload) };
}

export async function getSavedSettingsItems(cursor?: string | null): Promise<SavedSettingsList> {
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  const payload = await authorizedJson<EngagementFeedResponse>(`/api/me/saved?${params.toString()}`, { method: "GET" }, {
    action: "loading saved posts",
    timeoutMs: 12_000
  });
  return {
    nextCursor: payload.nextCursor ?? null,
    places: (payload.placeItems ?? []).map((place) => ({ id: place.id, restaurantName: place.restaurant_name })),
    posts: await mapEngagementFeedPosts(payload)
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
  await authorizedSettingsJson("/api/mobile/blocks", {
    method: "POST",
    body: JSON.stringify({ username: target })
  }, "blocking this account");
}

export async function unblockUser(username: string): Promise<void> {
  const viewer = await getViewerProfile();
  const target = username.trim().toLowerCase().replace(/^@/, "");
  if (!target) throw new Error("Choose someone to unblock");
  if (target === viewer.username) throw new Error("You can't unblock yourself");
  await authorizedSettingsJson("/api/mobile/blocks", {
    method: "DELETE",
    body: JSON.stringify({ username: target })
  }, "unblocking this account");
}

export async function deleteCurrentAccount(): Promise<AccountDeletionAccepted> {
  const startedAt = Date.now();
  const viewer = await getViewerProfile();
  try {
    // Remove every device association while the account is still active; the
    // deletion RPC freezes authenticated writes in the same transaction.
    await removePushTokensForUser(viewer.username).catch(() => {});
    const response = await fetch(apiUrl("/api/delete-account"), {
      headers: await authorizedApiHeaders("deleting your account", "POST"),
      method: "POST"
    });
    const payload = await response.json().catch(() => null) as (Partial<AccountDeletionAccepted> & { error?: string }) | null;
    if (!response.ok) throw new Error(payload?.error ?? "Could not delete account");
    if (!payload?.accepted || !payload.jobId) throw new Error("Account deletion was not accepted");
    recordMobileFlow("account.deletion_request", Date.now() - startedAt, "success");
    return payload as AccountDeletionAccepted;
  } catch (error) {
    recordMobileFlow("account.deletion_request", Date.now() - startedAt, "failure");
    captureMobileError("account.deletion_request_failed", error);
    throw error;
  }
}
