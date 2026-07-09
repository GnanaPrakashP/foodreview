import { authorizedJson } from "@/api/client";
import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { getCurrentUserProfile } from "@/services/profiles";
import type { PostEngagementState } from "@/types/models";

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

type EngagementPayload = PostEngagementState & {
  engagement?: PostEngagementState | null;
};

function engagementFromPayload(payload: EngagementPayload): PostEngagementState {
  return payload.engagement ?? payload;
}

export async function togglePostLike(input: ToggleLikeInput): Promise<PostEngagementState> {
  const payload = await authorizedJson<EngagementPayload>("/api/likes", {
    method: input.liked ? "DELETE" : "POST",
    body: JSON.stringify({ postId: input.postId })
  }, { action: "updating this post", timeoutMs: 8_000 });
  return engagementFromPayload(payload);
}

export async function togglePostBookmark(input: ToggleBookmarkInput): Promise<PostEngagementState> {
  const payload = await authorizedJson<EngagementPayload>("/api/wishlist", {
    method: input.bookmarked ? "DELETE" : "POST",
    body: JSON.stringify({
      postId: input.postId,
      restaurantName: input.restaurantName
    })
  }, { action: "updating this post", timeoutMs: 8_000 });
  return engagementFromPayload(payload);
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

export async function cancelCircleAccess(input: RequestCircleInput): Promise<"idle"> {
  const token = await authToken("canceling circle request");

  const response = await fetch(apiUrl("/api/circle/cancel"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ receiverName: input.receiverName })
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Unable to cancel circle request");
  }

  return "idle";
}

export async function leaveCircleAccess(input: RequestCircleInput): Promise<"idle"> {
  const token = await authToken("leaving circle");

  const response = await fetch(apiUrl("/api/circle/remove"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ otherName: input.receiverName })
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Unable to leave circle");
  }

  return "idle";
}
