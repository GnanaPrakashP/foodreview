import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function transpile(src) {
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

function loadNotifications(hasCircleAccess = async () => false) {
  const source = readFileSync(new URL("../lib/notifications.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id === "@/lib/circle-db") return { hasCircleAccess };
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in notification tests: ${id}`);
    },
  });
  return mod.exports;
}

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    get _calls() { return calls; },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains"]) {
        chain[m] = (...args) => { entry.ops.push([m, ...args]); return chain; };
      }
      return chain;
    },
  };
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

function opArgs(entry, name) {
  const op = entry.ops.find(([opName]) => opName === name);
  return op?.slice(1) ?? [];
}

function review(owner, visibility) {
  return {
    id: "post-1",
    reviewer_name: owner,
    restaurant_name: "Cafe One",
    items: [{ name: "Latte", rating: 5 }],
    visibility,
  };
}

test("notificationProfileName prefers full profile name over username", () => {
  const { notificationProfileName } = loadNotifications();
  assert.equal(notificationProfileName({ first_name: "Alice", last_name: "Smith", username: "alice" }), "Alice Smith");
  assert.equal(notificationProfileName({ first_name: "", last_name: "", username: "alice" }), "alice");
});

test("notificationUrl routes post, user, restaurant, and fallback notifications", () => {
  const { notificationUrl } = loadNotifications();
  assert.equal(notificationUrl({ entity_type: "POST", entity_id: "p1", post_id: null }), "/reviews/p1");
  assert.equal(notificationUrl({ entity_type: "USER", actor_name: "Alice Smith" }), "/people/Alice%20Smith");
  assert.equal(notificationUrl({ entity_type: "RESTAURANT", restaurant_name: "Cafe One", metadata: null }), "/trending/Cafe%20One");
  assert.equal(notificationUrl({ entity_type: "SYSTEM", entity_id: null, post_id: null }), "/notifications");
});

test("canViewReview respects public, owner, only-me, and circle access", async () => {
  const noCircle = loadNotifications(async () => false);
  assert.equal(await noCircle.canViewReview(spyDb(), review("Alice", "public"), "Bob"), true);
  assert.equal(await noCircle.canViewReview(spyDb(), review("Alice", "me"), "Bob"), false);
  assert.equal(await noCircle.canViewReview(spyDb(), review("Alice", "me"), "Alice"), true);
  assert.equal(await noCircle.canViewReview(spyDb(), review("Alice", "circle"), "Bob"), false);

  const withCircle = loadNotifications(async (_db, owner, viewer) => owner === "Alice" && viewer === "Bob");
  assert.equal(await withCircle.canViewReview(spyDb(), review("Alice", "circle"), "Bob"), true);
});

test("createNotificationForNames skips self notifications before touching db", async () => {
  const { createNotificationForNames } = loadNotifications();
  const db = spyDb();

  const result = await createNotificationForNames(db, {
    recipientName: "Alice",
    actorName: "Alice",
    type: "POST_LIKED",
    title: "Like",
    message: "Alice liked your post",
    entityType: "POST",
    entityId: "post-1",
  });

  assert.equal(result, null);
  assert.equal(db._calls.length, 0);
});

test("createNotificationForNames dedupes by updating an existing notification", async () => {
  const { createNotificationForNames } = loadNotifications();
  const db = spyDb(
    {
      data: [
        { id: "recipient-id", first_name: "Alice", last_name: "Smith", username: "alice", avatar_url: null },
        { id: "actor-id", first_name: "Bob", last_name: "Jones", username: "bob", avatar_url: null },
      ],
      error: null,
    },
    {
      data: [{ id: "notif-1", title: "Old", content: null, metadata: {}, message: "Old", read: true, is_read: true }],
      error: null,
    },
    { error: null }
  );

  const result = await createNotificationForNames(db, {
    recipientName: "Alice Smith",
    actorName: "Bob Jones",
    type: "POST_LIKED",
    title: "New like",
    message: "Bob liked your post",
    entityType: "POST",
    entityId: "post-1",
    dedupe: true,
  });

  assert.equal(result.id, "notif-1");
  const update = db._calls.find((call) => call.table === "notifications" && hasOp(call, "update"));
  assert.ok(update);
  assert.equal(opArgs(update, "update")[0].message, "Bob liked your post");
  assert.equal(opArgs(update, "update")[0].is_read, false);
});

test("upsertCircleRequestNotification reopens an existing soft-deleted request notification", async () => {
  const { upsertCircleRequestNotification } = loadNotifications();
  const db = spyDb(
    { data: [{ id: "notif-1" }], error: null },
    { error: null }
  );

  await upsertCircleRequestNotification(db, {
    recipientName: "Bob",
    actorName: "Alice",
    message: "Alice requested to join your circle",
    requestId: "req-1",
  });

  const update = db._calls.find((call) => call.table === "notifications" && hasOp(call, "update"));
  assert.ok(update);
  assert.equal(opArgs(update, "update")[0].deleted_at, null);
  assert.equal(opArgs(update, "update")[0].is_read, false);
  assert.equal(opArgs(update, "update")[0].metadata.status, "pending");
});

test("upsertCircleRequestNotification inserts when no previous notification exists", async () => {
  const { upsertCircleRequestNotification } = loadNotifications();
  const db = spyDb(
    { data: [], error: null },
    { error: null }
  );

  await upsertCircleRequestNotification(db, {
    recipientName: "Bob",
    actorName: "Alice",
    message: "Alice requested to join your circle",
    requestId: "req-1",
  });

  const insert = db._calls.find((call) => call.table === "notifications" && hasOp(call, "insert"));
  assert.ok(insert);
  assert.equal(opArgs(insert, "insert")[0].recipient_name, "Bob");
  assert.equal(opArgs(insert, "insert")[0].actor_name, "Alice");
  assert.equal(opArgs(insert, "insert")[0].type, "CIRCLE_REQUEST_RECEIVED");
});
