import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Phase 5 inventories every primary screen with bounded budgets", async () => {
  const budget = JSON.parse(await read("config/backend-performance-budgets.json"));
  assert.equal(budget.screens.length, 17);
  for (const screen of budget.screens) {
    assert.ok(screen.networkRequests <= 2);
    assert.ok(screen.databaseStatements <= 6);
    assert.ok(screen.pageSize <= 50);
    assert.ok(screen.payloadBytes <= 256 * 1024);
    assert.notEqual(screen.pagination, "offset");
  }
});

test("feed cards never issue a card-mounted Taste/Trust query", async () => {
  const source = await read("mobile/src/components/posts/PostCard.tsx");
  assert.match(source, /enabled:\s*loadDetailEngagement/);
  assert.match(source, /loadDetailEngagement\?: boolean/);
});

test("active mobile feeds are consolidated and contain no broad scanner", async () => {
  const source = await read("mobile/src/services/feeds.ts");
  assert.match(source, /\/api\/mobile\/feed/);
  assert.doesNotMatch(source, /DISH_SCAN_SIZE|PUBLIC_REVIEW_BATCH_SIZE|RESTAURANT_SCAN_SIZE|\.range\(/);
});

test("Explore requires v3 and has no production broad-fallback switch", async () => {
  const [source, sql] = await Promise.all([
    read("mobile/src/services/exploreDiscovery.ts"),
    read("supabase/migrations/202607130009_backend_feed_performance.sql")
  ]);
  assert.match(source, /explore_discovery_canonical_v3/);
  assert.doesNotMatch(source, /EXPO_PUBLIC_CANONICAL_EXPLORE/);
  assert.doesNotMatch(source, /catch\s*\([^)]*\)\s*\{[\s\S]{0,600}getExploreFeed/);
  assert.match(sql, /explore_discovery_canonical_v3[\s\S]*security definer/i);
  assert.match(sql, /explore_discovery_canonical_v3[\s\S]*blocked_users/i);
  assert.match(sql, /from viewer;[\s\S]*grant execute on function public\.explore_discovery_canonical_v3/i);
});

test("Profile shell does not own the first posts page", async () => {
  const [service, route] = await Promise.all([
    read("mobile/src/services/profiles.ts"),
    read("app/api/mobile/profile/shell/route.ts")
  ]);
  assert.match(service, /getCurrentProfilePage[\s\S]{0,300}\/api\/mobile\/profile\/shell/);
  assert.match(service, /getProfilePostsPage[\s\S]{0,800}scope:\s*"profile"/);
  assert.doesNotMatch(route, /posts:\s*\[\]/);
  assert.doesNotMatch(route, /nextPostsCursor/);
});

test("comments and notifications own cursor pages and aggregate counts", async () => {
  const [comments, notifications, unread] = await Promise.all([
    read("app/api/comments/route.ts"),
    read("app/api/notifications/route.ts"),
    read("app/api/notifications/unread-count/route.ts")
  ]);
  assert.match(comments, /nextCursor/);
  assert.match(comments, /count:\s*"exact"/);
  assert.match(notifications, /nextCursor/);
  assert.match(notifications, /head:\s*true/);
  assert.match(unread, /head:\s*true/);
});

test("Memory uses one bounded contract per active read path", async () => {
  const [source, route] = await Promise.all([
    read("mobile/src/services/memories.ts"),
    read("app/api/mobile/memories/read/route.ts")
  ]);
  assert.match(source, /\/api\/mobile\/memories\/read/);
  for (const name of [
    "shared_memory_room_summaries_v3",
    "shared_memory_room_bootstrap_v2",
    "shared_memory_room_sync_v2",
    "shared_memory_chat_page_v2",
    "shared_memory_media_page_v1"
  ]) {
    assert.match(route, new RegExp(name));
  }
  assert.doesNotMatch(source, /for\s*\([^)]*room[^)]*\)\s*\{[\s\S]{0,400}supabase\./);
  assert.match(route, /signMemoryPhotoPayload/);
  assert.doesNotMatch(route, /\.select\("[^"]*storage_path/);
});

test("Phase 5 SQL has stable cursor indexes and service-only feed grants", async () => {
  const sql = await read("supabase/migrations/202607130009_backend_feed_performance.sql");
  for (const name of ["circle_feed_page_v2", "mobile_public_feed_page_v1", "mobile_post_engagement_v1", "shared_memory_room_summaries_v2", "shared_memory_media_page_v1", "reconcile_phase5_projections"]) {
    assert.match(sql, new RegExp(name));
  }
  assert.match(sql, /revoke all on function public\.circle_feed_page_v2[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.circle_feed_page_v2[\s\S]*to service_role/i);
  assert.match(sql, /created_at desc, id desc/i);
  assert.match(sql, /jsonb_agg\(to_jsonb\(selected\) - 'storage_path' - 'public_url'/i);
  assert.doesNotMatch(sql, /page_photos as \([\s\S]{0,900}photo\.storage_path/i);
});

test("memory history paging speaks one cursor format on both sides", async () => {
  const route = await read("app/api/mobile/memories/read/route.ts");
  const cursor = await read("mobile/src/services/memoryPageCursor.ts");
  const offlineStore = await read("mobile/src/services/memoryOfflineStore.ts");
  const screen = await read("mobile/app/memories/[id].tsx");

  // The bug: the client seeded "load older" with the oldest row's raw
  // createdAt, the route base64url-decodes and JSON.parses whatever arrives, so
  // every network page past the SQLite cache came back 400 "Invalid cursor" and
  // the server's own (correctly encoded) nextCursor never arrived to unblock
  // the rest. Chat history simply could not page beyond what was on disk.
  assert.match(cursor, /export function encodeMemoryPageCursor\(/);
  assert.match(cursor, /btoa\(JSON\.stringify\(\{ createdAt, id \}\)\)/);
  assert.match(cursor, /\.replace\(\/\\\+\/g, "-"\)/);
  assert.match(cursor, /\.replace\(\/=\+\$\/, ""\)/);

  // The anchor must be a message the server knows about: the cursor id has to
  // be a UUID, and the server paginates on ITS created_at, not the client
  // timestamp the list is ordered by.
  assert.match(cursor, /export function memoryHistoryCursorFromMessages\(/);
  assert.match(cursor, /const id = memoryMessageServerId\(message\);/);
  assert.match(cursor, /return id && createdAt \? encodeMemoryPageCursor\(createdAt, id\) : null;/);
  assert.match(screen, /olderMessagesAnchorRef\.current\.cursor = memoryHistoryCursorFromMessages\(/);
  assert.doesNotMatch(screen, /cursor = room\.data\?\.messages\[0\]\?\.createdAt/);

  // Everything the client emits has to be API-shaped, including pages served
  // from SQLite: React Query hands a page's nextCursor straight back as the
  // next request, which may be answered by the network even though the previous
  // page was not. Emitting the legacy pair there is what stranded history at
  // the cache boundary.
  // ONE definition, imported by both the network layer and the offline store.
  // Two copies is how this broke: the offline reader emitted the legacy pair
  // while the API layer emitted the opaque form.
  assert.doesNotMatch(offlineStore, /function encodeMemoryPageCursor\(/);
  assert.match(offlineStore, /from "@\/services\/memoryPageCursor"/);
  assert.match(offlineStore, /nextCursor: memoryPageCursorFromMessage\(messages\[0\]\)/);
  // ...and it has to READ every shape it has ever written, since old cursors
  // are already sitting in SQLite.
  assert.match(cursor, /function decodeOpaqueCursor\(cursor: string\)/);
  assert.match(cursor, /if \(cursor\.includes\(MEMORY_PAGE_CURSOR_SEPARATOR\)\) return null;/);
  assert.match(cursor, /const opaque = decodeOpaqueCursor\(cursor\);\s*if \(opaque\) return opaque;/);

  // Installs already in the wild keep sending the legacy shapes and cannot be
  // fixed retroactively, so the route accepts both rather than 400ing them
  // forever: the `createdAt|uuid` pair its offline reader emits, and a bare
  // timestamp from the oldest seeds.
  assert.match(route, /function resolveMemoryReadCursor\(raw: string \| null\)/);
  assert.match(route, /const stable = decodeStableTimestampCursor\(raw\);\s*if \(stable\) return stable;/);
  assert.match(route, /LEGACY_CURSOR_UUID\.test\(id\)/);
  assert.match(route, /return \{ createdAt: new Date\(parsedPair\)\.toISOString\(\), id \};/);
  assert.match(route, /return \{ createdAt: new Date\(parsed\)\.toISOString\(\), id: null \};/);
  assert.match(route, /const cursor = resolveMemoryReadCursor\(rawCursor\);/);
  // Every RPC behind this route already treats the id as an optional
  // tie-breaker, which is what makes the degraded cursor safe.
  assert.match(route, /p_before_message_id: cursor\?\.id \?\? null/);
});
