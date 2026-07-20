export type MediaDerivativeCacheKind = "canonical" | "feed" | "playback" | "poster" | "thumbnail";

export function mediaDerivativeCacheKey(mediaIdentity: string, kind: MediaDerivativeCacheKind, contentRevision = 1) {
  const stable = `${mediaIdentity}:${kind}`;
  return Number.isSafeInteger(contentRevision) && contentRevision > 1 ? `${stable}:r${contentRevision}` : stable;
}
