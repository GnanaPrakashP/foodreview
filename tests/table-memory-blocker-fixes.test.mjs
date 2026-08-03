import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  upsertMemoryMessage
} from "../mobile/src/services/memoryMessageReconciliation.mjs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function message(overrides = {}) {
  return {
    attachments: [],
    authorDisplayName: "User A",
    authorName: "user-a",
    body: "queued hello",
    clientCreatedAt: "2026-08-03T10:00:00.000Z",
    clientId: "client-message-0001",
    clientOrderKey: "2026-08-03T10:00:00.000Z:0000000000000000:client-message-0001",
    clientSequence: 0,
    createdAt: "2026-08-03T10:00:00.000Z",
    deliveryStatus: "waiting_for_connection",
    editedAt: null,
    id: "optimistic-message:room:client-message-0001",
    replyToMessage: null,
    replyToMessageId: null,
    roomId: "room",
    serverCreatedAt: null,
    serverId: null,
    ...overrides
  };
}

test("Share and Table Memory use the same local-first video poster generator", () => {
  const sharedPoster = source("mobile/src/services/localVideoPoster.ts");
  const share = source("mobile/app/(tabs)/share.tsx");
  const room = source("mobile/app/memories/[id].tsx");
  assert.match(sharedPoster, /getThumbnailAsync\(uri, \{ quality: 0\.6, time: 0 \}\)/);
  assert.match(share, /createLocalVideoPoster\(media\.uri\)/);
  assert.match(share, /createLocalVideoPoster\(uri\)/);
  assert.match(room, /createLocalVideoPoster\(sourceUri\)/);
  assert.match(room, /stageAccountFile\(nextThumbnail\.uri, "memory-thumbnail"\)/);
  assert.match(room, /preparing \? "Preparing" : processing \? "Processing" : "Uploading"/);
  assert.match(room, /recyclingKey=\{viewKey \?\? memoryMediaCacheKey\(media\)\}/);
});

test("server response then realtime echo reconciles once at server commit time", () => {
  const optimistic = message();
  const confirmed = message({
    createdAt: "2026-08-03T10:05:00.000Z",
    deliveryStatus: "sent",
    id: "server-message-1",
    serverCreatedAt: "2026-08-03T10:05:00.000Z",
    serverId: "server-message-1"
  });
  const afterResponse = upsertMemoryMessage([optimistic], confirmed);
  const afterRealtime = upsertMemoryMessage(afterResponse, { ...confirmed });
  assert.equal(afterRealtime.length, 1);
  assert.equal(afterRealtime[0].createdAt, "2026-08-03T10:05:00.000Z");
  assert.equal(afterRealtime[0].clientCreatedAt, "2026-08-03T10:00:00.000Z");
});

test("realtime before response also reconciles one stable logical message", () => {
  const optimistic = message();
  const realtime = message({
    createdAt: "2026-08-03T10:05:01.000Z",
    deliveryStatus: "sent",
    id: "server-message-2",
    serverCreatedAt: "2026-08-03T10:05:01.000Z",
    serverId: "server-message-2"
  });
  const afterRealtime = upsertMemoryMessage([optimistic], realtime);
  const afterResponse = upsertMemoryMessage(afterRealtime, { ...realtime });
  assert.equal(afterResponse.length, 1);
  assert.equal(afterResponse[0].serverId, "server-message-2");
});

test("offline outbox automatically replays with stable identity and bounded backoff", () => {
  const hook = source("mobile/src/hooks/useMemories.ts");
  const service = source("mobile/src/services/memories.ts");
  const store = source("mobile/src/services/memoryOfflineStore.ts");
  const bootstrap = source("mobile/src/providers/MemoryRoomSyncBootstrap.tsx");
  const screen = source("mobile/app/memories/[id].tsx");
  assert.match(hook, /deferred \? "waiting_for_connection" : "sending"/);
  assert.match(hook, /retry: \(failureCount\) => failureCount < 4/);
  assert.match(service, /message\.sendAttemptCount \?\? 0\) < 5/);
  assert.match(service, /Math\.min\(750 \* \(2 \*\* \(sendAttemptCount - 1\)\), 6_000\)/);
  assert.match(service, /clientId,[\s\S]*pendingMessage\.clientCreatedAt/);
  assert.match(store, /create table if not exists memory_message_outbox/);
  assert.match(store, /on conflict\(message_id\) do update/);
  assert.match(bootstrap, /recoverOutbox: runtime\.isOnline/);
  assert.doesNotMatch(screen.match(/function hasMemoryDeliveryStrip[\s\S]*?\n\}/)?.[0] ?? "", /waiting_for_connection/);
  assert.match(screen, /target\.deliveryStatus === "sent" \|\| memoryMessageServerId\(target\)/);
});

test("per-tab unread cursors are monotonic and room summary is server-authoritative", () => {
  const migration = source("supabase/migrations/202608030001_table_memory_activity_unread.sql");
  const route = source("app/api/mobile/memories/read/route.ts");
  const hooks = source("mobile/src/hooks/useMemories.ts");
  assert.match(migration, /mark_shared_memory_activity_read_v1/);
  assert.match(migration, /greatest\(coalesce\(public\.shared_memory_reads\.last_media_read_at/);
  assert.match(migration, /greatest\(coalesce\(public\.shared_memory_reads\.last_dishes_read_at/);
  assert.match(migration, /unread_chat_count \+ counts\.unread_media_count \+ counts\.unread_dish_count/);
  assert.match(migration, /photo\.uploader_name <> \(select username from viewer\)/);
  assert.match(migration, /dish\.added_by <> \(select username from viewer\)/);
  assert.match(route, /shared_memory_room_summaries_v4/);
  assert.match(hooks, /unreadMediaCount: fromViewer \? memory\.unreadMediaCount : memory\.unreadMediaCount \+ 1/);
  assert.match(hooks, /unreadDishCount: fromViewer \? memory\.unreadDishCount : memory\.unreadDishCount \+ 1/);
});

test("notification intent and push delivery are atomic and deduplicated", () => {
  const migration = source("supabase/migrations/202608030002_table_memory_notification_outbox.sql");
  const nullSeparatorFix = source("supabase/migrations/202608030004_table_memory_notification_null_separator_fix.sql");
  const compatibilityRoute = source("app/api/mobile/memories/notify/route.ts");
  const client = source("mobile/src/services/memories.ts");
  assert.match(migration, /after insert on public\.shared_memory_messages/);
  assert.match(migration, /notifications_dedupe_key_unique_idx/);
  assert.match(migration, /on conflict \(dedupe_key\).*do nothing/s);
  assert.match(migration, /member\.user_name <> v_actor_name/);
  assert.match(migration, /token\.disabled_at is null/);
  assert.match(migration, /if v_kind = 'message'/);
  assert.match(nullSeparatorFix, /convert_to\(v_notification_id::text \|\| ':' \|\| token\.id::text, 'UTF8'\)/);
  assert.doesNotMatch(nullSeparatorFix, /chr\(0\)/);
  assert.doesNotMatch(compatibilityRoute, /exp\.host|sendExpoPush|push_tokens/);
  assert.doesNotMatch(client, /notifyMemoryRoomActivity/);
});

test("moderation audit configuration fails ready checks with its real reason", () => {
  const pipeline = source("lib/server/media-pipeline.ts");
  const health = source("app/api/internal/media/health/route.ts");
  const render = source("render.yaml");
  assert.match(pipeline, /media_audit_hash_unavailable/);
  assert.match(health, /securityIdentifierHashingConfigured/);
  assert.match(render, /key: API_RATE_LIMIT_HMAC_SECRET\n\s+sync: false/);
});

test("Android push builds require environment-owned Firebase config and refresh tokens", () => {
  const config = source("mobile/app.config.js");
  const eas = source("mobile/eas.json");
  const notifications = source("mobile/src/services/notifications.ts");
  const bootstrap = source("mobile/src/providers/PushNotificationBootstrap.tsx");
  assert.match(config, /GOOGLE_SERVICES_JSON/);
  assert.match(config, /googleServicesFile/);
  assert.match(config, /Android push build requires GOOGLE_SERVICES_JSON as an EAS secret file/);
  assert.match(eas, /EXPO_PUBLIC_REQUIRE_PUSH_REGISTRATION/);
  assert.match(bootstrap, /addPushTokenListener/);
  assert.match(notifications, /\.eq\("install_id", installId\)[\s\S]*\.neq\("expo_push_token", token\.data\)/);
});
