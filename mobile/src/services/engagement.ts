import { supabase } from "@/api/supabase";
import { apiUrl } from "@/api/config";
import { getCurrentUserProfile } from "@/services/profiles";

export type ToggleLikeInput = {
  liked: boolean;
  postId: string;
};

export type ToggleBookmarkInput = {
  bookmarked: boolean;
  postId: string;
  restaurantName: string;
};

export type RequestCircleInput = {
  receiverName: string;
};

async function getViewerName() {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in before updating this post");
  return profile.username;
}

export async function togglePostLike(input: ToggleLikeInput) {
  const viewerName = await getViewerName();

  if (input.liked) {
    const { error } = await supabase
      .from("likes")
      .delete()
      .eq("post_id", input.postId)
      .eq("user_name", viewerName);

    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("likes")
    .insert({ post_id: input.postId, user_name: viewerName });

  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function togglePostBookmark(input: ToggleBookmarkInput) {
  const viewerName = await getViewerName();

  if (input.bookmarked) {
    const { error } = await supabase
      .from("wishlist")
      .delete()
      .eq("post_id", input.postId)
      .eq("user_name", viewerName);

    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("wishlist")
    .insert({
      post_id: input.postId,
      restaurant_name: input.restaurantName.trim(),
      user_name: viewerName
    });

  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function deletePost(input: { postId: string }) {
  await getViewerName();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Log in before deleting this post");
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before deleting this post");

  const response = await fetch(apiUrl(`/api/reviews/${encodeURIComponent(input.postId)}`), {
    headers: {
      Authorization: `Bearer ${token}`
    },
    method: "DELETE"
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not delete post");
  }
}

export async function requestCircleAccess(input: RequestCircleInput): Promise<"pending" | "joined"> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before requesting circle access");

  const response = await fetch(apiUrl("/api/circle/request"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ receiverName: input.receiverName })
  });
  const payload = await response.json().catch(() => null) as { status?: string; state?: string; error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Unable to request circle access");
  }

  if (payload?.state === "CIRCLE_ONE_WAY" || payload?.status === "one_way" || payload?.status === "accepted") {
    return "joined";
  }
  return "pending";
}
