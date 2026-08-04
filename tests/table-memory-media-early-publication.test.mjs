import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/202608040001_table_memory_media_early_publication.sql");
const terminalVisibilityMigration = source("supabase/migrations/202608040002_table_memory_media_terminal_visibility.sql");
const route = source("app/api/mobile/memories/[roomId]/media/route.ts");
const delivery = source("lib/server/memory-media-delivery.ts");
const pipeline = source("mobile/src/services/mediaPipeline.ts");
const recovery = source("mobile/src/services/mediaUploadRecovery.ts");
const memories = source("mobile/src/services/memories.ts");
const hooks = source("mobile/src/hooks/useMemories.ts");
const room = source("mobile/app/memories/[id].tsx");
const capturePreview = source("mobile/src/components/memories/camera/MediaPreviewScreen.tsx");
const camera = source("mobile/src/components/memories/camera/CameraScreen.tsx");
const worker = source("lib/server/media-pipeline.ts");

test("room media publishes one logical message and its attachments atomically before derivatives", () => {
  assert.match(migration, /create or replace function public\.attach_shared_memory_media_assets_v3/);
  assert.match(migration, /asset\.status in \('uploaded', 'processing', 'ready'\)/);
  assert.match(migration, /insert into public\.shared_memory_messages[\s\S]*?'media'/);
  assert.match(migration, /insert into public\.shared_memory_photos[\s\S]*?asset\.status/);
  assert.match(migration, /source_bucket_id = 'media-sources'/);
  assert.match(migration, /source_storage_path !~ \(/);
  assert.match(route, /admin\.rpc\("attach_shared_memory_media_assets_v3"/);
  assert.ok(
    route.indexOf('admin.rpc("attach_shared_memory_media_assets_v3"') <
      route.indexOf("responseBody = await signMemoryPhotoPayload"),
    "signing must happen only after the database transaction commits"
  );
});

test("asset completion updates the same attachment row instead of replacing it", () => {
  const syncBody = migration.match(/create or replace function public\.sync_shared_memory_photo_from_asset_v1\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(syncBody, /update public\.shared_memory_photos photo/);
  assert.match(syncBody, /where photo\.media_asset_id = new\.id/);
  assert.match(syncBody, /processing_status = 'ready'/);
  assert.doesNotMatch(syncBody, /insert into public\.shared_memory_photos|delete from public\.shared_memory_photos/);
  assert.match(room, /memoryMediaSlotViewKey/);
  assert.match(hooks, /localSlot\?\.publicUrl/);
});

test("pending images get a bounded member-scoped source preview while videos stay placeholders", () => {
  assert.match(delivery, /asset\.media_type !== "image"/);
  assert.match(delivery, /\["uploaded", "processing"\]\.includes\(asset\.status\)/);
  assert.match(delivery, /asset\.source_bucket_id !== MEDIA_SOURCE_BUCKET/);
  assert.match(delivery, /\^\(\?:image\\\/jpeg\|image\\\/png\|image\\\/webp\)\$/);
  assert.match(delivery, /admin\.storage\.from\(MEDIA_SOURCE_BUCKET\)\.createSignedUrls/);
  assert.match(delivery, /const displayUrl = canonicalUrl \?\? pendingImageUrl/);
  assert.doesNotMatch(delivery, /asset\.media_type === "video"[\s\S]{0,180}sourceUrlByPath/);
  assert.match(room, /memoryMediaHasVisual\(media\)/);
  assert.match(room, /Could not process/);
});

test("media unread and notification ownership cannot double count the container message", () => {
  assert.match(migration, /disable trigger shared_memory_messages_security_guard[\s\S]*?set activity_kind = 'media'[\s\S]*?enable trigger shared_memory_messages_security_guard/);
  assert.match(migration, /disable trigger shared_memory_photos_security_guard[\s\S]*?set processing_status = 'ready'[\s\S]*?enable trigger shared_memory_photos_security_guard/);
  assert.match(migration, /set activity_kind = 'media'[\s\S]*?photo\.message_id = message\.id/);
  assert.match(migration, /new\.activity_kind = 'media' then return new/);
  assert.match(migration, /v_kind := 'media'/);
  assert.match(migration, /message\.activity_kind = 'chat'/);
  assert.match(hooks, /const mediaContainer = row\.activity_kind === "media"/);
});

test("the mobile sender returns after durable source finalization and recovery can attach that state", () => {
  const memoryFastPath = pipeline.indexOf('if (input.surface === "memory")');
  const hostedWait = pipeline.indexOf("await waitForReadyMedia(record");
  assert.ok(memoryFastPath >= 0 && hostedWait > memoryFastPath);
  assert.match(pipeline, /processingStatus: "processing"/);
  assert.match(pipeline, /attachableStates[\s\S]*?"processing"[\s\S]*?"processing_delayed"[\s\S]*?"ready"/);
  assert.match(pipeline, /clientCreatedAt: first\.clientCreatedAt/);
  assert.match(pipeline, /clientOrderKey: first\.clientOrderKey/);
  assert.match(pipeline, /clientSequence: first\.clientSequence/);
  assert.match(recovery, /serverAttachedAt/);
  assert.match(memories, /markRecoveredMediaUploadsAttached/);
  assert.match(memories, /memory\.media_publication/);
});

test("Realtime completion drives signed refresh and the explicit UI state model", () => {
  assert.match(hooks, /if \(row\.media_asset_id && !row\.public_url\) scheduleRefresh\(\)/);
  for (const state of ["local", "uploading", "uploaded", "processing", "ready", "failed", "rejected", "cancelled"]) {
    assert.match(source("mobile/src/types/models.ts"), new RegExp(`"${state}"`));
  }
  assert.match(room, /shouldIgnoreMediaOpen\(\) \|\| !memoryMediaHasVisual/);
  assert.match(hooks, /memory\.media_realtime_delivery/);
  assert.match(room, /memory\.media_usable_render/);
  assert.match(room, /memory\.media_final_render/);
  assert.match(worker, /recordMediaWorkerEvent\("job_queued"/);
  assert.match(worker, /recordMediaWorkerEvent\("job_started"/);
  assert.match(worker, /assetHash: hashSecurityIdentifier/);
  assert.match(migration, /moderation_status, 'approved'\) in \('pending', 'rejected'\)[\s\S]*?uploader_name = public\.current_profile_name\(\)/);
});

test("video transcoding relies on the cross-version default autorotation", () => {
  assert.doesNotMatch(worker, /"-autorotate"/);
  assert.match(worker, /ffmpeg applies display-matrix rotation before -vf by default/);
});

test("video transcoding bounds decoder, filter, and encoder threads", () => {
  assert.match(worker, /MEDIA_WORKER_FFMPEG_THREADS/);
  assert.match(worker, /"-threads",\s*String\(config\.ffmpegThreads\),\s*"-filter_threads"/);
  assert.match(worker, /"-c:v",\s*"libx264",\s*"-threads",\s*String\(config\.ffmpegThreads\)/);
  assert.match(source("render.yaml"), /MEDIA_WORKER_CONCURRENCY\s*\n\s*value: "1"[\s\S]*?MEDIA_WORKER_FFMPEG_THREADS\s*\n\s*value: "1"/);
});

test("the immediate upload mapper preserves video duration", () => {
  assert.match(hooks, /function mapUploadedMemoryPhoto[\s\S]*?durationMs: photo\.duration_ms \?\? null/);
});

test("room video geometry remains stable from capture through pending publication", () => {
  assert.doesNotMatch(camera, /function videoGuideFraming[\s\S]{0,180}if \(!guideFrame\) return null/);
  assert.match(camera, /cropRect: guideFrame \? relativeCropRectForVisibleFrame/);
  assert.match(hooks, /imageHeight: mapped\.imageHeight \?\? local\.imageHeight/);
  assert.match(hooks, /imageWidth: mapped\.imageWidth \?\? local\.imageWidth/);
  assert.match(hooks, /imageHeight: imageHeight \?\? localSlot\?\.imageHeight \?\? null/);
  assert.match(memories, /const localByPosition = new Map\([\s\S]*?imageHeight: photo\.imageHeight \?\? local\.imageHeight/);
});

test("camera stop leaves recording state immediately while the preview is prepared", () => {
  assert.match(camera, /type VideoCapturePhase = "idle" \| "starting" \| "recording" \| "finalizing"/);
  assert.match(camera, /if \(recordingRef\.current && videoCapturePhaseRef\.current === "recording"\) \{[\s\S]*?updateVideoCapturePhase\("finalizing"\);[\s\S]*?stopRecording\(\)/);
  assert.match(camera, /videoFinalizing \? <Text style=\{styles\.captureBlackoutText\}>Preparing preview…<\/Text>/);
});

test("video confirmation keeps the decoded local frame until the server poster loads", () => {
  assert.match(room, /const localThumbnailCacheKey = viewKey \? `\$\{viewKey\}:local-video` : cacheKey/);
  assert.match(room, /currentFallback\?\.viewKey === viewKey[\s\S]*?currentFallback\.uri = uri/);
  assert.match(room, /const posterLoaded = Boolean\(posterUri && loadedPosterUri === posterUri\)/);
  assert.match(room, /onLoad=\{\(\) => setLoadedPosterUri\(posterUri\)\}/);
  assert.match(room, /localFallbackVisible && !posterLoaded && styles\.videoThumbnailPosterPending/);
  assert.match(room, /videoThumbnailPosterPending:\s*\{\s*opacity: 0/);
});

test("early publication persists the attachment-bearing confirmed message", () => {
  assert.match(hooks, /let confirmedMessage: MemoryMessage = \{[\s\S]*?attachments: photos\.length > 0 \? photos : localFallbackPhotos/);
  assert.match(hooks, /confirmedMessage = reconciledMessage/);
  assert.match(hooks, /commitOfflineMemoryOutboxMessage\(context\.clientId, confirmedMessage\)/);
  assert.doesNotMatch(hooks, /commitOfflineMemoryOutboxMessage\(context\.clientId, actualMessage\)/);
});

test("incremental room sync never treats a missing photo row as an empty media message", () => {
  assert.match(memories, /const attachedPhotoIds = new Set\(visibleMessages\.flatMap/);
  assert.match(memories, /visibleMessageIds\.has\(photo\.messageId\) \|\|\s*attachedPhotoIds\.has\(photo\.id\)/);
  assert.match(memories, /const currentAttachments = message\.attachments\.filter/);
  assert.match(memories, /\[\.\.\.currentAttachments, \.\.\.refreshedAttachments\]/);
  assert.match(memories, /attachments,\s*\/\/ A delta is not a full media snapshot|\/\/ A delta is not a full media snapshot[\s\S]*?attachments,/);
  assert.doesNotMatch(memories, /attachments: photosByMessageId\[message\.id\] \?\? \[\]/);
});

test("bounded Chat and Media reads retain uploader-visible terminal video rows", () => {
  assert.match(terminalVisibilityMigration, /create or replace function public\.shared_memory_chat_page/);
  assert.match(terminalVisibilityMigration, /photo\.processing_status/);
  assert.match(terminalVisibilityMigration, /photo\.processing_failure_code/);
  assert.match(terminalVisibilityMigration, /photo\.media_asset_id/);
  assert.match(terminalVisibilityMigration, /create or replace function public\.shared_memory_media_page_v1/);
  assert.match(terminalVisibilityMigration, /moderation_status, 'approved'\) in \('pending', 'rejected'\)[\s\S]*?uploader_name = v_user_name/);
  assert.match(terminalVisibilityMigration, /moderation_status, 'approved'\) in \('pending', 'rejected'\)[\s\S]*?uploader_name = viewer\.username/);
});

test("the twelve-pixel preview scrubber thumb is vertically centered", () => {
  assert.match(capturePreview, /videoTimelineThumb:\s*\{[\s\S]*?height: 12,[\s\S]*?marginTop: -6,[\s\S]*?top: "50%"/);
});
