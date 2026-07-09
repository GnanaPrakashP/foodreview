import { authorizedJson as authorizedApiJson } from "@/api/client";
import type { PostComment, PostEngagementState } from "@/types/models";

type CommentRow = {
  id: string;
  post_id: string;
  user_name: string;
  content: string;
  created_at: string;
};

export type CommentMutationResult = PostComment & {
  engagement?: PostEngagementState;
};

type CommentsApiResponse = {
  comments: CommentRow[];
  profileMap?: Record<string, string>;
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

export async function getPostComments(postId: string): Promise<PostComment[]> {
  if (!postId) return [];

  const payload = await authorizedApiJson<CommentsApiResponse>(
    `/api/comments?postId=${encodeURIComponent(postId)}`,
    { method: "GET" },
    { action: "loading comments", timeoutMs: 10_000 }
  );

  return (payload.comments ?? []).map((row) => mapComment(row, payload.profileMap?.[row.user_name] ?? row.user_name));
}

export async function addPostComment(input: { postId: string; content: string }): Promise<CommentMutationResult> {
  const content = input.content.trim();
  if (!content) throw new Error("Comment is required");
  if (content.length > 500) throw new Error("Comment is too long");

  const data = await authorizedApiJson<CommentRow & {
    engagement?: PostEngagementState;
    profileMap?: Record<string, string>;
  }>("/api/comments", {
    method: "POST",
    body: JSON.stringify({ postId: input.postId, content })
  }, { action: "commenting", timeoutMs: 10_000 });

  return { ...mapComment(data, data.profileMap?.[data.user_name] ?? data.user_name), engagement: data.engagement };
}

export async function deletePostComment(input: { commentId: string }): Promise<{ engagement?: PostEngagementState }> {
  return authorizedApiJson<{ ok: true; engagement?: PostEngagementState }>(`/api/comments/${encodeURIComponent(input.commentId)}`, {
    method: "DELETE"
  }, { action: "deleting comment", timeoutMs: 10_000 });
}
