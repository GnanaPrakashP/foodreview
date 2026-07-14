#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import {
  MetricRegistry,
  ExternalSafetyMonitor,
  actorHeaders,
  argument,
  assertNodeRuntime,
  authenticateActors,
  capacityConclusion,
  invariant,
  loadActorDefinitions,
  loadCapacityConfig,
  percentile,
  safeRunId,
  safeTargetMetadata,
  timedRequest,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config);
const tierName = argument("tier", "launch");
const tier = config.tiers[tierName];
invariant(Boolean(tier), `media_tier_unknown:${tierName}`);
const uploadTarget = Number(argument("concurrency", tier.concurrentUploads));
invariant(Number.isInteger(uploadTarget) && uploadTarget > 0 && uploadTarget <= config.safety.maxConcurrentUploads, "media_concurrency_invalid");
const totalUploads = Number(argument("total", uploadTarget));
invariant(Number.isInteger(totalUploads) && totalUploads >= uploadTarget && totalUploads <= config.seed.volumes.mediaUploads, "media_total_invalid");
const avatarTarget = Number(argument("avatars", tierName === "stress" ? 4 : 2));
invariant(Number.isInteger(avatarTarget) && avatarTarget >= 0 && avatarTarget <= uploadTarget, "media_avatar_target_invalid");
invariant(process.env.LOAD_MEDIA_FIXTURES_LICENSE === "synthetic", "media_fixture_license_declaration_required");

const imagePath = process.env.LOAD_IMAGE_FIXTURE_PATH;
const videoPath = process.env.LOAD_VIDEO_FIXTURE_PATH;
invariant(Boolean(imagePath), "media_image_fixture_required");
if (uploadTarget >= 5) invariant(Boolean(videoPath), "media_video_fixture_required_for_80_20_mix");
const [imageBody, imageStat] = await Promise.all([readFile(imagePath), stat(imagePath)]);
const video = videoPath ? await Promise.all([readFile(videoPath), stat(videoPath)]) : null;
invariant(imageStat.size > 0 && imageStat.size <= 12 * 1024 * 1024, "media_image_fixture_size_invalid");
if (video) invariant(video[1].size > 0 && video[1].size <= 50 * 1024 * 1024, "media_video_fixture_size_invalid");

const definitions = (await loadActorDefinitions()).filter((actor) => !actor.frozenFixture);
const actorTarget = Math.min(definitions.length, config.safety.maxConcurrentUsers, Math.max(uploadTarget, Math.min(200, totalUploads)));
const actors = await authenticateActors(definitions, actorTarget);
const memoryActors = actors.filter((actor) => actor.messageIds.length > 0);
invariant(memoryActors.length > 0, "media_memory_actor_fixture_required");
const apiBase = process.env.LOAD_STAGING_API_URL.replace(/\/$/, "");
const supabaseBase = process.env.LOAD_STAGING_SUPABASE_URL.replace(/\/$/, "");
const anonKey = process.env.LOAD_STAGING_SUPABASE_ANON_KEY;
invariant(Boolean(anonKey), "media_anon_key_required");
const metrics = new MetricRegistry();
const runId = safeRunId();
const safety = new ExternalSafetyMonitor(config, { runId, scenario: "media" });
const startedAt = new Date().toISOString();
const processingDurations = [];
const assets = [];
let ready = 0;
let terminalFailures = 0;
let roomMediaReady = 0;
let publishedImagePosts = 0;
let publishedVideoPosts = 0;
let avatarUploads = 0;
await safety.poll(true);
invariant(!safety.abortReason, `safety_abort:${safety.abortReason}`);

async function apiRequest(group, actor, path, options = {}) {
  return timedRequest(metrics, group, `${apiBase}${path}`, {
    ...options,
    headers: actorHeaders(actor, { "X-CircleBites-Load-Run": runId, ...options.headers })
  });
}

function fixture(index) {
  const useVideo = Boolean(video && index % 5 === 0);
  return useVideo ? {
    body: video[0], durationMs: Number(process.env.LOAD_VIDEO_DURATION_MS ?? 12000),
    extension: "mp4", height: Number(process.env.LOAD_VIDEO_HEIGHT ?? 720), kind: "video",
    mimeType: "video/mp4", size: video[1].size, width: Number(process.env.LOAD_VIDEO_WIDTH ?? 1280)
  } : {
    body: imageBody, durationMs: null, extension: "jpg", height: Number(process.env.LOAD_IMAGE_HEIGHT ?? 1200), kind: "image",
    mimeType: "image/jpeg", size: imageStat.size, width: Number(process.env.LOAD_IMAGE_WIDTH ?? 960)
  };
}

function isMemorySurface(index) {
  return Math.floor(index / 5) % 5 === 0;
}

function intendedVisibility(index) {
  const bucket = index % 100;
  if (bucket < config.seed.distribution.privatePostPercent) return "me";
  if (bucket < config.seed.distribution.privatePostPercent + config.seed.distribution.circlePostPercent) return "circle";
  return "public";
}

async function uploadOne(actor, index) {
  const media = fixture(index);
  if (isMemorySurface(index)) {
    const memoryActor = memoryActors[index % memoryActors.length];
    const message = memoryActor.messageIds[index % memoryActor.messageIds.length];
    const intent = await apiRequest("memory-media-intent", memoryActor, "/api/mobile/memories/upload-intent", {
      body: JSON.stringify({
        durationMs: media.durationMs,
        fileName: `synthetic-load-${index}.${media.extension}`,
        fileSizeBytes: media.size,
        height: media.height,
        mediaKind: media.kind,
        mimeType: media.mimeType,
        roomId: message.roomId,
        width: media.width
      }),
      method: "POST"
    });
    if (!intent.expected || !intent.payload?.intentId || !intent.payload?.storagePath) return null;
    const encodedPath = intent.payload.storagePath.split("/").map(encodeURIComponent).join("/");
    const storage = await timedRequest(metrics, "storage-upload", `${supabaseBase}/storage/v1/object/memory-media/${encodedPath}`, {
      body: media.body,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${memoryActor.accessToken}`,
        "Content-Type": media.mimeType,
        "X-CircleBites-Load-Run": runId,
        "x-upsert": "false"
      },
      method: "POST",
      parseJson: false,
      timeoutMs: 60000
    });
    if (!storage.expected) return null;
    const queuedAt = Date.now();
    const finalized = await apiRequest("memory-media-finalize", memoryActor, "/api/mobile/memories/finalize-upload", {
      body: JSON.stringify({
        intentId: intent.payload.intentId,
        messageId: message.messageId,
        position: index,
        roomId: message.roomId,
        storagePath: intent.payload.storagePath
      }),
      method: "POST",
      timeoutMs: 60000
    });
    if (!finalized.expected) return null;
    const moderationStatus = finalized.payload?.moderationStatus ?? finalized.payload?.photo?.moderation_status;
    return {
      actor: memoryActor,
      complete: moderationStatus === "approved" || moderationStatus === "rejected",
      kind: media.kind,
      moderationStatus,
      processingDuration: Date.now() - queuedAt,
      status: moderationStatus === "approved" ? "ready" : moderationStatus,
      surface: "memory"
    };
  }
  const intent = await apiRequest("media-intent", actor, "/api/media/upload-intent", {
    body: JSON.stringify({
      cropRect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
      durationMs: media.durationMs,
      fileName: `synthetic-load-${index}.${media.extension}`,
      fileSizeBytes: media.size,
      height: media.height,
      intendedVisibility: intendedVisibility(index),
      mediaType: media.kind,
      mimeType: media.mimeType,
      surface: "post",
      width: media.width
    }),
    headers: { "Idempotency-Key": `${runId}-${index}` },
    method: "POST"
  });
  if (!intent.expected || !intent.payload?.assetId || !intent.payload?.uploadPath) return null;
  const encodedPath = intent.payload.uploadPath.split("/").map(encodeURIComponent).join("/");
  const storage = await timedRequest(metrics, "storage-upload", `${supabaseBase}/storage/v1/object/${intent.payload.uploadBucket}/${encodedPath}`, {
    body: media.body,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${actor.accessToken}`,
      "Content-Type": media.mimeType,
      "X-CircleBites-Load-Run": runId,
      "x-upsert": "false"
    },
    method: "POST",
    parseJson: false,
    timeoutMs: 60000
  });
  if (!storage.expected) return null;
  const finalized = await apiRequest("media-finalize", actor, "/api/media/finalize-upload", {
    body: JSON.stringify({ assetId: intent.payload.assetId, uploadPath: intent.payload.uploadPath }),
    method: "POST",
    timeoutMs: 60000
  });
  if (!finalized.expected) return null;
  return {
    actor,
    assetId: intent.payload.assetId,
    durationSeconds: media.durationMs ? media.durationMs / 1000 : null,
    kind: media.kind,
    queuedAt: Date.now(),
    surface: "post",
    visibility: intendedVisibility(index)
  };
}

async function uploadAvatar(actor, index) {
  const intent = await apiRequest("avatar-media-intent", actor, "/api/mobile/review-media/upload-intent", {
    body: JSON.stringify({
      category: "avatar",
      fileName: `synthetic-avatar-${index}.jpg`,
      fileSizeBytes: imageStat.size,
      mediaKind: "image",
      mimeType: "image/jpeg"
    }),
    headers: { "Idempotency-Key": `${runId}-avatar-${index}` },
    method: "POST"
  });
  if (!intent.expected || !intent.payload?.intentId || !intent.payload?.uploadPath || !intent.payload?.uploadBucket) return;
  const encodedPath = intent.payload.uploadPath.split("/").map(encodeURIComponent).join("/");
  const storage = await timedRequest(metrics, "avatar-storage-upload", `${supabaseBase}/storage/v1/object/${intent.payload.uploadBucket}/${encodedPath}`, {
    body: imageBody,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${actor.accessToken}`,
      "Content-Type": "image/jpeg",
      "X-CircleBites-Load-Run": runId,
      "x-upsert": "false"
    },
    method: "POST",
    parseJson: false,
    timeoutMs: 60000
  });
  if (!storage.expected) return;
  const finalized = await apiRequest("avatar-media-finalize", actor, "/api/mobile/review-media/finalize-upload", {
    body: JSON.stringify({ category: "avatar", intentId: intent.payload.intentId, uploadPath: intent.payload.uploadPath }),
    method: "POST",
    timeoutMs: 60000
  });
  if (finalized.expected) avatarUploads += 1;
}

let uploadCursor = 0;
const uploaded = (await Promise.all(Array.from({ length: uploadTarget }, (_, workerIndex) => (async () => {
  const rows = [];
  while (uploadCursor < totalUploads) {
    if (safety.abortReason) break;
    const index = uploadCursor;
    uploadCursor += 1;
    rows.push(await uploadOne(actors[(index + workerIndex) % actors.length], index));
    await safety.poll();
  }
  return rows;
})()))).flat();
assets.push(...uploaded.filter(Boolean));
await Promise.all(Array.from({ length: avatarTarget }, (_, index) => uploadAvatar(actors[index % actors.length], index)));
for (const asset of assets.filter((row) => row.surface === "memory")) {
  if (asset.moderationStatus === "approved") {
    ready += 1;
    roomMediaReady += 1;
    processingDurations.push(asset.processingDuration);
  } else if (asset.moderationStatus === "rejected") {
    terminalFailures += 1;
  }
}
const processingDeadline = Date.now() + Number(argument("processing-timeout", 300)) * 1000;
const terminal = new Set(["failed", "rejected", "expired", "abandoned", "cancelled", "dead_letter"]);
async function mapBounded(items, concurrency, callback) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await callback(items[index], index);
    }
  }));
}
while (assets.length && ready + terminalFailures < assets.length && Date.now() < processingDeadline && !safety.abortReason) {
  await mapBounded(assets, uploadTarget, async (asset) => {
    if (asset.complete) return;
    const status = await apiRequest("media-status", asset.actor, `/api/media/status?ids=${asset.assetId}`);
    const row = status.payload?.assets?.[0];
    if (row?.status === "ready") {
      asset.complete = true;
      asset.status = "ready";
      ready += 1;
      processingDurations.push(Date.now() - asset.queuedAt);
    } else if (terminal.has(row?.status) || terminal.has(row?.job?.status)) {
      asset.complete = true;
      asset.status = row?.status ?? row?.job?.status;
      terminalFailures += 1;
    }
  });
  await safety.poll();
  if (ready + terminalFailures < assets.length) await new Promise((resolve) => setTimeout(resolve, 3000));
}

await mapBounded(assets.filter((asset) => asset.surface === "post" && asset.status === "ready"), uploadTarget, async (asset, index) => {
  if (safety.abortReason) return;
  const published = await apiRequest("media-post-publish", asset.actor, "/api/reviews", {
    body: JSON.stringify({
      body: `Synthetic media capacity post ${runId.slice(0, 8)}-${index}`,
      items: [{ name: asset.kind === "video" ? "Video tasting" : "Photo tasting", rating: 4 }],
      media: [{
        assetId: asset.assetId,
        ...(asset.kind === "video" ? { durationSeconds: asset.durationSeconds } : {}),
        mediaType: asset.kind
      }],
      restaurantName: `Load Media Restaurant ${index % config.seed.volumes.places}`,
      visibility: asset.visibility
    }),
    method: "POST"
  });
  if (published.expected) {
    if (asset.kind === "video") publishedVideoPosts += 1;
    else publishedImagePosts += 1;
  }
});
await safety.poll(true);

const unfinished = Math.max(0, assets.length - ready - terminalFailures);
const readyPostAssets = assets.filter((asset) => asset.surface === "post" && asset.status === "ready").length;
const metricSummary = metrics.summary();
const thresholds = config.thresholds[tier.thresholdProfile];
const thresholdFailures = [];
const uploadSamples = metrics.samples.get("storage-upload")?.map((sample) => sample.durationMs) ?? [];
if (percentile(uploadSamples, 0.95) > thresholds.mediaUploadP95Ms) thresholdFailures.push("media_upload_p95");
if (percentile(processingDurations, 0.95) > thresholds.mediaProcessingP95Ms) thresholdFailures.push("media_processing_p95");
if (metricSummary.aggregate.unexpectedErrorRate > thresholds.unexpectedErrorRate) thresholdFailures.push("media_unexpected_error_rate");
if (terminalFailures) thresholdFailures.push("media_terminal_failures");
if (unfinished) thresholdFailures.push("media_processing_timeout");
if (assets.length !== totalUploads) thresholdFailures.push(`media_uploads_missing:${assets.length}<${totalUploads}`);
if (publishedImagePosts + publishedVideoPosts !== readyPostAssets) thresholdFailures.push("media_post_publication_incomplete");
if (avatarUploads !== avatarTarget) thresholdFailures.push(`media_avatar_uploads_missing:${avatarUploads}<${avatarTarget}`);
if (safety.abortReason) thresholdFailures.push(`safety_abort:${safety.abortReason}`);
if (tierName === "launch" && totalUploads >= config.seed.volumes.mediaUploads) {
  if (roomMediaReady < config.seed.volumes.roomMedia) thresholdFailures.push("media_room_fixture_volume_below_model");
  if (publishedImagePosts < config.seed.volumes.imagePosts) thresholdFailures.push("media_image_post_volume_below_model");
  if (publishedVideoPosts < config.seed.volumes.videoPosts) thresholdFailures.push("media_video_post_volume_below_model");
}

const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  runId,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "media",
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  workload: { tier: tierName, activeActors: actors.length, concurrentUploads: uploadTarget, totalUploads, avatarUploads: avatarTarget, imagePercent: 80, shortVideoPercent: 20, roomMediaPercent: 20 },
  metrics: {
    http: metricSummary,
    intendedUploads: totalUploads,
    queuedAssets: assets.length,
    ready,
    roomMediaReady,
    publishedImagePosts,
    publishedVideoPosts,
    avatarUploads,
    terminalFailures,
    unfinished,
    uploadP95Ms: percentile(uploadSamples, 0.95),
    processingP95Ms: percentile(processingDurations, 0.95)
  },
  safetyTelemetry: safety.summary(),
  thresholds,
  thresholdFailures,
  correctness: {
    violations: terminalFailures + unfinished + Math.max(0, totalUploads - assets.length) + Math.max(0, readyPostAssets - publishedImagePosts - publishedVideoPosts) + Math.max(0, avatarTarget - avatarUploads)
  },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, "media");
console.log(JSON.stringify({ resultFile, thresholdFailures: thresholdFailures.length, status: thresholdFailures.length ? "failed" : "passed" }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
