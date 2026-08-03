import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootPolicy = readFileSync("lib/memory-media-policy.ts", "utf8");
const mobilePolicy = readFileSync("mobile/src/constants/memoryMediaPolicy.ts", "utf8");
const serverMedia = readFileSync("lib/server/memory-media.ts", "utf8");
const roomSecurity = readFileSync("lib/server/memory-room-security.ts", "utf8");
const uploadIntentRoute = readFileSync("app/api/mobile/memories/upload-intent/route.ts", "utf8");
const finalizeRoute = readFileSync("app/api/mobile/memories/finalize-upload/route.ts", "utf8");
const cleanupRoute = readFileSync("app/api/mobile/memories/uploads/cleanup/route.ts", "utf8");
const memoryPipeline = readFileSync("mobile/src/services/mediaPipeline.ts", "utf8");
const memoryLegacyMedia = readFileSync("mobile/src/services/memoryLegacyMedia.ts", "utf8");
const memoryMediaRoute = readFileSync("app/api/mobile/memories/[roomId]/media/route.ts", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const sharedMediaPipeline = readFileSync("lib/server/media-pipeline.ts", "utf8");
const phase2Migration = readFileSync(
  "supabase/migrations/202606180003_shared_memory_phase2_media_upload_hardening.sql",
  "utf8"
);
const phase21Migration = readFileSync(
  "supabase/migrations/202606180004_shared_memory_phase2_1_trust_boundary.sql",
  "utf8"
);
const phase22Migration = readFileSync(
  "supabase/migrations/202606180005_shared_memory_phase2_2_cleanup_verification.sql",
  "utf8"
);
const finalAuditMigration = readFileSync(
  "supabase/migrations/202606180007_shared_memory_final_audit_hardening.sql",
  "utf8"
);
const audioMessagesMigration = readFileSync(
  "supabase/migrations/202607030001_shared_memory_audio_messages.sql",
  "utf8"
);
const supabaseReadme = readFileSync("docs/database/MIGRATIONS.md", "utf8");

test("root and mobile media policy constants stay in sync", () => {
  for (const constant of [
    "MEMORY_IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024",
    "MEMORY_IMAGE_TARGET_COMPRESSED_BYTES = 2 * 1024 * 1024",
    "MEMORY_IMAGE_MAX_RESOLUTION = 4096",
    "MEMORY_IMAGE_THUMBNAIL_WIDTH = 512",
    "MEMORY_VIDEO_MAX_UPLOAD_BYTES = 20 * 1024 * 1024",
    "MEMORY_VIDEO_MAX_DURATION_MS = 60_000",
    "MEMORY_AUDIO_MAX_UPLOAD_BYTES = 8 * 1024 * 1024",
    "MEMORY_AUDIO_MAX_DURATION_MS = 60_000",
    "MEMORY_MEDIA_MAX_ITEMS = 4"
  ]) {
    assert.match(rootPolicy, new RegExp(constant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(mobilePolicy, new RegExp(constant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("upload intent validates auth, membership, blocked users, kind, MIME, extension, and size", () => {
  assert.match(uploadIntentRoute, /getRouteActor\(req\)/);
  assert.match(uploadIntentRoute, /if \(!actor\)/);
  assert.match(uploadIntentRoute, /normalizeMemoryMediaIntentInput/);
  assert.match(serverMedia, /memory_media_kind_invalid/);
  assert.match(serverMedia, /memory_media_mime_type_not_allowed/);
  assert.match(serverMedia, /memory_media_extension_not_allowed/);
  assert.match(serverMedia, /memory_media_file_too_large/);
  assert.match(serverMedia, /memory_media_duration_too_long/);
  assert.match(roomSecurity, /shared_memory_members/);
  assert.match(roomSecurity, /blocked_users/);
  assert.match(roomSecurity, /MemoryRoomBlockedRelationship/);
});

test("valid image, video, and audio intents return immutable user-id storage paths", () => {
  assert.match(serverMedia, /memories\/\$\{roomId\}\/\$\{userId\}\/\$\{intentId\}\/media\.\$\{safeExtension\}/);
  assert.match(uploadIntentRoute, /userId: actor\.userId/);
  assert.match(uploadIntentRoute, /storagePath/);
  assert.match(serverMedia, /acceptedMimeTypes/);
  assert.match(serverMedia, /maxAllowedSize/);
  assert.match(rootPolicy, /MEMORY_ALLOWED_IMAGE_MIME_TYPES = \["image\/jpeg", "image\/png", "image\/webp"\]/);
  assert.match(rootPolicy, /MEMORY_ALLOWED_VIDEO_MIME_TYPES = \["video\/mp4", "video\/quicktime", "video\/webm"\]/);
  assert.match(rootPolicy, /MEMORY_ALLOWED_AUDIO_MIME_TYPES = \["audio\/mp4", "audio\/x-m4a"\]/);
  assert.match(audioMessagesMigration, /check \(media_type in \('audio', 'image', 'video'\)\)/);
  assert.match(audioMessagesMigration, /'audio\/mp4'/);
});

test("audio finalization requires an audio-only MP4 track before approval", () => {
  assert.match(serverMedia, /function detectMp4TrackKinds/);
  assert.match(serverMedia, /tracks\.hasAudio && !tracks\.hasVideo/);
  assert.match(serverMedia, /handlerType === "soun"/);
  assert.match(serverMedia, /handlerType === "vide"/);
  assert.match(serverMedia, /if \(kind === "audio"\) return \{ status: "approved" \}/);
});

test("storage upload policy requires an active upload intent", () => {
  assert.match(phase2Migration, /create table if not exists public\.shared_memory_upload_intents/);
  assert.match(phase2Migration, /memory_upload_intent_allows_object/);
  assert.match(phase2Migration, /intent\.storage_path = object_name/);
  assert.match(phase2Migration, /intent\.uploader_id = auth\.uid\(\)/);
  assert.match(phase2Migration, /intent\.status = 'created'/);
  assert.match(phase2Migration, /intent\.expires_at > now\(\)/);
  assert.match(phase2Migration, /public\.memory_upload_intent_allows_object\(name\)/);
});

test("finalize rejects wrong user, wrong room, expired intent, missing object, oversized object, MIME mismatch, path mismatch, and fake bytes", () => {
  assert.match(finalizeRoute, /intent\.uploader_id !== actor\.userId/);
  assert.match(finalizeRoute, /intent\.room_id !== roomId/);
  assert.match(finalizeRoute, /Upload path does not match intent/);
  assert.match(finalizeRoute, /intent\.status !== "created"/);
  assert.match(finalizeRoute, /Upload intent expired/);
  assert.match(finalizeRoute, /Uploaded object not found/);
  assert.match(finalizeRoute, /Uploaded object is too large/);
  assert.match(finalizeRoute, /Uploaded object size does not match intent/);
  assert.match(finalizeRoute, /Uploaded object MIME type does not match intent/);
  assert.match(finalizeRoute, /validateDetectedMemoryMedia/);
  assert.match(serverMedia, /detectMemoryMediaSignature/);
});

test("finalize tolerates optional storage metadata schema being unavailable", () => {
  assert.match(finalizeRoute, /isStorageMetadataUnavailable/);
  assert.match(finalizeRoute, /PGRST106/);
  assert.match(finalizeRoute, /Invalid schema:\\s\*storage/);
  assert.match(finalizeRoute, /return null/);
});

test("finalize creates media rows server-side without trusting client room path or public_url", () => {
  assert.match(finalizeRoute, /\.rpc\("finalize_shared_memory_upload_intent"/);
  assert.match(finalAuditMigration, /public_url,[\s\S]*values \([\s\S]*null,\s+v_intent\.room_id/);
  assert.match(finalAuditMigration, /v_intent\.storage_path/);
  assert.match(finalAuditMigration, /v_intent\.id,\s+v_intent\.uploader_id,\s+v_intent\.uploader_name/);
  assert.doesNotMatch(finalizeRoute, /storage_path:\s*body/);
  assert.doesNotMatch(finalizeRoute, /public_url:\s*body/);
});

test("table memory room media skips the mature-content check, and only that", () => {
  // Product decision: a table memory room is private to its members, so its
  // media is NOT screened for mature content — that check belongs to the public
  // post flow. Both memory upload paths are exempt.
  assert.doesNotMatch(finalizeRoute, /await moderateMemoryMediaBuffer\(/);
  assert.match(sharedMediaPipeline, /asset\.surface === "memory"\s*\n?\s*\? \{ status: "approved" \}/);
  // Exempt, never left pending: the attach RPC and the media_assets trigger
  // both require `moderation_status = 'approved'`, so a skipped asset that
  // stayed pending would silently never reach the room.
  assert.doesNotMatch(sharedMediaPipeline, /asset\.surface === "memory"[\s\S]{0,120}status: "pending"/);
  // Every other surface still goes through the provider.
  assert.match(sharedMediaPipeline, /:\s*await moderateMemoryMediaBuffer\(/);
  assert.match(
    readFileSync("app/api/mobile/review-media/finalize-upload/route.ts", "utf8"),
    /await moderateImageContent\(/
  );
});

test("pending moderation is fail-closed for other room members", () => {
  // Still load-bearing after the exemption above: a photo can be pending from
  // an operator action or a legacy row, and must stay invisible to everyone
  // except whoever uploaded it.
  assert.match(serverMedia, /moderation_provider_not_configured/);
  assert.match(serverMedia, /status: "pending"/);
  assert.match(phase2Migration, /coalesce\(photo\.moderation_status, 'approved'\) = 'approved'/);
  assert.match(phase2Migration, /coalesce\(photo\.moderation_status, 'approved'\) = 'pending'[\s\S]*photo\.uploader_name = public\.current_profile_name\(\)/);
  assert.match(phase2Migration, /public\.can_read_memory_media_object\(name\)/);
});

test("cleanup is protected and transitions DB state before deleting storage", () => {
  assert.match(cleanupRoute, /MEMORY_UPLOAD_CLEANUP_SECRET/);
  assert.match(cleanupRoute, /x-cleanup-secret/);
  assert.match(cleanupRoute, /\.eq\("status", "created"\)/);
  assert.match(cleanupRoute, /\.lt\("expires_at", now\)/);
  assert.match(cleanupRoute, /\.rpc\("cleanup_shared_memory_media"/);
  assert.match(cleanupRoute, /if \(cleanupError\)/);
  assert.match(cleanupRoute, /Could not transition cleanup candidates/);
  assert.match(cleanupRoute, /storage\.from\(MEMORY_MEDIA_BUCKET\)\.remove\(storagePaths\)/);
  assert.ok(
    cleanupRoute.indexOf('.rpc("cleanup_shared_memory_media"') <
      cleanupRoute.indexOf("storage.from(MEMORY_MEDIA_BUCKET).remove(storagePaths)"),
    "cleanup must transition DB state before deleting storage"
  );
  assert.match(cleanupRoute, /\.eq\("moderation_status", "pending"\)/);
  assert.match(cleanupRoute, /skippedExpiredIntents/);
  assert.match(cleanupRoute, /skippedPendingMedia/);
  assert.match(cleanupRoute, /storageDeleteFailures/);
  assert.doesNotMatch(cleanupRoute, /protectedStoragePaths/);
  assert.doesNotMatch(cleanupRoute, /\.from\("shared_memory_photos"\)[\s\S]{0,260}\.update\(/);
  assert.doesNotMatch(cleanupRoute, /\.from\("shared_memory_upload_intents"\)[\s\S]{0,260}\.update\(/);
  assert.doesNotMatch(cleanupRoute, /console\./);
  assert.doesNotMatch(cleanupRoute, /signedUrl|public_url|media_url|caption|message body/i);
});

test("mobile uses the shared processed pipeline for room image/video and keeps legacy finalization only for audio", () => {
  assert.match(memoryPipeline, /surface:\s*"memory"/);
  assert.match(memoryPipeline, /accessClass:\s*"memory_private"/);
  assert.match(memoryPipeline, /\/api\/media\/upload-intent/);
  assert.match(memoryPipeline, /\/api\/media\/finalize-upload/);
  assert.match(memoryService, /uploadMemoryMediaAsset/);
  assert.match(memoryMediaRoute, /attach_shared_memory_media_assets_v2/);
  assert.match(memoryMediaRoute, /SAFE_MEDIA_FAILURE_LABEL/);
  assert.match(memoryMediaRoute, /memory_media_attach_failed/);
  assert.match(memoryMediaRoute, /failure_reason: failureReason/);
  assert.doesNotMatch(memoryMediaRoute, /failure_reason:\s*message/);
  assert.match(memoryLegacyMedia, /\/api\/mobile\/memories\/upload-intent/);
  assert.match(memoryLegacyMedia, /\/api\/mobile\/memories\/finalize-upload/);
  assert.doesNotMatch(memoryService, /\.from\("shared_memory_photos"\)[\s\S]{0,260}\.insert\(uploadResults\.map/);
});

test("old username paths remain compatible while new user-id paths are allowed", () => {
  assert.match(phase2Migration, /v_parts\[3\] <> new\.uploader_name/);
  assert.match(phase2Migration, /v_parts\[3\] <> new\.uploader_id::text/);
  assert.match(phase2Migration, /v_profile_username is distinct from new\.uploader_name/);
  assert.match(phase2Migration, /storage_path ~ \('\^memories\/' \|\| room_id::text \|\| '\/' \|\| uploader_id::text/);
});

test("phase 2.1 removes authenticated shared_memory_photos insert finalization", () => {
  assert.match(phase21Migration, /drop policy if exists "Upload intents finalize memory photos" on public\.shared_memory_photos/);
  assert.match(phase21Migration, /drop policy if exists "Room members can add photos" on public\.shared_memory_photos/);
  assert.doesNotMatch(phase21Migration, /create policy "Upload intents finalize memory photos"/);
  assert.doesNotMatch(phase21Migration, /on public\.shared_memory_photos for insert to authenticated/);
});

test("phase 2.1 enforces one-use upload_intent_id and storage_path", () => {
  assert.match(phase21Migration, /shared_memory_phase2_1_preflight_failed:[\s\S]*duplicate upload_intent_id/);
  assert.match(phase21Migration, /shared_memory_phase2_1_preflight_failed:[\s\S]*duplicate storage_path/);
  assert.match(phase21Migration, /create unique index if not exists shared_memory_photos_upload_intent_unique_idx/);
  assert.match(phase21Migration, /on public\.shared_memory_photos\(upload_intent_id\)[\s\S]*where upload_intent_id is not null/);
  assert.match(phase21Migration, /create unique index if not exists shared_memory_photos_storage_path_unique_idx/);
  assert.match(phase21Migration, /on public\.shared_memory_photos\(storage_path\)/);
});

test("media row metadata must exactly match finalized upload intent", () => {
  assert.match(phase21Migration, /v_intent\.status <> 'finalized'/);
  assert.match(phase21Migration, /v_intent\.mime_type is distinct from new\.mime_type/);
  assert.match(phase21Migration, /v_intent\.file_size_bytes is distinct from new\.file_size_bytes/);
  assert.match(phase21Migration, /v_intent\.moderation_status is distinct from new\.moderation_status/);
  assert.match(phase21Migration, /v_intent\.moderation_reason is distinct from new\.moderation_reason/);
  assert.match(phase21Migration, /shared_memory_photo_approved_without_moderation_time/);
});

test("finalize is the only approval path and repeat calls return the existing row", () => {
  assert.match(finalizeRoute, /existingPhotoForIntent/);
  assert.match(finalizeRoute, /\.rpc\("finalize_shared_memory_upload_intent"/);
  assert.match(finalizeRoute, /intent\.status === "finalized" && existingPhoto/);
  assert.match(finalizeRoute, /Upload intent already has mismatched media/);
  assert.match(finalAuditMigration, /create or replace function public\.finalize_shared_memory_upload_intent/);
  assert.match(finalAuditMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(finalAuditMigration, /for update/);
  assert.match(finalAuditMigration, /status = 'finalized'[\s\S]*insert into public\.shared_memory_photos/);
  assert.match(finalAuditMigration, /revoke all on function public\.finalize_shared_memory_upload_intent[\s\S]*from authenticated/);
});

test("app video limits stay at 20 MB beneath the conservative 25 MB storage ceiling", () => {
  assert.match(rootPolicy, /MEMORY_VIDEO_MAX_UPLOAD_BYTES = 20 \* 1024 \* 1024/);
  assert.match(mobilePolicy, /MEMORY_VIDEO_MAX_UPLOAD_BYTES = 20 \* 1024 \* 1024/);
  assert.match(phase21Migration, /26214400/);
  assert.doesNotMatch(phase21Migration, /image\/gif/);
});

test("phase 2.2 cleanup RPC is service-role only and protects valid referenced media", () => {
  assert.match(phase22Migration, /create or replace function public\.cleanup_shared_memory_media/);
  assert.match(phase22Migration, /security definer[\s\S]*set search_path = public/);
  assert.match(phase22Migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(phase22Migration, /revoke all on function public\.cleanup_shared_memory_media[\s\S]*from authenticated/);
  assert.match(phase22Migration, /grant execute on function public\.cleanup_shared_memory_media[\s\S]*to service_role/);
  assert.match(phase22Migration, /coalesce\(photo\.moderation_status, 'approved'\) not in \('pending', 'rejected'\)/);
  assert.match(phase22Migration, /coalesce\(other_photo\.moderation_status, 'approved'\) not in \('pending', 'rejected'\)/);
  assert.match(phase22Migration, /set moderation_status = 'rejected',\s+moderation_reason = p_pending_reason/);
  assert.match(phase22Migration, /intent\.status = 'finalized'/);
  assert.doesNotMatch(phase22Migration, /set\s+status\s*=\s*'rejected'/);
});

test("phase 2.2 adds service-role room and account media sweep helpers without username-only deletion", () => {
  const helperMigrations = `${phase22Migration}\n${finalAuditMigration}`;
  assert.match(helperMigrations, /create or replace function public\.shared_memory_room_media_paths/);
  assert.match(helperMigrations, /photo\.room_id = p_room_id/);
  assert.match(helperMigrations, /photo\.storage_path like \('memories\/' \|\| p_room_id::text \|\| '\/%'\)/);
  assert.match(helperMigrations, /create or replace function public\.shared_memory_account_media_paths/);
  assert.match(helperMigrations, /photo\.uploader_id = (profile\.id|p_user_id)/);
  assert.match(helperMigrations, /photo\.upload_intent_id is not null/);
  assert.match(helperMigrations, /grant execute on function public\.shared_memory_room_media_paths[\s\S]*to service_role/);
  assert.match(helperMigrations, /grant execute on function public\.shared_memory_account_media_paths[\s\S]*to service_role/);
  assert.match(finalAuditMigration, /DB-backed legacy username paths/);
  assert.match(finalAuditMigration, /profile\.id = p_user_id/);
});

test("phase 2.2 docs include Supabase staging and manual verification steps", () => {
  assert.match(supabaseReadme, /202606180005_shared_memory_phase2_2_cleanup_verification\.sql/);
  assert.match(supabaseReadme, /Manual Phase 2\.2 staging verification/);
  assert.match(supabaseReadme, /supabase(?:@2\.109\.1)? db push/);
  assert.match(supabaseReadme, /Direct authenticated client insert must still fail with RLS/i);
  assert.match(supabaseReadme, /Duplicate upload_intent_id and duplicate storage_path must fail/i);
  assert.match(supabaseReadme, /Pending media visibility must be checked with real authenticated users/i);
  assert.match(supabaseReadme, /Storage object read\/write must be checked with real authenticated users/i);
  assert.match(supabaseReadme, /Cleanup safety/i);
  assert.match(supabaseReadme, /shared_memory_room_media_paths/);
  assert.match(supabaseReadme, /shared_memory_account_media_paths/);
  assert.match(supabaseReadme, /Rollback for `202606180005_shared_memory_phase2_2_cleanup_verification\.sql`/);
});
