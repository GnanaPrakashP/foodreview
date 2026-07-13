import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createApiSecurityStub } from "./helpers/api-security-stub.mjs";

// ---- transpile helpers ----

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

const src = {
  remove: transpile(readFileSync(new URL("../app/api/circle/remove/route.ts", import.meta.url), "utf8")),
  cancel: transpile(readFileSync(new URL("../app/api/circle/cancel/route.ts", import.meta.url), "utf8")),
};

// ---- mockDb: sequential responses, no call recording ----

function mockDb(...responses) {
  let idx = 0;
  return {
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains"]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

// ---- spyDb: sequential responses AND records all chain-method calls ----
// Use this when you need to assert what was written to the DB, not just the response.

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

// Extract eq("col", val) pairs from a recorded call entry as {col: val, ...}
function eqFilters(entry) {
  return Object.fromEntries(
    entry.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val])
  );
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

// ---- shared fakes ----

const mockNextResponse = {
  json(body, opts) { return { _body: body, _status: opts?.status ?? 200 }; },
};

function makeReq(body) { return { json: async () => body }; }
function body(res) { return res._body; }
function status(res) { return res._status; }

function makeCircleDb(overrides = {}) {
  return {
    hasCircleEdge: async () => false,
    addCircleEdge: async () => ({ error: null }),
    hasCircleAccess: async () => false,
    getCircleRelationshipsForName: async () => ({
      circleMembers: new Set(), joinedCircles: new Set(), mutualMembers: new Set(),
    }),
    getAccountTypesForNames: async () => ({}),
    ...overrides,
  };
}

function makeNotifications() {
  const calls = [];
  return {
    calls,
    createNotificationForNames: async (_db, input) => { calls.push({ fn: "createNotificationForNames", input }); return null; },
    upsertCircleRequestNotification: async (_db, input) => { calls.push({ fn: "upsertCircleRequestNotification", input }); },
  };
}

function loadRoute(code, { db, circleDb, notifications, authName = "Alice" }) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    process: { env: {} },
    require(id) {
      if (id === "@supabase/ssr") return { createServerClient: () => db };
      if (id === "next/headers") return { cookies: async () => ({ getAll: () => [] }) };
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/server/api-security") return createApiSecurityStub({ json: mockNextResponse.json });
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => db };
      if (id === "@/lib/server/cache-invalidation") {
        return {
          invalidateCircleFeedCacheForNames() {},
          invalidateSocialCachesForNames() {},
        };
      }
      if (id === "@/lib/server/route-supabase") {
        return {
          createRouteSupabase: async () => db,
          getRouteActor: async () => ({
            supabase: db,
            actor: authName ? { userId: `${authName.toLowerCase()}-id`, actorName: authName, displayName: authName } : null,
          }),
        };
      }
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName ? { userId: `${authName.toLowerCase()}-id`, actorName: authName } : null,
        };
      }
      if (id === "@/lib/circle-db") return circleDb;
      if (id === "@/lib/notifications") return notifications ?? {};
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in circle-remove tests: ${id}`);
    },
  });
  return mod.exports;
}

// Remove route inline DB call sequence:
//   response[0]  → main DELETE (circle_memberships, user_name=other, member_name=me)
//   response[1]  → cleanup UPDATE circle_requests me→other accepted
//   response[2]  → cleanup UPDATE circle_requests other→me accepted

// ============================================================
// remove/route.ts — behaviour tests
// ============================================================

test("remove: missing names returns 400", async () => {
  const { POST } = loadRoute(src.remove, {
    db: mockDb(),
    circleDb: makeCircleDb(),
  });
  const res = await POST(makeReq({ myName: "Alice", otherName: "" }));
  assert.equal(status(res), 400);
});

test("remove: self-remove returns 400", async () => {
  const { POST } = loadRoute(src.remove, {
    db: mockDb(),
    circleDb: makeCircleDb(),
  });
  const res = await POST(makeReq({ myName: "Alice", otherName: "Alice" }));
  assert.equal(status(res), 400);
});

test("remove: deletes only receiver→sender edge (directional leave)", async () => {
  const db = spyDb(
    { error: null }, // main DELETE (other→me)
    { error: null }, // cleanup UPDATE 1
    { error: null }  // cleanup UPDATE 2
  );

  const { POST } = loadRoute(src.remove, {
    db,
    circleDb: makeCircleDb(),
  });

  const res = await POST(makeReq({ myName: "Alice", otherName: "Bob" }));
  assert.equal(body(res).ok, true);

  // Only one DELETE should exist (user_name=Bob, member_name=Alice)
  const deletes = db._calls.filter(
    (c) => c.table === "circle_memberships" && hasOp(c, "delete")
  );
  assert.equal(deletes.length, 1, "only the receiver-owned edge should be deleted");
  const filters = eqFilters(deletes[0]);
  assert.equal(filters.user_name, "Bob");
  assert.equal(filters.member_name, "Alice");
});

test("remove: never deletes reverse edge me→other", async () => {
  const db = spyDb(
    { error: null },
    { error: null },
    { error: null }
  );

  const { POST } = loadRoute(src.remove, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ myName: "Alice", otherName: "Bob" }));

  const deletes = db._calls.filter(
    (c) => c.table === "circle_memberships" && hasOp(c, "delete")
  );
  assert.equal(deletes.length, 1);
});

test("remove: membership does not exist — returns ok, does not crash", async () => {
  // delete matches 0 rows but returns no error
  const { POST } = loadRoute(src.remove, {
    db: mockDb(
      { error: null }, // delete (0 rows matched, still ok)
      { error: null }, // cleanup 1
      { error: null }  // cleanup 2
    ),
    circleDb: makeCircleDb(),
  });

  const res = await POST(makeReq({ myName: "Alice", otherName: "Bob" }));
  assert.equal(body(res).ok, true);
});

test("remove: does not invoke notification functions", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.remove, {
    db: mockDb(
      { error: null },
      { error: null },
      { error: null }
    ),
    circleDb: makeCircleDb(),
    notifications: notif,
  });

  await POST(makeReq({ myName: "Alice", otherName: "Bob" }));
  assert.equal(notif.calls.length, 0, "remove must never send notifications");
});

test("remove: cleanup targets only accepted circle_requests, not pending ones", async () => {
  const db = spyDb(
    { error: null }, // main delete
    { error: null }, // cleanup 1
    { error: null }  // cleanup 2
  );

  const { POST } = loadRoute(src.remove, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ myName: "Alice", otherName: "Bob" }));

  // Both cleanup UPDATE calls must filter on status=accepted
  const cleanupUpdates = db._calls.filter(
    (c) => c.table === "circle_requests" && hasOp(c, "update")
  );
  assert.equal(cleanupUpdates.length, 2);
  for (const update of cleanupUpdates) {
    assert.equal(
      eqFilters(update).status,
      "accepted",
      "cleanup must only touch accepted requests, not pending ones"
    );
  }
});

test("remove: db error on main delete returns 500", async () => {
  const { POST } = loadRoute(src.remove, {
    db: mockDb(
      { error: { message: "write failed", code: "500" } }
    ),
    circleDb: makeCircleDb(),
  });

  const res = await POST(makeReq({ myName: "Alice", otherName: "Bob" }));
  assert.equal(status(res), 500);
});

// ============================================================
// cancel/route.ts — DB payload assertions (post-fix)
// ============================================================

test("cancel: pre-check query targets correct sender and receiver", async () => {
  const db = spyDb(
    { data: { status: "pending" }, error: null }, // pre-check
    { error: null },                              // delete
    { error: null }                               // notification update
  );

  const { POST } = loadRoute(src.cancel, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));

  // First call should be the SELECT pre-check on circle_requests
  const preCheck = db._calls[0];
  assert.equal(preCheck.table, "circle_requests");
  assert.ok(hasOp(preCheck, "select"), "pre-check must be a SELECT");
  assert.equal(eqFilters(preCheck).sender_name, "Alice");
  assert.equal(eqFilters(preCheck).receiver_name, "Bob");
});

test("cancel: delete operation filters to status=pending only", async () => {
  const db = spyDb(
    { data: { status: "pending" }, error: null },
    { error: null },
    { error: null }
  );

  const { POST } = loadRoute(src.cancel, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));

  const deleteEntry = db._calls.find(
    (c) => c.table === "circle_requests" && hasOp(c, "delete")
  );
  assert.ok(deleteEntry, "should have a DELETE on circle_requests");
  assert.equal(eqFilters(deleteEntry).status, "pending",
    "delete must restrict to pending — must not touch accepted requests");
  assert.equal(eqFilters(deleteEntry).sender_name, "Alice");
  assert.equal(eqFilters(deleteEntry).receiver_name, "Bob");
});

test("cancel: notification soft-delete targets correct actor and recipient", async () => {
  const db = spyDb(
    { data: { status: "pending" }, error: null },
    { error: null },
    { error: null }
  );

  const { POST } = loadRoute(src.cancel, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));

  const notifUpdate = db._calls.find((c) => c.table === "notifications" && hasOp(c, "update"));
  assert.ok(notifUpdate, "should UPDATE notifications");
  assert.equal(eqFilters(notifUpdate).actor_name, "Alice",
    "notification actor_name must match senderName");
  assert.equal(eqFilters(notifUpdate).recipient_name, "Bob",
    "notification recipient_name must match receiverName");
});

test("cancel: cancelling accepted request returns 409 and does not reach delete", async () => {
  const db = spyDb(
    { data: { status: "accepted" }, error: null } // pre-check: accepted
  );

  const { POST } = loadRoute(src.cancel, {
    db,
    circleDb: makeCircleDb(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 409);

  // No delete must have been issued
  const deleteEntry = db._calls.find(
    (c) => c.table === "circle_requests" && hasOp(c, "delete")
  );
  assert.equal(deleteEntry, undefined, "accepted request must not be deleted");
});

test("cancel: no existing request — pre-check returns null, delete still runs and returns ok", async () => {
  // Pre-check returns null → existing?.status is undefined → not "accepted" → proceeds
  const { POST } = loadRoute(src.cancel, {
    db: mockDb(
      { data: null, error: null }, // no request found
      { error: null },             // delete (matches 0 rows)
      { error: null }              // notification
    ),
    circleDb: makeCircleDb(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(body(res).ok, true);
});

// ============================================================
// remove/route.ts — DB payload assertions
// ============================================================

test("remove: cleanup UPDATE sets status=rejected on circle_requests", async () => {
  const db = spyDb(
    { error: null },
    { error: null },
    { error: null }
  );

  const { POST } = loadRoute(src.remove, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ myName: "Alice", otherName: "Bob" }));

  const updates = db._calls.filter(
    (c) => c.table === "circle_requests" && hasOp(c, "update")
  );
  assert.equal(updates.length, 2);

  // Both UPDATEs must set status=rejected in their payload
  for (const update of updates) {
    const updateOp = update.ops.find(([op]) => op === "update");
    assert.equal(updateOp[1].status, "rejected",
      "remove cleanup must mark accepted requests as rejected");
  }
});

test("remove: cleanup covers both request directions", async () => {
  const db = spyDb(
    { error: null },
    { error: null },
    { error: null },
    { error: null }
  );

  const { POST } = loadRoute(src.remove, {
    db,
    circleDb: makeCircleDb(),
  });

  await POST(makeReq({ myName: "Alice", otherName: "Bob" }));

  const updates = db._calls.filter(
    (c) => c.table === "circle_requests" && hasOp(c, "update")
  );
  // Collect the sender→receiver pairs from both cleanup UPDATEs
  const pairs = updates.map((u) => ({
    sender: eqFilters(u).sender_name,
    receiver: eqFilters(u).receiver_name,
  }));

  const hasAliceToBob = pairs.some((p) => p.sender === "Alice" && p.receiver === "Bob");
  const hasBobToAlice = pairs.some((p) => p.sender === "Bob" && p.receiver === "Alice");
  assert.ok(hasAliceToBob, "cleanup must cover Alice→Bob direction");
  assert.ok(hasBobToAlice, "cleanup must cover Bob→Alice direction");
});
