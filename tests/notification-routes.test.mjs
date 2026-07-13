import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const list = read("app/api/notifications/route.ts");
const unread = read("app/api/notifications/unread-count/route.ts");
const readOne = read("app/api/notifications/[notificationId]/read/route.ts");
const readAll = read("app/api/notifications/read-all/route.ts");
const remove = read("app/api/notifications/[notificationId]/route.ts");
const migration = read("supabase/migrations/202607130009_backend_feed_performance.sql");

test("notification list resolves the canonical actor and never trusts a recipient input", () => {
  assert.match(list, /getNotificationRouteContext/);
  assert.match(list, /viewer\.id/);
  assert.match(list, /viewer\.name/);
  assert.doesNotMatch(list, /searchParams\.get\(["']recipient/);
});

test("notification list is a bounded stable cursor page", () => {
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

test("unread endpoint uses an exact head aggregate and transfers no rows", () => {
  assert.match(unread, /count:\s*"exact"/);
  assert.match(unread, /head:\s*true/);
  assert.match(unread, /\.eq\("is_read", false\)/);
  assert.match(unread, /\.eq\("read", false\)/);
  assert.doesNotMatch(unread, /filterValidNotifications/);
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
