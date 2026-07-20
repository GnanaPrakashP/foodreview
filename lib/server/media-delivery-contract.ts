export const MEDIA_PRIVATE_BUCKET = "media-private";
export const MEDIA_POST_SIGNED_URL_TTL_SECONDS = 5 * 60;

export type MediaDerivativeKind = "canonical" | "feed" | "thumbnail" | "poster";
export type MediaAccessClass = "public_post" | "circle_post" | "private_post" | "avatar_public" | "memory_private";

export function accessClassForPostVisibility(
  value: unknown
): Extract<MediaAccessClass, "public_post" | "circle_post" | "private_post"> {
  if (value === "public") return "public_post";
  if (value === "circle") return "circle_post";
  if (value === "me") return "private_post";
  throw new Error("media_post_visibility_invalid");
}
