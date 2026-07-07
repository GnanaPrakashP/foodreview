import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { fetchDisplayNames, getBlockedUsernames } from "@/services/feeds";
import { getCurrentUserProfile } from "@/services/profiles";
import type { PostComment } from "@/types/models";

type CommentRow = {
  id: string;
  post_id: string;
  user_name: string;
  content: string;
  created_at: string;
};

function initialsForName(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

function mapComment(row: CommentRow, displayName: string): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    userName: row.user_name,
    authorName: displayName,
    authorInitials: initialsForName(displayName),
    content: row.content,
    createdAt: row.created_at
  };
}

async function authToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before commenting");
  return token;
}

async function authorizedJson<T>(path: string, init: RequestInit & { body?: string }): Promise<T> {
  const token = await authToken();
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Could not update comments");
  return payload;
}

export async function getPostComments(postId: string): Promise<PostComment[]> {
  if (!postId) return [];

  const viewer = await getCurrentUserProfile();
  const [{ data, error }, blockedNames] = await Promise.all([
    supabase
      .from("comments")
      .select("id, post_id, user_name, content, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .returns<CommentRow[]>(),
    getBlockedUsernames(viewer?.username ?? "")
  ]);

  if (error) throw new Error(error.message);

  const blockedSet = new Set(blockedNames);
  const rows = (data ?? []).filter((row) => !blockedSet.has(row.user_name));
  const displayNames = await fetchDisplayNames(rows.map((row) => row.user_name));
  return rows.map((row) => mapComment(row, displayNames[row.user_name] ?? row.user_name));
}

export async function addPostComment(input: { postId: string; content: string }): Promise<PostComment> {
  const content = input.content.trim();
  if (!content) throw new Error("Comment is required");
  if (content.length > 500) throw new Error("Comment is too long");

  const data = await authorizedJson<CommentRow>("/api/comments", {
    method: "POST",
    body: JSON.stringify({ postId: input.postId, content })
  });

  return mapComment(data, data.user_name);
}

export async function deletePostComment(input: { commentId: string }) {
  await authorizedJson<{ ok: true }>(`/api/comments/${encodeURIComponent(input.commentId)}`, {
    method: "DELETE"
  });
}
