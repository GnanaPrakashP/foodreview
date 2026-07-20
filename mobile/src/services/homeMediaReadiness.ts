import { mediaDerivativeCacheKey } from "@/components/posts/mediaCacheKey";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive
} from "@/security/cacheOwnership";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";

export type HomeImageCacheType = "none" | "disk" | "memory";
export type HomeMediaReadinessKind = "feed" | "poster" | "thumbnail";

type ReadinessRecord = {
  cacheKey: string;
  cacheType: HomeImageCacheType;
  generation: number;
  ownerScope: string;
};

const MAX_READY_MEDIA = 128;
const STABLE_MEDIA_IDENTITY = /^[A-Za-z0-9:_-]{1,200}$/;
const displayed = new Map<string, ReadinessRecord>();

function activeReadinessKey(mediaIdentity: string, kind: HomeMediaReadinessKind, contentRevision = 1) {
  const owner = getActiveCacheOwner();
  const generation = getActiveCacheGeneration();
  if (!owner || !isCacheGenerationActive(generation) || !STABLE_MEDIA_IDENTITY.test(mediaIdentity)) return null;
  const cacheKey = mediaDerivativeCacheKey(mediaIdentity, kind, contentRevision);
  return {
    cacheKey,
    generation,
    key: `${owner.scope}:${generation}:${cacheKey}`,
    ownerScope: owner.scope
  };
}

function trimReadiness() {
  while (displayed.size > MAX_READY_MEDIA) {
    const oldest = displayed.keys().next().value as string | undefined;
    if (!oldest) return;
    displayed.delete(oldest);
  }
}

export function markHomeMediaDisplayed(
  mediaIdentity: string,
  kind: HomeMediaReadinessKind,
  cacheType: HomeImageCacheType,
  contentRevision = 1
) {
  const context = activeReadinessKey(mediaIdentity, kind, contentRevision);
  if (!context) return false;
  displayed.delete(context.key);
  displayed.set(context.key, {
    cacheKey: context.cacheKey,
    cacheType,
    generation: context.generation,
    ownerScope: context.ownerScope
  });
  trimReadiness();
  return true;
}

export function homeMediaWasDisplayed(mediaIdentity: string, kind: HomeMediaReadinessKind, contentRevision = 1) {
  const context = activeReadinessKey(mediaIdentity, kind, contentRevision);
  return Boolean(context && displayed.has(context.key));
}

export function homeMediaLastCacheType(mediaIdentity: string, kind: HomeMediaReadinessKind, contentRevision = 1) {
  const context = activeReadinessKey(mediaIdentity, kind, contentRevision);
  return context ? displayed.get(context.key)?.cacheType ?? null : null;
}

export function clearHomeMediaReadiness() {
  displayed.clear();
}

export function homeMediaReadinessSnapshot() {
  return Array.from(displayed.values(), (record) => ({ ...record }));
}

registerSensitiveResourceCleanup(clearHomeMediaReadiness);
