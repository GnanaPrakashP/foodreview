import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202607220001_table_memory_invitation_lifecycle.sql",
  "utf8"
);
const createRoute = readFileSync("app/api/mobile/memories/route.ts", "utf8");
const participantRoute = readFileSync("app/api/mobile/memories/[roomId]/participants/route.ts", "utf8");
const responseRoute = readFileSync("app/api/mobile/memories/invites/[inviteId]/respond/route.ts", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const notificationsScreen = readFileSync("mobile/app/notifications.tsx", "utf8");
const notificationService = readFileSync("mobile/src/services/notifications.ts", "utf8");
const pushBootstrap = readFileSync("mobile/src/providers/PushNotificationBootstrap.tsx", "utf8");

test("room creation directly adds only people in the creator's Circle", () => {
  assert.match(migration, /create or replace function public\.create_shared_memory_room_with_invites/);
  assert.match(migration, /membership\.user_name = v_creator/);
  assert.match(migration, /membership\.member_name = safe_candidate\.username/);
  assert.match(migration, /insert into public\.shared_memory_members[\s\S]*from circle_candidates/);
  assert.match(migration, /insert into public\.shared_memory_invites[\s\S]*from invite_candidates/);
  assert.match(migration, /not public\.shared_memory_user_pair_blocked\(v_creator, candidate\.username\)/);
  assert.match(migration, /public\.shared_memory_user_pair_blocked\(candidate\.username, other_candidate\.username\)/);
});

test("legacy creation delegates to the consent-aware creation function", () => {
  assert.match(migration, /create or replace function public\.create_shared_memory_room\(/);
  assert.match(migration, /from public\.create_shared_memory_room_with_invites\(/);
  assert.match(migration, /security invoker/);
});

test("invite acceptance is receiver-scoped, atomic, and blocked-user aware", () => {
  assert.match(migration, /create or replace function public\.respond_to_shared_memory_invite/);
  assert.match(migration, /invite\.receiver_name = v_receiver/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_invite\.status <> 'pending'/);
  assert.match(migration, /public\.shared_memory_room_has_blocked_relationship\(v_invite\.room_id, v_receiver\)/);
  assert.match(migration, /insert into public\.shared_memory_members/);
  assert.match(migration, /update public\.shared_memory_invites/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /revoke insert, update, delete on table public\.shared_memory_invites from authenticated/);
});

test("creation uses the fail-closed server contract and sends private notification copy", () => {
  assert.match(memoryService, /\/api\/mobile\/memories/);
  assert.doesNotMatch(memoryService, /rpc\("create_shared_memory_room"/);
  assert.match(createRoute, /rpc\("create_shared_memory_room_with_invites"/);
  assert.match(createRoute, /claimIdempotency\(req, "memory\.room\.create"/);
  assert.match(createRoute, /type: "TABLE_MEMORY_ADDED"/);
  assert.match(createRoute, /type: "TABLE_MEMORY_INVITE"/);
  assert.match(createRoute, /message: "You were added to a Table Memory\."/);
  assert.match(createRoute, /message: "You have a new memory room invite\."/);
  assert.doesNotMatch(createRoute, /restaurantName: room\./);
});

test("existing room additions use the same added-versus-invited notification model", () => {
  assert.match(participantRoute, /const addNames = targetNames\.filter/);
  assert.match(participantRoute, /const inviteNames = targetNames\.filter/);
  assert.match(participantRoute, /type: "TABLE_MEMORY_ADDED"/);
  assert.match(participantRoute, /type: "TABLE_MEMORY_INVITE"/);
  assert.match(participantRoute, /status: "cancelled"/);
  assert.match(participantRoute, /\.eq\("type", "TABLE_MEMORY_INVITE"\)/);
  assert.match(participantRoute, /dedupe: false/);
});

test("mobile notifications expose Join and Decline and route only accepted users to the room", () => {
  assert.match(responseRoute, /rpc\("respond_to_shared_memory_invite"/);
  assert.match(responseRoute, /\.eq\("recipient_name", actor\.actorName\)/);
  assert.match(notificationsScreen, /respondToMemory\(item, "join"\)/);
  assert.match(notificationsScreen, /respondToMemory\(item, "decline"\)/);
  assert.match(notificationsScreen, />Join</);
  assert.match(notificationsScreen, />Decline</);
  assert.match(notificationService, /row\.type !== "TABLE_MEMORY_INVITE" \|\| status === "accepted"/);
  assert.match(pushBootstrap, /notificationType === "TABLE_MEMORY_INVITE"/);
  assert.match(pushBootstrap, /openProtectedPath\("\/notifications"\)/);
});
