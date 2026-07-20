import { File } from "expo-file-system";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive
} from "@/security/cacheOwnership";
import {
  ensureAccountFileDirectory,
  isOwnedAccountFileUri
} from "@/services/accountFileStore";
import type { HomeMediaDerivative } from "@/services/homeMediaDelivery";
import {
  HOME_BACKGROUND_MEDIA_PENDING_LIMIT,
  homeMediaPreparationPriority,
  type HomeMediaPreparationClass
} from "@/home/homeMediaPreparationPolicy";
import {
  adjustHomeMediaProfileGauge,
  recordHomeMediaProfile,
  setHomeMediaProfileGauge
} from "@/performance/homeMediaDiagnostics";

type PrefetchInput = {
  cacheKey: string;
  contentRevision?: number;
  derivative: HomeMediaDerivative;
  interactive?: boolean;
  mediaAssetId: string;
  preparationClass: HomeMediaPreparationClass;
  url: string;
};

type ScheduledPrefetch = {
  cancelled: boolean;
  controller: AbortController | null;
  generation: number;
  input: PrefetchInput;
  key: string;
  ownerScope: string;
  promise: Promise<void>;
  queuedAt: number;
  reject: (error: unknown) => void;
  resolve: () => void;
  settled: boolean;
};

const MAX_TRACKED_MEDIA = 64;
const MEDIA_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attempted = new Map<string, true>();
const readyUris = new Map<string, string>();
const prefetched = new Map<string, true>();
const rendered = new Map<string, true>();
const pending = new Map<string, ScheduledPrefetch>();
const listeners = new Set<() => void>();
let activeJob: ScheduledPrefetch | null = null;
let queueRevision = 0;

function ownerKey(generation: number, mediaAssetId: string, derivative: HomeMediaDerivative, contentRevision = 1) {
  return `${generation}:${mediaAssetId}:${derivative}:r${contentRevision}`;
}

function trimBounded(map: Map<string, unknown>) {
  while (map.size > MAX_TRACKED_MEDIA) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) return;
    map.delete(oldest);
  }
}

function publish() {
  for (const listener of listeners) listener();
}

function safeDelete(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Account-file cleanup remains the final fail-closed boundary.
  }
}

function preparationPriority(job: ScheduledPrefetch) {
  return homeMediaPreparationPriority(job.input.preparationClass, job.input.interactive);
}

function updateQueueGauge() {
  setHomeMediaProfileGauge("preparation_queue_depth", pending.size);
}

function settle(job: ScheduledPrefetch, error?: unknown) {
  if (job.settled) return;
  job.settled = true;
  if (error) job.reject(error);
  else job.resolve();
}

function cancelScheduledJob(job: ScheduledPrefetch) {
  if (job.cancelled || job.settled) return;
  job.cancelled = true;
  if (activeJob === job) {
    job.controller?.abort();
    return;
  }
  if (pending.delete(job.key)) {
    updateQueueGauge();
    recordHomeMediaProfile("prefetch_cancelled", {
      derivative: job.input.derivative,
      preparationClass: job.input.preparationClass
    });
  }
  settle(job);
}

function trimPendingQueue() {
  while (pending.size > HOME_BACKGROUND_MEDIA_PENDING_LIMIT) {
    const jobs = Array.from(pending.values()).sort((first, second) => (
      preparationPriority(first) - preparationPriority(second) || first.queuedAt - second.queuedAt
    ));
    const obsolete = jobs[0];
    if (!obsolete) return;
    cancelScheduledJob(obsolete);
  }
}

function nextPendingJob() {
  return Array.from(pending.values()).sort((first, second) => (
    preparationPriority(second) - preparationPriority(first) || first.queuedAt - second.queuedAt
  ))[0] ?? null;
}

async function executeScheduledPrefetch(job: ScheduledPrefetch) {
  const controller = new AbortController();
  job.controller = controller;
  let temporary: File | null = null;
  let completed = false;
  attempted.set(job.key, true);
  trimBounded(attempted);
  recordHomeMediaProfile("prefetch_started", {
    derivative: job.input.derivative,
    preparationClass: job.input.preparationClass
  });
  adjustHomeMediaProfileGauge("simultaneous_cover_preparations", 1);
  adjustHomeMediaProfileGauge("simultaneous_media_preparations", 1);
  if (job.input.preparationClass === "carousel-next") {
    adjustHomeMediaProfileGauge("active_carousel_preparations", 1);
  }
  try {
    const directory = await ensureAccountFileDirectory(job.ownerScope);
    if (
      job.cancelled || controller.signal.aborted || !isCacheGenerationActive(job.generation) ||
      getActiveCacheOwner()?.scope !== job.ownerScope
    ) return;
    const contentRevision = job.input.contentRevision ?? 1;
    const revisionSuffix = contentRevision > 1 ? `-r${contentRevision}` : "";
    const destinationUri = `${directory}/home-${job.input.mediaAssetId}-${job.input.derivative}${revisionSuffix}.jpg`;
    if (!isOwnedAccountFileUri(destinationUri, job.ownerScope)) throw new Error("home_media_prefetch_scope_mismatch");
    const destination = new File(destinationUri);
    temporary = new File(`${destinationUri}.${job.generation}.partial`);
    safeDelete(temporary);
    // Bytes stream natively to disk (rejects on non-2xx); the JS thread never
    // holds or writes the payload, so scrolling stays responsive mid-download.
    await File.downloadFileAsync(job.input.url, temporary, { idempotent: true });
    if (
      job.cancelled || controller.signal.aborted || !isCacheGenerationActive(job.generation) ||
      getActiveCacheOwner()?.scope !== job.ownerScope
    ) return;
    if (!temporary.exists || (temporary.size ?? 0) <= 0) throw new Error("home_media_prefetch_empty");
    safeDelete(destination);
    temporary.move(destination);
    temporary = null;
    readyUris.set(job.input.cacheKey, destination.uri);
    prefetched.set(job.key, true);
    trimBounded(readyUris);
    trimBounded(prefetched);
    completed = true;
    publish();
    recordHomeMediaProfile("prefetch_completed", {
      derivative: job.input.derivative,
      preparationClass: job.input.preparationClass
    });
    settle(job);
  } catch (error) {
    if (job.cancelled || controller.signal.aborted) {
      recordHomeMediaProfile("prefetch_cancelled", {
        derivative: job.input.derivative,
        preparationClass: job.input.preparationClass
      });
      settle(job);
    } else {
      recordHomeMediaProfile("prefetch_failed", {
        derivative: job.input.derivative,
        preparationClass: job.input.preparationClass
      });
      settle(job, error);
    }
  } finally {
    if (temporary) safeDelete(temporary);
    if (!job.settled) {
      recordHomeMediaProfile("prefetch_cancelled", {
        derivative: job.input.derivative,
        preparationClass: job.input.preparationClass
      });
      settle(job);
    }
    if (!completed) attempted.delete(job.key);
    if (activeJob === job) activeJob = null;
    adjustHomeMediaProfileGauge("simultaneous_cover_preparations", -1);
    adjustHomeMediaProfileGauge("simultaneous_media_preparations", -1);
    if (job.input.preparationClass === "carousel-next") {
      adjustHomeMediaProfileGauge("active_carousel_preparations", -1);
    }
    pumpPreparationQueue();
  }
}

function pumpPreparationQueue() {
  if (activeJob) return;
  const next = nextPendingJob();
  if (!next) return;
  pending.delete(next.key);
  updateQueueGauge();
  if (next.cancelled || next.settled) {
    settle(next);
    pumpPreparationQueue();
    return;
  }
  activeJob = next;
  void executeScheduledPrefetch(next);
}

function maybePreemptFor(job: ScheduledPrefetch) {
  if (!activeJob || preparationPriority(job) <= preparationPriority(activeJob)) return;
  activeJob.cancelled = true;
  activeJob.controller?.abort();
}

export function subscribeHomeMediaPrefetch(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrefetchedHomeMediaUri(cacheKey: string) {
  return readyUris.get(cacheKey) ?? null;
}

export function markHomeMediaRendered(mediaAssetId: string, derivative: HomeMediaDerivative, contentRevision = 1) {
  const generation = getActiveCacheGeneration();
  if (!isCacheGenerationActive(generation)) return;
  rendered.set(ownerKey(generation, mediaAssetId, derivative, contentRevision), true);
  trimBounded(rendered);
}

export function homeMediaAlreadyPrefetchedOrRendered(mediaAssetId: string, derivative: HomeMediaDerivative, contentRevision = 1) {
  const generation = getActiveCacheGeneration();
  const key = ownerKey(generation, mediaAssetId, derivative, contentRevision);
  return attempted.has(key) || prefetched.has(key) || rendered.has(key) || pending.has(key) || activeJob?.key === key;
}

export function setHomeMediaPreparationInteractionPriority(
  mediaAssetId: string,
  derivative: HomeMediaDerivative,
  contentRevision: number,
  interactive: boolean
) {
  const generation = getActiveCacheGeneration();
  const normalizedRevision = Number.isSafeInteger(contentRevision) && contentRevision > 1 ? contentRevision : 1;
  const key = ownerKey(generation, mediaAssetId, derivative, normalizedRevision);
  const job = pending.get(key) ?? (activeJob?.key === key ? activeJob : null);
  if (!job || job.input.preparationClass !== "carousel-next" || Boolean(job.input.interactive) === interactive) return;
  job.input = { ...job.input, interactive };
  if (interactive) {
    maybePreemptFor(job);
    return;
  }
  const queued = nextPendingJob();
  if (activeJob === job && queued && preparationPriority(queued) > preparationPriority(job)) {
    job.cancelled = true;
    job.controller?.abort();
  }
}

export function prefetchHomeMedia(input: PrefetchInput) {
  const owner = getActiveCacheOwner();
  const generation = getActiveCacheGeneration();
  const contentRevision = Number.isSafeInteger(input.contentRevision) && (input.contentRevision ?? 1) > 1
    ? input.contentRevision ?? 1
    : 1;
  if (!owner || !isCacheGenerationActive(generation) || !MEDIA_ASSET_ID_RE.test(input.mediaAssetId)) return null;
  const normalizedInput = { ...input, contentRevision };
  const key = ownerKey(generation, input.mediaAssetId, input.derivative, contentRevision);
  const existingPending = pending.get(key);
  if (existingPending) {
    if (input.interactive && !existingPending.input.interactive) {
      existingPending.input = { ...existingPending.input, interactive: true };
      maybePreemptFor(existingPending);
    }
    return null;
  }
  if (attempted.has(key) || prefetched.has(key) || rendered.has(key) || activeJob?.key === key) return null;

  let resolve = () => {};
  let reject: ScheduledPrefetch["reject"] = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const job: ScheduledPrefetch = {
    cancelled: false,
    controller: null,
    generation,
    input: normalizedInput,
    key,
    ownerScope: owner.scope,
    promise,
    queuedAt: ++queueRevision,
    reject,
    resolve,
    settled: false
  };
  pending.set(key, job);
  recordHomeMediaProfile("preparation_queued", {
    derivative: input.derivative,
    preparationClass: input.preparationClass
  });
  updateQueueGauge();
  trimPendingQueue();
  maybePreemptFor(job);
  pumpPreparationQueue();
  void promise.catch(() => {});
  return {
    cancel: () => cancelScheduledJob(job),
    promise
  };
}

export async function cancelHomeMediaPrefetches(ownerScope?: string) {
  const jobs = [
    ...(activeJob && (!ownerScope || activeJob.ownerScope === ownerScope) ? [activeJob] : []),
    ...Array.from(pending.values()).filter((job) => !ownerScope || job.ownerScope === ownerScope)
  ];
  for (const job of jobs) cancelScheduledJob(job);
  await Promise.allSettled(jobs.map((job) => job.promise));
  if (!ownerScope) {
    activeJob = null;
    pending.clear();
  }
  readyUris.clear();
  attempted.clear();
  prefetched.clear();
  rendered.clear();
  updateQueueGauge();
  publish();
}
