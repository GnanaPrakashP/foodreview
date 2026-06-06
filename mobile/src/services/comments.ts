import { supabase } from "@/api/supabase";
import { fetchDisplayNames } from "@/services/feeds";
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

async function viewerName() {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in before commenting");
  return profile.username;
}

export async function getPostComments(postId: string): Promise<PostComment[]> {
  if (!postId) return [];

  const { data, error } = await supabase
    .from("comments")
    .select("id, post_id, user_name, content, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .returns<CommentRow[]>();

  if (error) throw new Error(error.message);

  const displayNames = await fetchDisplayNames((data ?? []).map((row) => row.user_name));
  return (data ?? []).map((row) => mapComment(row, displayNames[row.user_name] ?? row.user_name));
}

export async function addPostComment(input: { postId: string; content: string }): Promise<PostComment> {
  const content = input.content.trim();
  if (!content) throw new Error("Comment is required");
  if (content.length > 500) throw new Error("Comment is too long");

  const name = await viewerName();
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: input.postId, user_name: name, content })
    .select("id, post_id, user_name, content, created_at")
    .single<CommentRow>();

  if (error) throw new Error(error.message);

  const displayNames = await fetchDisplayNames([name]);
  return mapComment(data, displayNames[name] ?? name);
}

export async function deletePostComment(input: { commentId: string }) {
  const name = await viewerName();
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", input.commentId)
    .eq("user_name", name);

  if (error) throw new Error(error.message);
}
