import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const list = read("app/api/notifications/route.ts");
const unread = read("app/api/notifications/unread-count/route.ts");
const hasUnread = read("app/api/notifications/has-unread/route.ts");
const seen = read("app/api/notifications/seen/route.ts");
const readOne = read("app/api/notifications/[notificationId]/read/route.ts");
const readAll = read("app/api/notifications/read-all/route.ts");
const remove = read("app/api/notifications/[notificationId]/route.ts");
const migration = read("supabase/migrations/202607130009_backend_feed_performance.sql");
const seenMigration = read("supabase/migrations/202607210001_notification_inbox_seen_state.sql");
const unseenIndexMigration = read("supabase/migrations/202607210004_notification_unseen_indexes.sql");

test("notification list resolves the canonical actor and never trusts a recipient input", () => {
  assert.match(list, /getNotificationRouteContext/);
  assert.match(list, /viewer\.id/);
  assert.match(list, /viewer\.name/);
  assert.doesNotMatch(list, /searchParams\.get\(["']recipient/);
});

test("notification list is a bounded stable cursor page", () => {
  assert.match(list, /searchParams\.get\("limit"\) \?\? 30/);
  assert.match(list, /decodeStableTimestampCursor/);
  assert.match(list, /encodeStableTimestampCursor/);
  assert.match(list, /Math\.min\(Math\.max\([\s\S]*1\), 50\)/);
  assert.match(list, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(list, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(list, /nextCursor/);
});

test("notification list consolidates list and unread count into one response", () => {
  assert.match(list, /Promise\.all/);
  assert.match(list, /unreadCount/);
  assert.match(list, /head:\s*true/);
  assert.doesNotMatch(list, /LEGACY_NOTIFICATION_SELECT/);
});

test("notification list batches actor display names and public avatar URLs", () => {
  assert.match(list, /select\("id, username, first_name, last_name, avatar_url"\)/);
  assert.match(list, /avatarUrl: notificationAvatarUrl\(profile\.avatar_url\)/);
  assert.match(list, /displayName: name/);
  assert.match(list, /const profileMap = Object\.fromEntries/);
  assert.match(list, /const avatarMap = Object\.fromEntries/);
  assert.match(list, /avatarMap,/);
  assert.match(list, /\^https\?:\\\/\\\//);
  assert.doesNotMatch(list, /createSignedUrl|storage_path/);
});

test("unread endpoint uses an exact head aggregate and transfers no rows", () => {
  assert.match(unread, /count:\s*"exact"/);
  assert.match(unread, /head:\s*true/);
  assert.match(unread, /\.eq\("is_read", false\)/);
  assert.match(unread, /\.eq\("read", false\)/);
  assert.doesNotMatch(unread, /filterValidNotifications/);
});

test("Home badge state uses one authenticated server-derived unseen RPC", () => {
  assert.match(hasUnread, /getNotificationRouteContext/);
  assert.match(hasUnread, /\.rpc\("notification_inbox_has_unseen"\)/);
  assert.match(hasUnread, /hasUnread:/);
  assert.doesNotMatch(hasUnread, /\.from\("notifications"\)|count:\s*"exact"|head:\s*true|filterValidNotifications/);
});

test("opening the inbox records seen state without marking notification rows read", () => {
  assert.match(seen, /getNotificationRouteContext/);
  assert.match(seen, /enforceRateLimit\(req, "mutation\.activity"/);
  assert.match(seen, /\.rpc\("notification_inbox_mark_seen"\)/);
  assert.doesNotMatch(seen, /\.from\("notifications"\)|is_read|read:\s*true/);
});

test("notification inbox state is owner-derived, monotonic, and inaccessible as a raw table", () => {
  assert.match(seenMigration, /create table if not exists public\.notification_inbox_state/);
  assert.match(seenMigration, /user_id uuid primary key references public\.profiles\(id\) on delete cascade/);
  assert.match(seenMigration, /alter table public\.notification_inbox_state enable row level security/);
  assert.match(seenMigration, /revoke all on table public\.notification_inbox_state from public, anon, authenticated/);
  assert.match(seenMigration, /v_user_id uuid := auth\.uid\(\)/g);
  assert.match(seenMigration, /security definer[\s\S]*set search_path = ''/g);
  assert.match(seenMigration, /greatest\(state\.last_seen_at, excluded\.last_seen_at\)/);
  assert.match(seenMigration, /notification\.created_at > coalesce\(v_last_seen_at, '-infinity'::timestamptz\)/);
  assert.doesNotMatch(seenMigration, /p_user_id|p_username/);
});

test("missing notification schema fails visibly instead of scanning a legacy fallback", () => {
  assert.match(list, /Notification deployment contract unavailable/);
  assert.match(unread, /Notification deployment contract unavailable/);
  assert.doesNotMatch(list, /legacy/i);
  assert.doesNotMatch(unread, /legacy/i);
});

test("notification recipient cursor and unread predicates are indexed", () => {
  assert.match(migration, /notifications_recipient_user_cursor_idx/);
  assert.match(migration, /notifications_recipient_name_cursor_idx/);
  assert.match(migration, /notifications_recipient_user_unread_phase5_idx/);
  assert.match(migration, /notifications_recipient_name_unread_phase5_idx/);
  assert.match(unseenIndexMigration, /notifications_unseen_recipient_user_created_idx/);
  assert.match(unseenIndexMigration, /notifications_unseen_recipient_name_created_idx/);
  assert.match(unseenIndexMigration, /where deleted_at is null and is_read = false and read = false/g);
});

test("mark-one remains owner scoped and updates both read flags", () => {
  assert.match(readOne, /getNotificationRouteContext/);
  assert.match(readOne, /recipient_user_id/);
  assert.match(readOne, /recipient_name/);
  assert.match(readOne, /is_read:\s*true/);
  assert.match(readOne, /read:\s*true/);
});

test("mark-all remains bounded to the authenticated user and legacy name", () => {
  assert.match(readAll, /getNotificationRouteContext/);
  assert.match(readAll, /\.eq\("recipient_user_id", viewer\.id\)/);
  assert.match(readAll, /\.eq\("recipient_name", viewer\.name\)/);
  assert.match(readAll, /Promise\.all/);
});

test("notification deletion is soft and owner scoped", () => {
  assert.match(remove, /getNotificationRouteContext/);
  assert.match(remove, /recipient_user_id/);
  assert.match(remove, /recipient_name/);
  assert.match(remove, /deleted_at/);
  assert.match(remove, /updated_at/);
});
