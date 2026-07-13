import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase3Migration = readFileSync(
  "supabase/migrations/202606180006_shared_memory_phase3_scalability.sql",
  "utf8"
);
const finalAuditMigration = readFileSync(
  "supabase/migrations/202606180007_shared_memory_final_audit_hardening.sql",
  "utf8"
);
const chatPageMigration = readFileSync(
  "supabase/migrations/202607050001_shared_memory_chat_page_rpc.sql",
  "utf8"
);
const phase5Migration = readFileSync(
  "supabase/migrations/202607130009_backend_feed_performance.sql",
  "utf8"
);
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const memoryReadRoute = readFileSync("app/api/mobile/memories/read/route.ts", "utf8");
const supabaseReadme = readFileSync("docs/database/MIGRATIONS.md", "utf8");
const summaryMigrations = `${phase3Migration}\n${finalAuditMigration}`;

test("phase 3 adds indexes for common memory room queries", () => {
  for (const expected of [
    "shared_memory_messages_room_created_id_desc_idx",
    "shared_memory_messages_room_reply_idx",
    "shared_memory_photos_room_message_position_idx",
    "shared_memory_photos_room_visible_created_idx",
    "shared_memory_members_user_room_idx",
    "shared_memory_rooms_created_id_desc_idx",
    "shared_memory_reads_user_room_idx"
  ]) {
    assert.match(phase3Migration, new RegExp(expected));
  }
});

test("phase 3 room summary RPC is bounded, member scoped, and search_path safe", () => {
  assert.match(summaryMigrations, /create or replace function public\.shared_memory_room_summaries/);
  assert.match(summaryMigrations, /security definer[\s\S]*set search_path = public/);
  assert.match(summaryMigrations, /least\(greatest\(coalesce\(p_limit, 100\), 1\), 100\)/);
  assert.match(summaryMigrations, /auth\.role\(\) <> 'service_role'/);
  assert.match(summaryMigrations, /v_user_name is distinct from v_current_user_name/);
  assert.match(summaryMigrations, /join public\.shared_memory_members[\s\S]*user_name = v_user_name/);
  assert.match(summaryMigrations, /coalesce\(photo\.moderation_status, 'approved'\) = 'approved'/);
  assert.match(summaryMigrations, /photo\.uploader_name = v_user_name/);
  assert.match(summaryMigrations, /grant execute on function public\.shared_memory_room_summaries[\s\S]*to authenticated, service_role/);
  assert.match(summaryMigrations, /revoke all on function public\.shared_memory_room_summaries[\s\S]*from anon/);
  assert.match(finalAuditMigration, /paged_rooms as/);
  assert.ok(
    finalAuditMigration.indexOf("paged_rooms as") <
      finalAuditMigration.indexOf("member_counts"),
    "room summary counts must run after pagination"
  );
  assert.match(finalAuditMigration, /not public\.shared_memory_room_has_blocked_relationship\(room\.id, v_user_name\)/);
});

test("mobile memory list requires one bounded v2 summary contract without legacy fallback", () => {
  assert.match(memoryReadRoute, /\.rpc\("shared_memory_room_summaries_v2"/);
  assert.match(memoryReadRoute, /p_before_activity_at: cursor\?\.createdAt \?\? null/);
  assert.match(memoryReadRoute, /p_before_room_id: cursor\?\.id \?\? null/);
  assert.match(memoryService, /MEMORY_ROOM_SUMMARY_PAGE_SIZE/);
  assert.match(memoryService, /mapMemorySummaryRow/);
  assert.match(memoryService, /\/api\/mobile\/memories\/read\?action=rooms/);

  const listMemoryRoomsBody = memoryService.match(/export async function listMemoryRooms\(\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(listMemoryRoomsBody, /from\("shared_memory_messages"\)[\s\S]*\.in\("room_id", roomIds\)/);
  assert.doesNotMatch(listMemoryRoomsBody, /from\("shared_memory_photos"\)[\s\S]*\.in\("room_id", roomIds\)/);
});

test("mobile chat and media pagination use id tie-breaker cursors", () => {
  assert.match(memoryService, /encodeMemoryPageCursor/);
  assert.match(memoryService, /parseMemoryPageCursor/);
  assert.match(memoryService, /created_at\.lt\.\$\{cursor\.createdAt\},and\(created_at\.eq\.\$\{cursor\.createdAt\},id\.lt\.\$\{cursor\.id\}\)/);
  assert.match(memoryService, /\.order\("created_at", \{ ascending: false \}\)\s+\.order\("id", \{ ascending: false \}\)/);
});

test("phase 2 chat page RPC is bounded, member scoped, and mobile preferred", () => {
  const activeChatMigration = `${chatPageMigration}\n${phase5Migration}`;
  assert.match(phase5Migration, /create or replace function public\.shared_memory_chat_page/);
  assert.match(phase5Migration, /security definer[\s\S]*set search_path = public/);
  assert.match(phase5Migration, /least\(greatest\(coalesce\(p_limit, 50\), 1\), 100\)/);
  assert.match(phase5Migration, /not public\.can_read_shared_memory\(p_room_id\)/);
  assert.match(phase5Migration, /limit \(v_limit \+ 1\)/);
  assert.match(phase5Migration, /message\.created_at < p_before_created_at/);
  assert.match(phase5Migration, /message\.id < p_before_message_id/);
  assert.match(phase5Migration, /coalesce\(photo\.moderation_status, 'approved'\) = 'approved'/);
  assert.match(phase5Migration, /photo\.uploader_name = v_user_name/);
  assert.match(phase5Migration, /'replyMessages'/);
  assert.match(phase5Migration, /'profiles'/);
  assert.match(activeChatMigration, /revoke all on function public\.shared_memory_chat_page[\s\S]*from anon/);
  assert.match(activeChatMigration, /grant execute on function public\.shared_memory_chat_page[\s\S]*to authenticated, service_role/);

  assert.match(memoryReadRoute, /\.rpc\("shared_memory_chat_page"/);
  assert.match(memoryService, /fetchMemoryMessagePageBundle/);
  assert.match(memoryService, /return fetchMemoryMessagePageViaRpc\(\{ before, limit, roomId \}\)/);
  assert.match(memoryService, /\/api\/mobile\/memories\/read\?\$\{params\.toString\(\)\}/);
  assert.doesNotMatch(
    memoryService.match(/export async function getMemoryMessagesPage[\s\S]*?\n}/)?.[0] ?? "",
    /assertMemoryRoomMember/
  );
});

test("phase 3 docs mention the summary RPC rollout and verification", () => {
  assert.match(supabaseReadme, /202606180006_shared_memory_phase3_scalability\.sql/);
  assert.match(supabaseReadme, /shared_memory_room_summaries/);
  assert.match(supabaseReadme, /bounded room summaries/i);
  assert.match(supabaseReadme, /Phase 3 scalability verification/i);
});
