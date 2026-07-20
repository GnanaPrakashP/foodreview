import type { QueryClient } from "@tanstack/react-query";
import { authorizedJson } from "@/api/client";
import type { ReviewMedia, ReviewPost } from "@/types/models";

export type HomeMediaDerivative = "feed" | "poster" | "playback";
export const HOME_MEDIA_EXPIRY_SAFETY_MS = 25_000;

export type HomeMediaRenewal = {
  cacheRevision: number;
  derivative: HomeMediaDerivative;
  expiresAt: string;
  mediaAssetId: string;
  url: string;
};

export function homeMediaUrlIsUsable(url: string | null | undefined, expiresAt: string | null | undefined, now = Date.now()) {
  if (!url) return false;
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now + HOME_MEDIA_EXPIRY_SAFETY_MS;
}

export async function renewHomeMedia(
  mediaAssetId: string,
  derivative: HomeMediaDerivative,
  signal?: AbortSignal
) {
  return authorizedJson<HomeMediaRenewal>("/api/media/renew", {
    body: JSON.stringify({ derivative, mediaAssetId }),
    method: "POST",
    signal
  }, { action: "renewing media", timeoutMs: 10_000 });
}

export function patchHomeMediaDerivative(
  media: ReviewMedia,
  renewal: HomeMediaRenewal
): ReviewMedia {
  if (media.mediaAssetId !== renewal.mediaAssetId) return media;
  if (renewal.derivative === "feed") {
    return {
      ...media,
      cacheRevision: renewal.cacheRevision,
      expiresAt: renewal.expiresAt,
      feedExpiresAt: renewal.expiresAt,
      feedUrl: renewal.url,
      publicUrl: renewal.url
    };
  }
  if (renewal.derivative === "poster") {
    return {
      ...media,
      cacheRevision: renewal.cacheRevision,
      expiresAt: renewal.expiresAt,
      posterExpiresAt: renewal.expiresAt,
      posterUrl: renewal.url
    };
  }
  return {
    ...media,
    cacheRevision: renewal.cacheRevision,
    expiresAt: renewal.expiresAt,
    playbackExpiresAt: renewal.expiresAt,
    playbackUrl: renewal.url
  };
}

function patchPost(post: ReviewPost, renewal: HomeMediaRenewal) {
  const index = post.media.findIndex((media) => media.mediaAssetId === renewal.mediaAssetId);
  if (index < 0) return post;
  const media = patchHomeMediaDerivative(post.media[index], renewal);
  if (media === post.media[index]) return post;
  const nextMedia = [...post.media];
  nextMedia[index] = media;
  return { ...post, media: nextMedia };
}

function isPost(value: unknown): value is ReviewPost {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ReviewPost).media));
}

function isMedia(value: unknown): value is ReviewMedia {
  return Boolean(
    value && typeof value === "object" &&
    typeof (value as ReviewMedia).mediaAssetId === "string" &&
    ((value as ReviewMedia).mediaType === "image" || (value as ReviewMedia).mediaType === "video")
  );
}

export function patchHomeMediaCacheValue(value: unknown, renewal: HomeMediaRenewal): unknown {
  if (!value) return value;
  if (isMedia(value)) return patchHomeMediaDerivative(value, renewal);
  if (isPost(value)) return patchPost(value, renewal);
  if (Array.isArray(value)) {
    const next = value.map((item) => patchHomeMediaCacheValue(item, renewal));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (typeof value !== "object") return value;
  const current = value as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...current };
  for (const key of ["posts", "pages", "items"] as const) {
    if (!(key in current)) continue;
    const patched = patchHomeMediaCacheValue(current[key], renewal);
    if (patched !== current[key]) {
      next[key] = patched;
      changed = true;
    }
  }
  return changed ? next : value;
}

export function patchCachedHomeMedia(queryClient: QueryClient, renewal: HomeMediaRenewal) {
  queryClient.setQueriesData<unknown>({
    predicate: (query) => (
      (query.queryKey[0] === "feed" && query.queryKey[1] === "circle") ||
      (query.queryKey[0] === "home" && query.queryKey[1] === "carousel-media")
    )
  }, (value: unknown) => patchHomeMediaCacheValue(value, renewal));
}
