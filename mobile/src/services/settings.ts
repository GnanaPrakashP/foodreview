import { supabase } from "@/api/supabase";
import { addEngagementToRows } from "@/services/feeds";
import { getCurrentUserProfile } from "@/services/profiles";
import { REVIEW_SELECT, type ReviewRow } from "@/services/reviewMapper";
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
  const places = rows
    .filter((row) => !row.post_id || !reviewMap.has(row.post_id))
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

export async function deleteCurrentAccount() {
  const viewer = await getViewerProfile();

  const { error: reviewError } = await supabase
    .from("reviews")
    .delete()
    .eq("reviewer_name", viewer.username);

  if (reviewError) throw new Error(reviewError.message);

  const { error: profileError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", viewer.id);

  if (profileError) throw new Error(profileError.message);

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) throw new Error(signOutError.message);
}
