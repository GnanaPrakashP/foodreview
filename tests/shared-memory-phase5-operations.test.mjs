import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const observability = readFileSync("lib/server/memory-observability.ts", "utf8");
const uploadIntentRoute = readFileSync("app/api/mobile/memories/upload-intent/route.ts", "utf8");
const finalizeRoute = readFileSync("app/api/mobile/memories/finalize-upload/route.ts", "utf8");
const cleanupRoute = readFileSync("app/api/mobile/memories/uploads/cleanup/route.ts", "utf8");
const notifyRoute = readFileSync("app/api/mobile/memories/notify/route.ts", "utf8");
const participantsRoute = readFileSync("app/api/mobile/memories/[roomId]/participants/route.ts", "utf8");
const accountDeleteRoute = readFileSync("app/api/delete-account/route.ts", "utf8");
const supabaseReadme = readFileSync("mobile/supabase/README.md", "utf8");

test("phase 5 observability helper allowlists only non-sensitive fields", () => {
  assert.match(observability, /SAFE_MEMORY_METRIC_KEYS/);
  for (const safeKey of [
    "durationMs",
    "errorKind",
    "expiredIntents",
    "mediaKind",
    "moderationStatus",
    "removedObjects",
    "sent",
    "status",
    "statusCode"
  ]) {
    assert.match(observability, new RegExp(`"${safeKey}"`));
  }

  for (const forbidden of [
    "roomId",
    "room_id",
    "storagePath",
    "storage_path",
    "signedUrl",
    "public_url",
    "message",
    "caption",
    "pushToken",
    "expo_push_token"
  ]) {
    assert.doesNotMatch(observability, new RegExp(`"${forbidden}"`));
  }

  assert.match(observability, /console\.info\("\[memory\]"/);
  assert.match(observability, /https\?:\\\/\\\//);
  assert.match(observability, /trimmed\.includes\("\/"\)/);
});

test("phase 5 memory routes emit sanitized operation events", () => {
  for (const [route, event] of [
    [uploadIntentRoute, "upload_intent.create"],
    [finalizeRoute, "upload_intent.finalize"],
    [cleanupRoute, "upload_cleanup.run"],
    [notifyRoute, "memory_notification.send"],
    [participantsRoute, "memory_participants.invite"],
    [accountDeleteRoute, "account_delete.run"]
  ]) {
    assert.match(route, /recordMemoryOperation/);
    assert.match(route, new RegExp(event.replace(".", "\\.")));
  }
});

test("phase 5 notification route no longer logs raw errors", () => {
  assert.doesNotMatch(notifyRoute, /console\.error/);
  assert.match(notifyRoute, /memoryErrorKind\(error\)/);
  assert.match(notifyRoute, /MEMORY_NOTIFICATION_BODY = "You have a new memory update\."/);
});

test("phase 5 participant invite route uses generic notification previews and sanitized errors", () => {
  assert.doesNotMatch(participantsRoute, /console\.error/);
  assert.match(participantsRoute, /memoryErrorKind\(error\)/);
  assert.match(participantsRoute, /message: "You have a new memory room invite\."/);
  assert.doesNotMatch(participantsRoute, /actor\.displayName\} invited you/);
  assert.doesNotMatch(participantsRoute, /restaurantName: room\.restaurant_name/);
});

test("phase 5 cleanup observability remains count-only", () => {
  assert.match(cleanupRoute, /expiredIntents/);
  assert.match(cleanupRoute, /rejectedPendingMedia/);
  assert.match(cleanupRoute, /removedObjects/);
  const recordBlocks = cleanupRoute.match(/recordMemoryOperation\([\s\S]*?\n\s*}\);/g) ?? [];
  assert.ok(recordBlocks.length > 0);
  for (const block of recordBlocks) {
    assert.doesNotMatch(block, /storage_path/);
    assert.doesNotMatch(block, /storagePaths(?!\.length)/);
  }
  assert.doesNotMatch(cleanupRoute, /console\.(log|info|warn|error)/);
});

test("phase 5 docs describe metrics, alerts, and forbidden private log data", () => {
  assert.match(supabaseReadme, /Phase 5 monitoring and operations/);
  assert.match(supabaseReadme, /Upload intent create rate and error rate/);
  assert.match(supabaseReadme, /Finaliz[e|e] success/);
  assert.match(supabaseReadme, /cleanup storage deletion failures/i);
  assert.match(supabaseReadme, /Never add room IDs, user IDs, usernames, message text, captions, signed URLs/);
});
