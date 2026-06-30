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

async function authToken(action: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error(`Log in before ${action}`);
  return token;
}

async function authorizedJson(path: string, init: RequestInit & { body?: string }) {
  const token = await authToken("updating this post");
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "Could not update this post");
  return payload;
}

export async function togglePostLike(input: ToggleLikeInput) {
  await authorizedJson("/api/likes", {
    method: input.liked ? "DELETE" : "POST",
    body: JSON.stringify({ postId: input.postId })
  });
}

export async function togglePostBookmark(input: ToggleBookmarkInput) {
  await authorizedJson("/api/wishlist", {
    method: input.bookmarked ? "DELETE" : "POST",
    body: JSON.stringify({
      postId: input.postId,
      restaurantName: input.restaurantName
    })
  });
}

export async function deletePost(input: { postId: string }) {
  await getViewerName();
  const token = await authToken("deleting this post");

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
  const token = await authToken("requesting circle access");

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
