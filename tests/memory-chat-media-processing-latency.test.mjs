import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryChatIncrementalProjectionStore } from "../mobile/src/features/memories/chat/memoryChatIncrementalProjection.mjs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function message(clientId, body, deliveryStatus = "pending") {
  return Object.freeze({ body, clientId, deliveryStatus });
}

function project(store, messages, dependencies = []) {
  return store.project({
    buildFull: () => [...messages].reverse().map((item) => ({ key: item.clientId, item })),
    buildOwnTextRow: (item) => ({ key: item.clientId, item }),
    dependencies,
    messageIdentity: (item) => item.clientId,
    messages,
    rowIdentity: (row) => row.key
  });
}

test("ordinary text insertion is incremental and preserves every existing row reference", () => {
  const store = new MemoryChatIncrementalProjectionStore();
  const first = message("a", "first", "sent");
  const second = message("b", "second", "sent");
  const initial = project(store, [first, second]);
  assert.deepEqual(store.lastTransition, { affectedRows: 2, kind: "full" });

  const third = message("c", "third");
  const inserted = project(store, [first, second, third]);
  assert.deepEqual(store.lastTransition, { affectedRows: 2, kind: "insert" });
  assert.equal(inserted[0].item, third);
  assert.equal(inserted[1], initial[0]);
  assert.equal(inserted[2], initial[1]);
});

test("same-identity confirmation replaces only its row and preserves all siblings", () => {
  const store = new MemoryChatIncrementalProjectionStore();
  const first = message("a", "first", "sent");
  const pending = message("b", "second");
  const initial = project(store, [first, pending]);
  const sent = message("b", "second", "sent");
  const confirmed = project(store, [first, sent]);

  assert.deepEqual(store.lastTransition, { affectedRows: 1, kind: "update" });
  assert.equal(confirmed[0].item, sent);
  assert.equal(confirmed[1], initial[1]);
});

test("native submit creates a same-identity local bubble before cache, SQLite, and HTTP", () => {
  const screen = source("mobile/app/memories/[id].tsx");
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const native = source(
    "mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/NativeChatInputView.kt"
  );

  assert.match(native, /nativeSubmitAtMs/);
  assert.match(native, /payloadCapturedAtMs/);
  assert.match(native, /inputClearedAtMs/);
  assert.match(screen, /setImmediateTextRows\(\(current\) => \[/);
  assert.match(screen, /onSend\(body, clientId, createdAt\)/);
  assert.match(screen, /canonicalClientIds\.has\(clientId\)/);
  assert.match(screen, /recordMemoryChatPlacement\("ROW_MODEL_INSERTED"/);
  assert.match(screen, /recordMemoryChatPlacement\("LIST_DATA_COMMIT"/);
  assert.match(screen, /recordMemoryChatPlacement\("ROW_FIRST_LAYOUT"/);
  assert.match(hooks, /onMutate: \(input\) => \{/);
  assert.match(hooks, /recordMemoryChatPlacement\("REACT_QUERY_COMMIT"/);
  assert.match(hooks, /recordMemoryChatPlacement\("SQLITE_STARTED"/);
  assert.match(hooks, /recordMemoryChatPlacement\("HTTP_STARTED"/);
});

test("media processing keeps truthful states and retry requeues the same asset without reupload", () => {
  const pipeline = source("mobile/src/services/mediaPipeline.ts");
  const hook = source("mobile/src/hooks/useMemories.ts");
  const memories = source("mobile/src/services/memories.ts");
  const retryRoute = source("app/api/media/retry/route.ts");
  const blueprint = source("render.yaml");

  assert.match(pipeline, /state: "processing_delayed"/);
  assert.match(pipeline, /state: "processing_failed"/);
  assert.match(pipeline, /\/api\/media\/retry/);
  assert.match(pipeline, /\{ assetId \}/);
  assert.match(pipeline, /await input\.onSourceStaged\?\.\(sourceUri\)/);
  assert.match(memories, /onSourceStaged: asset\.onSourceStaged/);
  assert.match(
    pipeline,
    /if \(record\.state === "processing_failed"\)[\s\S]*?authorizedMobileJson[\s\S]*?record = updatePendingMediaUpload/
  );
  assert.match(hook, /issueKind === "delayed"[\s\S]*?"processing_delayed"/);
  assert.match(hook, /issueKind === "retryable"[\s\S]*?"processing_failed"/);
  assert.match(hook, /issueKind === "permanent"[\s\S]*?"rejected"/);
  assert.match(retryRoute, /asset\.owner_id !== actor\.userId/);
  assert.match(retryRoute, /asset\.owner_name !== actor\.actorName/);
  assert.match(retryRoute, /asset\.surface !== "memory"/);
  assert.match(retryRoute, /job\.status === "dead_letter"/);
  assert.match(retryRoute, /job\.failure_class === "retryable"/);
  assert.match(retryRoute, /requeue_media_processing_job/);
  assert.match(blueprint, /type: worker/);
  assert.match(blueprint, /numInstances: 2/);
  assert.match(blueprint, /SUPABASE_SERVICE_ROLE_KEY[\s\S]*?sync: false/);
});

test("protected worker health exposes queue progress without private media identifiers", () => {
  const health = source("lib/server/media-pipeline.ts");
  const route = source("app/api/internal/media/health/route.ts");

  for (const metric of [
    "activeLeases",
    "claimsPerMinute",
    "deadLetters24h",
    "leaseReclaims24h",
    "permanentFailures24h",
    "processingDurationMs",
    "staleRunningLeases",
    "successes24h",
    "workerHeartbeatAgeSeconds"
  ]) {
    assert.match(health, new RegExp(metric));
  }
  assert.match(route, /queued_jobs_unclaimed/);
  assert.match(route, /worker_heartbeat_stale/);
  assert.doesNotMatch(
    route,
    /message_body|signed_url|storage_path|owner_name|asset_id|job_id/
  );
});
