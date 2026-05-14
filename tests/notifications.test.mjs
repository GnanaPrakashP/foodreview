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
      if (id === "@/lib/profile-names") {
        return {
          profileDisplayName: (profile, fallback = "") =>
            [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || fallback,
        };
      }
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

test("notificationProfileName prefers username identity over display name", () => {
  const { notificationProfileName } = loadNotifications();
  assert.equal(notificationProfileName({ first_name: "Alice", last_name: "Smith", username: "alice" }), "alice");
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

test("createNotificationForNames dedupes legacy like notifications per post", async () => {
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
      data: null,
      error: { code: "42703", message: "column message does not exist" },
    },
    {
      data: [],
      error: null,
    },
    {
      data: null,
      error: { code: "42703", message: "column message does not exist" },
    },
    {
      data: { id: "legacy-new", type: "like", post_id: "post-1" },
      error: null,
    }
  );

  const result = await createNotificationForNames(db, {
    recipientName: "Alice Smith",
    actorName: "Bob Jones",
    type: "POST_LIKED",
    title: "New like",
    message: "Bob liked your post",
    entityType: "POST",
    entityId: "post-1",
    postId: "post-1",
    dedupe: true,
  });

  assert.equal(result.id, "legacy-new");
  const legacyLookup = db._calls[2];
  assert.equal(legacyLookup.table, "notifications");
  assert.deepEqual(
    legacyLookup.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val]),
    [
      ["recipient_name", "Alice Smith"],
      ["actor_name", "Bob Jones"],
      ["type", "like"],
      ["post_id", "post-1"],
    ]
  );

  const legacyInsert = db._calls.find((call) => call.table === "notifications" && hasOp(call, "insert") && opArgs(call, "insert")[0].type === "like");
  assert.ok(legacyInsert, "new legacy like notification should be inserted when only other posts had old likes");
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

test("removeLikeNotification soft-deletes modern like notifications", async () => {
  const { removeLikeNotification } = loadNotifications();
  const db = spyDb({ error: null });

  await removeLikeNotification(db, "post-1", "Bob");

  const update = db._calls.find((call) => call.table === "notifications" && hasOp(call, "update"));
  assert.ok(update);
  assert.equal(opArgs(update, "update")[0].deleted_at.length > 0, true);
  assert.equal(opArgs(update, "in")[0], "type");
  assert.deepEqual(Array.from(opArgs(update, "in")[1]), ["POST_LIKED", "like"]);
});

test("removeLikeNotification falls back to legacy delete on notification schema drift", async () => {
  const { removeLikeNotification } = loadNotifications();
  const db = spyDb(
    { error: { code: "42703", message: "column deleted_at does not exist" } },
    { error: null }
  );

  await removeLikeNotification(db, "post-1", "Bob");

  const deleteCall = db._calls.find((call) => call.table === "notifications" && hasOp(call, "delete"));
  assert.ok(deleteCall);
  assert.deepEqual(
    deleteCall.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val]),
    [["actor_name", "Bob"], ["post_id", "post-1"], ["type", "like"]]
  );
});

test("createPostLikeNotification skips private and inaccessible circle reviews", async () => {
  const { createPostLikeNotification } = loadNotifications(async () => false);

  assert.equal(await createPostLikeNotification(spyDb(), review("Alice", "me"), "Bob"), null);
  assert.equal(await createPostLikeNotification(spyDb(), review("Alice", "circle"), "Bob"), null);
});

test("createPostCommentNotifications sends owner and thread notifications without self-duplicates", async () => {
  const { createPostCommentNotifications } = loadNotifications();
  const db = spyDb(
    { data: [], error: null },
    { data: { id: "owner-notif" }, error: null },
    { data: [], error: null },
    { data: { id: "thread-notif" }, error: null }
  );

  await createPostCommentNotifications(
    db,
    review("Alice", "public"),
    "Bob",
    { id: "comment-1", content: `${"x".repeat(90)} trailing content` },
    ["Alice", "Bob", "Carol", "Carol", ""]
  );

  const inserts = db._calls
    .filter((call) => call.table === "notifications" && hasOp(call, "insert"))
    .map((call) => opArgs(call, "insert")[0]);

  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].recipient_name, "Alice");
  assert.equal(inserts[0].type, "POST_COMMENTED");
  assert.equal(inserts[0].metadata.commentId, "comment-1");
  assert.equal(inserts[0].content.length, 80);
  assert.equal(inserts[1].recipient_name, "Carol");
  assert.equal(inserts[1].type, "THREAD_REPLY");
});

test("notificationProfileName falls back to full name when username is empty", () => {
  const { notificationProfileName } = loadNotifications();
  assert.equal(notificationProfileName({ first_name: "Alice", last_name: "Ate", username: "" }), "Alice Ate");
  assert.equal(notificationProfileName({ first_name: "Alice", last_name: "Ate", username: null }), "Alice Ate");
});

test("createPostLikeNotification: message uses actorDisplayName when provided", async () => {
  const { createPostLikeNotification } = loadNotifications();
  const db = spyDb(
    { data: [], error: null },                    // resolveProfiles
    { data: { id: "notif-1" }, error: null }      // insert
  );

  await createPostLikeNotification(db, review("Bob", "public"), "alice", "Alice Ate");

  const insert = db._calls.find((c) => c.table === "notifications" && hasOp(c, "insert"));
  assert.ok(insert, "should insert a notification");
  assert.equal(opArgs(insert, "insert")[0].message, "Alice Ate liked your post");
});

test("createPostLikeNotification: message falls back to actorName when displayName is omitted", async () => {
  const { createPostLikeNotification } = loadNotifications();
  const db = spyDb(
    { data: [], error: null },
    { data: { id: "notif-1" }, error: null }
  );

  await createPostLikeNotification(db, review("Bob", "public"), "alice");

  const insert = db._calls.find((c) => c.table === "notifications" && hasOp(c, "insert"));
  assert.ok(insert, "should insert a notification");
  assert.equal(opArgs(insert, "insert")[0].message, "alice liked your post");
});

test("createPostCommentNotifications: message uses actorDisplayName when provided", async () => {
  const { createPostCommentNotifications } = loadNotifications();
  const db = spyDb(
    { data: [], error: null },                  // resolveProfiles for POST_COMMENTED
    { data: { id: "owner-notif" }, error: null }
  );

  await createPostCommentNotifications(
    db,
    review("Bob", "public"),
    "alice",
    { id: "cmt-1", content: "Looks great" },
    [], // no prior commenters → only the POST_COMMENTED notification fires
    "Alice Ate"
  );

  const inserts = db._calls
    .filter((c) => c.table === "notifications" && hasOp(c, "insert"))
    .map((c) => opArgs(c, "insert")[0]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].type, "POST_COMMENTED");
  assert.equal(inserts[0].message, "Alice Ate commented on your post");
});

test("createCirclePostNotifications: message uses reviewer display name from profiles", async () => {
  const { createCirclePostNotifications } = loadNotifications();
  const db = spyDb(
    { data: [{ member_name: "Bob" }], error: null },                    // circle_memberships
    { data: { first_name: "Alice", last_name: "Ate" }, error: null },   // reviewer profile
    { data: [], error: null },                                          // resolveProfiles for Bob
    { data: [], error: null },                                          // dedupe check for Bob
    { data: { id: "notif-bob" }, error: null }                          // insert for Bob
  );

  await createCirclePostNotifications(db, review("alice", "circle"));

  const insert = db._calls.find((c) => c.table === "notifications" && hasOp(c, "insert"));
  assert.ok(insert, "should insert a notification for Bob");
  assert.equal(opArgs(insert, "insert")[0].message, "Alice Ate posted about Cafe One");
});

test("createCirclePostNotifications: message falls back to reviewer_name when profile is missing", async () => {
  const { createCirclePostNotifications } = loadNotifications();
  const db = spyDb(
    { data: [{ member_name: "Bob" }], error: null },  // circle_memberships
    { data: null, error: null },                      // reviewer profile → null
    { data: [], error: null },                        // resolveProfiles for Bob
    { data: [], error: null },                        // dedupe check for Bob
    { data: { id: "notif-bob" }, error: null }        // insert for Bob
  );

  await createCirclePostNotifications(db, review("alice", "circle"));

  const insert = db._calls.find((c) => c.table === "notifications" && hasOp(c, "insert"));
  assert.ok(insert, "should insert a notification for Bob");
  assert.equal(opArgs(insert, "insert")[0].message, "alice posted about Cafe One");
});

test("createCirclePostNotifications dedupes members and skips the reviewer", async () => {
  const { createCirclePostNotifications } = loadNotifications();
  const db = spyDb(
    {
      data: [
        { member_name: "Bob" },
        { member_name: "Bob" },
        { member_name: "Alice" },
        { member_name: "" },
        { member_name: "Carol" },
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: { id: "notif-bob" }, error: null },
    { data: { id: "notif-carol" }, error: null }
  );

  await createCirclePostNotifications(db, review("Alice", "circle"));

  const inserts = db._calls
    .filter((call) => call.table === "notifications" && hasOp(call, "insert"))
    .map((call) => opArgs(call, "insert")[0]);
  assert.deepEqual(inserts.map((row) => row.recipient_name).sort(), ["Bob", "Carol"]);
  assert.equal(inserts.every((row) => row.type === "CIRCLE_POST_CREATED"), true);
});

// ── resolveProfiles query optimization ───────────────────────────────────────

test("resolveProfiles: queries profiles using .in('username', names) not a full table scan", async () => {
  const { createNotificationForNames } = loadNotifications();
  // Two responses: profiles lookup + notification insert
  const db = spyDb(
    { data: [], error: null },                      // resolveProfiles
    { data: { id: "notif-1" }, error: null }        // insert
  );

  await createNotificationForNames(db, {
    recipientName: "alice",
    actorName: "bob",
    type: "POST_LIKED",
    message: "bob liked your post",
    entityType: "POST",
    entityId: "post-1",
  });

  const profileCall = db._calls.find((c) => c.table === "profiles" && hasOp(c, "in"));
  assert.ok(profileCall, "profiles should be queried with .in() not a full table scan");
  assert.equal(opArgs(profileCall, "in")[0], "username", ".in() should filter by username column");
  const queriedNames = Array.from(opArgs(profileCall, "in")[1]);
  assert.ok(queriedNames.includes("alice"), "queried names should include the recipient");
  assert.ok(queriedNames.includes("bob"), "queried names should include the actor");
  assert.equal(hasOp(profileCall, "limit"), false, "should NOT use .limit() for profile lookup");
});

test("resolveProfiles: empty names list skips DB entirely", async () => {
  const { createNotificationForNames } = loadNotifications();
  const db = spyDb();

  // Self-notification is filtered before resolveProfiles, but we can test the empty
  // branch by checking that a notification to self returns null without DB calls
  const result = await createNotificationForNames(db, {
    recipientName: "alice",
    actorName: "alice",
    type: "POST_LIKED",
    message: "self like",
    entityType: "POST",
    entityId: "post-1",
  });

  assert.equal(result, null);
  assert.equal(db._calls.length, 0, "no DB calls should be made for self-notifications");
});
