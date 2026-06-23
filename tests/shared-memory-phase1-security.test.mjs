import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase1Migration = readFileSync(
  "mobile/supabase/migrations/202606180001_shared_memory_phase1_security.sql",
  "utf8"
);
const phase11Migration = readFileSync(
  "mobile/supabase/migrations/202606180002_shared_memory_phase1_1_cleanup.sql",
  "utf8"
);
const privacyMigration = readFileSync(
  "mobile/supabase/migrations/202606140001_shared_memory_privacy_hardening.sql",
  "utf8"
);
const finalAuditMigration = readFileSync(
  "mobile/supabase/migrations/202606180007_shared_memory_final_audit_hardening.sql",
  "utf8"
);
const occasionTitleMigration = readFileSync(
  "mobile/supabase/migrations/202606210001_shared_memory_room_occasion_title.sql",
  "utf8"
);
const occasionClassificationMigration = readFileSync(
  "mobile/supabase/migrations/202606210002_shared_memory_room_occasion_classification.sql",
  "utf8"
);
const baseMigration = readFileSync(
  "mobile/supabase/migrations/202606060001_shared_memory_rooms.sql",
  "utf8"
);
const notifyRoute = readFileSync("app/api/mobile/memories/notify/route.ts", "utf8");
const participantsRoute = readFileSync("app/api/mobile/memories/[roomId]/participants/route.ts", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const memoryRoute = readFileSync("mobile/app/memories/[id].tsx", "utf8");
const memoryLimits = readFileSync("mobile/src/constants/memoryLimits.ts", "utf8");

test("forged shared_memory_photos.storage_path with a different room_id is rejected", () => {
  assert.match(phase1Migration, /v_parts\[2\]\s*<>\s*new\.room_id::text/);
  assert.match(phase1Migration, /shared_memory_storage_path_room_mismatch/);
});

test("forged shared_memory_photos.storage_path with a different uploader is rejected", () => {
  assert.match(phase1Migration, /v_parts\[3\]\s*<>\s*new\.uploader_name/);
  assert.match(phase1Migration, /shared_memory_storage_path_uploader_mismatch/);
});

test("shared_memory_photos.message_id pointing to a message in another room is rejected", () => {
  assert.match(phase1Migration, /where message\.id = new\.message_id/);
  assert.match(phase1Migration, /v_message_room_id\s*<>\s*new\.room_id/);
  assert.match(phase1Migration, /shared_memory_photo_message_room_mismatch/);
});

test("unauthorized user cannot access media for a room they are not a member of", () => {
  assert.match(privacyMigration, /create policy "Memory members can view memory media"/);
  assert.match(privacyMigration, /bucket_id = 'memory-media'/);
  assert.match(privacyMigration, /public\.can_read_shared_memory\(public\.memory_media_room_id\(name\)\)/);
});

test("blocked user cannot send a memory message where blocked-user rules apply", () => {
  assert.match(phase1Migration, /shared_memory_room_has_blocked_relationship\(new\.room_id, new\.author_name\)/);
  assert.match(phase1Migration, /shared_memory_messages_security_guard/);
  assert.match(phase1Migration, /Block relationships prevent memory message inserts/);
});

test("blocked user cannot upload shared memory media where blocked-user rules apply", () => {
  assert.match(phase1Migration, /shared_memory_room_has_blocked_relationship\(new\.room_id, new\.uploader_name\)/);
  assert.match(phase1Migration, /shared_memory_photos_security_guard/);
  assert.match(phase1Migration, /Memory members can upload own memory media/);
});

test("blocked user cannot trigger a notification where blocked-user rules apply", () => {
  assert.match(notifyRoute, /from\("blocked_users"\)/);
  assert.match(notifyRoute, /hasBlockedRoomRelationship/);
  assert.match(notifyRoute, /return mobileJson\(\{ sent: 0 \}\)/);
});

test("blocked users cannot be added to or keep reading memory rooms", () => {
  assert.match(finalAuditMigration, /create or replace function public\.shared_memory_user_pair_blocked/);
  assert.match(finalAuditMigration, /not public\.shared_memory_room_has_blocked_relationship\(\s*target_room_id,\s*public\.current_profile_name\(\)\s*\)/);
  assert.match(finalAuditMigration, /create trigger shared_memory_members_security_guard/);
  assert.match(finalAuditMigration, /shared_memory_member_blocked_relationship/);
  assert.match(finalAuditMigration, /Block relationships prevent memory member inserts/);
  assert.match(finalAuditMigration, /not public\.shared_memory_user_pair_blocked\(v_creator, candidate\.username\)/);
  assert.match(participantsRoute, /from\("blocked_users"\)/);
  assert.match(participantsRoute, /result\.blocked/);
  assert.match(participantsRoute, /blockedTargets/);
  assert.doesNotMatch(participantsRoute, /message: `\$\{actor\.displayName\} invited you to/);
});

test("memory room occasion title keeps room creation security hardening", () => {
  assert.match(occasionTitleMigration, /drop function if exists public\.create_shared_memory_room\(text, text, text, date, uuid, text\[\]\)/);
  assert.match(occasionTitleMigration, /p_title text default null/);
  assert.match(occasionTitleMigration, /security definer\s+set search_path = public/i);
  assert.match(occasionTitleMigration, /coalesce\(left\(nullif\(btrim\(coalesce\(p_title, ''\)\), ''\), 80\), btrim\(p_restaurant_name\)\)/);
  assert.match(occasionTitleMigration, /not public\.shared_memory_user_pair_blocked\(v_creator, candidate\.username\)/);
  assert.match(occasionTitleMigration, /public\.shared_memory_user_pair_blocked\(candidate\.username, other_candidate\.username\)/);
  assert.match(occasionTitleMigration, /grant execute on function public\.create_shared_memory_room\(text, text, text, date, uuid, text\[\], text\) to authenticated/);
});

test("memory room occasion classification is member-scoped and keeps title separate", () => {
  assert.match(occasionClassificationMigration, /add column if not exists occasion_type text not null default 'unknown'/);
  assert.match(occasionClassificationMigration, /add column if not exists theme_key text not null default 'default-memory-v1'/);
  assert.match(occasionClassificationMigration, /coalesce\(nullif\(btrim\(coalesce\(p_title, ''\)\), ''\), btrim\(p_restaurant_name\)\)/);
  assert.match(occasionClassificationMigration, /p_occasion_type text default 'unknown'/);
  assert.match(occasionClassificationMigration, /p_occasion_confidence numeric default 0/);
  assert.match(occasionClassificationMigration, /security definer\s+set search_path = public/i);
  assert.match(occasionClassificationMigration, /not public\.shared_memory_user_pair_blocked\(v_creator, candidate\.username\)/);
  assert.match(occasionClassificationMigration, /create or replace function public\.update_shared_memory_room_occasion/);
  assert.match(occasionClassificationMigration, /public\.can_read_shared_memory\(p_room_id\)/);
  assert.match(occasionClassificationMigration, /public\.shared_memory_room_has_blocked_relationship\(p_room_id, v_user_name\)/);
  assert.match(occasionClassificationMigration, /grant execute on function public\.update_shared_memory_room_occasion\(uuid, text, numeric, boolean, text\) to authenticated/);
  assert.match(occasionClassificationMigration, /drop function if exists public\.shared_memory_room_summaries\(text, integer, timestamptz, uuid\)/);
});

test("text message over 1000 characters is rejected", () => {
  assert.match(baseMigration, /char_length\(body\) <= 1000/);
  assert.match(phase1Migration, /char_length\(new\.body\) > 1000/);
  assert.match(memoryLimits, /MEMORY_TEXT_MAX_LENGTH = 1000/);
  assert.match(memoryService, /assertMemoryTextLength\(trimmed\)/);
});

test("valid message under 1000 characters still works", () => {
  assert.match(phase1Migration, /if new\.body is null or char_length\(new\.body\) > 1000 then/);
  assert.doesNotMatch(phase1Migration, /char_length\(new\.body\) >= 1000/);
  assert.match(memoryRoute, /maxLength=\{MEMORY_TEXT_MAX_LENGTH\}/);
});

test("valid media row with correct room_id, uploader, message_id, and storage_path still works", () => {
  assert.match(phase1Migration, /v_parts\[1\] <> 'memories'/);
  assert.match(phase1Migration, /v_parts\[2\] <> new\.room_id::text/);
  assert.match(phase1Migration, /v_parts\[3\] <> new\.uploader_name/);
  assert.match(phase1Migration, /member\.room_id = new\.room_id/);
  assert.match(phase1Migration, /member\.user_name = new\.uploader_name/);
  assert.match(phase1Migration, /v_message_author_name <> new\.uploader_name/);
  assert.match(phase11Migration, /public_url is null or public_url = storage_path/);
});

test("memory notifications are private by default", () => {
  assert.match(notifyRoute, /MEMORY_NOTIFICATION_BODY = "You have a new memory update\."/);
  assert.match(notifyRoute, /MEMORY_NOTIFICATION_TITLE = "Table Memory"/);
  assert.match(memoryService, /body: JSON\.stringify\(\{\s+kind: input\.kind,\s+roomId: input\.roomId\s+\}\)/);
  assert.doesNotMatch(memoryService, /body: JSON\.stringify\(input\)/);
  assert.doesNotMatch(notifyRoute, /restaurant_name/);
  assert.doesNotMatch(notifyRoute, /actor\.displayName/);
  assert.doesNotMatch(notifyRoute, /body:\s*notificationBody/);
});

test("phase 1.1 preflight abort covers existing unsafe media rows", () => {
  assert.match(phase11Migration, /shared_memory_phase1_1_preflight_failed/);
  for (const violation of [
    "invalid_or_null_storage_path",
    "malformed_path_segments",
    "unsafe_path_traversal_or_characters",
    "storage_path_prefix_mismatch",
    "storage_path_room_id_mismatch",
    "storage_path_uploader_mismatch",
    "uploader_not_room_member",
    "message_id_not_found",
    "message_id_room_mismatch",
    "message_author_uploader_mismatch",
    "public_url_diverges_from_storage_path"
  ]) {
    assert.match(phase11Migration, new RegExp(violation));
  }
});

test("reply_to_message_id is DB-validated for same-room replies", () => {
  assert.match(phase11Migration, /new\.reply_to_message_id is not null/);
  assert.match(phase11Migration, /shared_memory_message_reply_not_found/);
  assert.match(phase11Migration, /v_reply_room_id\s*<>\s*new\.room_id/);
  assert.match(phase11Migration, /shared_memory_message_reply_room_mismatch/);
  assert.match(phase11Migration, /shared_memory_message_self_reply/);
});

test("null reply and same-room reply remain valid", () => {
  assert.doesNotMatch(phase11Migration, /new\.reply_to_message_id is null[\s\S]{0,120}raise exception/);
  assert.match(phase11Migration, /if v_reply_room_id <> new\.room_id then/);
  assert.match(phase11Migration, /return new;/);
});

test("arbitrary or mismatched public_url is rejected while nullable public_url is allowed", () => {
  assert.match(phase11Migration, /alter column public_url drop not null/);
  assert.match(phase11Migration, /shared_memory_photos_public_url_matches_storage_path/);
  assert.match(phase11Migration, /public_url is null or public_url = storage_path/);
  assert.match(phase11Migration, /new\.public_url is not null and new\.public_url <> new\.storage_path/);
  assert.match(phase11Migration, /shared_memory_photo_public_url_mismatch/);
  assert.doesNotMatch(memoryService, /public_url:\s*media\.storagePath/);
});

test("media display keeps using storage_path-derived signed URLs", () => {
  assert.match(memoryService, /const privatePaths = rows\s+\.map\(\(row\) => row\.storage_path\)/);
  assert.match(memoryService, /createSignedMemoryMediaUrls\(privatePaths\)/);
  assert.match(memoryService, /signedUrl \? \{ \.\.\.row, public_url: signedUrl \} : row/);
});
