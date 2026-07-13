import { authorizedApiHeaders, authorizedJson } from "@/api/client";
import { apiUrl } from "@/api/config";
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
  const response = await fetch(apiUrl(`/api/reviews/${encodeURIComponent(input.postId)}`), {
    headers: await authorizedApiHeaders("deleting this post", "DELETE"),
    method: "DELETE"
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not delete post");
  }
}

export async function requestCircleAccess(input: RequestCircleInput): Promise<"pending" | "joined"> {
  const payload = await authorizedJson<{ status?: string; state?: string }>("/api/circle/request", {
    method: "POST",
    body: JSON.stringify({ receiverName: input.receiverName })
  }, { action: "requesting circle access", timeoutMs: 8_000 });

  if (payload.state === "CIRCLE_ONE_WAY" || payload.status === "one_way" || payload.status === "accepted") {
    return "joined";
  }
  return "pending";
}

export async function cancelCircleAccess(input: RequestCircleInput): Promise<"idle"> {
  await authorizedJson<{ ok?: boolean }>("/api/circle/cancel", {
    method: "POST",
    body: JSON.stringify({ receiverName: input.receiverName })
  }, { action: "canceling circle request", timeoutMs: 8_000 });

  return "idle";
}

export async function leaveCircleAccess(input: RequestCircleInput): Promise<"idle"> {
  await authorizedJson<{ ok?: boolean }>("/api/circle/remove", {
    method: "POST",
    body: JSON.stringify({ otherName: input.receiverName })
  }, { action: "leaving circle", timeoutMs: 8_000 });

  return "idle";
}
