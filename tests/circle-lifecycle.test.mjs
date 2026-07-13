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

// Pre-transpile route files once — re-run in VM per test
const src = {
  request: transpile(readFileSync(new URL("../app/api/circle/request/route.ts", import.meta.url), "utf8")),
  respond: transpile(readFileSync(new URL("../app/api/circle/respond/route.ts", import.meta.url), "utf8")),
  cancel: transpile(readFileSync(new URL("../app/api/circle/cancel/route.ts", import.meta.url), "utf8")),
};

// ---- mock db: sequential responses consumed in call order ----

function mockDb(...responses) {
  let idx = 0;
  return {
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      const methods = [
        "select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains",
      ];
      for (const m of methods) chain[m] = () => chain;
      return chain;
    },
  };
}

// ---- fake NextResponse: captures body and status ----

const mockNextResponse = {
  json(body, opts) {
    return { _body: body, _status: opts?.status ?? 200 };
  },
};

function makeReq(body) {
  return { json: async () => body };
}

function body(res) { return res._body; }
function status(res) { return res._status; }

// ---- circle-db stubs: call the actual stub functions, ignore the supabase arg ----

function makeCircleDb(overrides = {}) {
  return {
    hasCircleEdge: async () => false,
    addCircleEdge: async () => ({ error: null }),
    getAccountTypeForName: async () => "public",
    hasCircleAccess: async () => false,
    getCircleRelationshipsForName: async () => ({
      circleMembers: new Set(), joinedCircles: new Set(), mutualMembers: new Set(),
    }),
    getAccountTypesForNames: async () => ({}),
    ...overrides,
  };
}

// ---- notification spy ----

function makeNotifications() {
  const calls = [];
  return {
    calls,
    createNotificationForNames: async (_db, input) => {
      calls.push({ fn: "createNotificationForNames", input });
      return null;
    },
    upsertCircleRequestNotification: async (_db, input) => {
      calls.push({ fn: "upsertCircleRequestNotification", input });
    },
  };
}

// ---- load a route with injected deps (fresh VM context per call) ----

function loadRoute(code, { db, circleDb, notifications, authName = "Alice", displayName }) {
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
            actor: authName ? { userId: `${authName.toLowerCase()}-id`, actorName: authName, displayName: displayName ?? authName } : null,
          }),
        };
      }
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName ? { userId: `${authName.toLowerCase()}-id`, actorName: authName, displayName: displayName ?? authName } : null,
        };
      }
      if (id === "@/lib/circle-db") return circleDb;
      if (id === "@/lib/notifications") return notifications;
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in circle-lifecycle tests: ${id}`);
    },
  });
  return mod.exports;
}

// ============================================================
// request/route.ts — sending a circle request
// ============================================================

test("request: self-request returns 400", async () => {
  const { POST } = loadRoute(src.request, {
    db: mockDb(),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });
  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Alice" }));
  assert.equal(status(res), 400);
});

test("request: empty name returns 400", async () => {
  const { POST } = loadRoute(src.request, {
    db: mockDb(),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });
  const res = await POST(makeReq({ senderName: "Alice", receiverName: "" }));
  assert.equal(status(res), 400);
});

test("request: logged-out user returns 401", async () => {
  const { POST } = loadRoute(src.request, {
    db: mockDb(),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
    authName: null,
  });
  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 401);
});

test("request: public account — sender immediately joins receiver's circle (one-way)", async () => {
  const notif = makeNotifications();
  const addCalls = [];

  const { POST } = loadRoute(src.request, {
    // inline DB: only the reverse-request check (returns empty → no reverse)
    db: mockDb({ data: [], error: null }),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "public",
      addCircleEdge: async (_db, a, b) => { addCalls.push([a, b]); return { error: null }; },
    }),
    notifications: notif,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 200);
  assert.equal(body(res).state, "CIRCLE_ONE_WAY");
  // edge: user_name=receiver(Bob), member_name=sender(Alice) — receiver owns the circle
  assert.deepEqual(addCalls[0], ["Bob", "Alice"]);
});

test("request: public account — target is NOT automatically added back to sender's circle", async () => {
  const addCalls = [];

  const { POST } = loadRoute(src.request, {
    db: mockDb({ data: [], error: null }),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "public",
      addCircleEdge: async (_db, a, b) => { addCalls.push([a, b]); return { error: null }; },
    }),
    notifications: makeNotifications(),
  });

  await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  // addCircleEdge must be called exactly once: Bob's circle gets Alice
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0][0], "Bob");
  assert.equal(addCalls[0][1], "Alice");
});

test("request matrix: public sender → public receiver creates one-way circle edge", async () => {
  const addCalls = [];
  const accountLookups = [];

  const { POST } = loadRoute(src.request, {
    db: mockDb({ data: [], error: null }),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async (_db, name) => {
        accountLookups.push(name);
        return "public";
      },
      addCircleEdge: async (_db, userName, memberName) => {
        addCalls.push([userName, memberName]);
        return { error: null };
      },
    }),
    notifications: makeNotifications(),
    authName: "Alice",
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));

  assert.equal(status(res), 200);
  assert.equal(body(res).state, "CIRCLE_ONE_WAY");
  assert.deepEqual(addCalls, [["Bob", "Alice"]]);
  assert.deepEqual(accountLookups, ["Bob"]);
});

test("request matrix: private sender → public receiver creates one-way circle edge", async () => {
  const addCalls = [];
  const accountLookups = [];

  const { POST } = loadRoute(src.request, {
    db: mockDb({ data: [], error: null }),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async (_db, name) => {
        accountLookups.push(name);
        return name === "Private Alice" ? "private" : "public";
      },
      addCircleEdge: async (_db, userName, memberName) => {
        addCalls.push([userName, memberName]);
        return { error: null };
      },
    }),
    notifications: makeNotifications(),
    authName: "Private Alice",
  });

  const res = await POST(makeReq({ senderName: "Private Alice", receiverName: "Bob" }));

  assert.equal(status(res), 200);
  assert.equal(body(res).state, "CIRCLE_ONE_WAY");
  assert.deepEqual(addCalls, [["Bob", "Private Alice"]]);
  assert.deepEqual(accountLookups, ["Bob"]);
});

test("request: public account — sends ADDED_TO_CIRCLE notification to receiver", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    db: mockDb({ data: [], error: null }), // circle_requests accepted-status cleanup
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "public",
      addCircleEdge: async () => ({ error: null }),
    }),
    notifications: notif,
  });

  await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));

  const addedNotif = notif.calls.find(
    (c) => c.fn === "createNotificationForNames" && c.input.type === "ADDED_TO_CIRCLE"
  );
  assert.ok(addedNotif, "should send ADDED_TO_CIRCLE notification to receiver");
  assert.equal(addedNotif.input.recipientName, "Bob");
  assert.equal(addedNotif.input.actorName, "Alice");
});

test("request: forged senderName is ignored in favor of authenticated actor", async () => {
  const addCalls = [];

  const { POST } = loadRoute(src.request, {
    db: mockDb({ data: [], error: null }),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "public",
      addCircleEdge: async (_db, a, b) => { addCalls.push([a, b]); return { error: null }; },
    }),
    notifications: makeNotifications(),
    authName: "Alice",
  });

  await POST(makeReq({ senderName: "Mallory", receiverName: "Bob" }));
  assert.deepEqual(addCalls[0], ["Bob", "Alice"]);
});

test("request: public account — duplicate add returns one_way without re-inserting edge", async () => {
  let addCalled = false;

  const { POST } = loadRoute(src.request, {
    db: mockDb(),
    circleDb: makeCircleDb({
      // hasCircleEdge(db, receiver="Bob", sender="Alice") → true: Alice already in Bob's circle
      hasCircleEdge: async (_db, user, member) => user === "Bob" && member === "Alice",
      addCircleEdge: async () => { addCalled = true; return { error: null }; },
    }),
    notifications: makeNotifications(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(body(res).status, "one_way");
  assert.equal(addCalled, false);
});

test("request: private account — creates PENDING request row", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    // inline DB: existing check → [], insert → new row
    db: mockDb(
      { data: [], error: null },                     // existing request check
      { data: { id: "req-1" }, error: null }         // insert new request
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "private",
    }),
    notifications: notif,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 200);
  assert.equal(body(res).state, "PENDING");
});

test("request: private account — sends CIRCLE_REQUEST_RECEIVED notification to receiver", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    db: mockDb(
      { data: [], error: null },
      { data: { id: "req-1" }, error: null }
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "private",
    }),
    notifications: notif,
  });

  await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));

  const call = notif.calls.find((c) => c.fn === "upsertCircleRequestNotification");
  assert.ok(call, "should upsert CIRCLE_REQUEST_RECEIVED notification");
  assert.equal(call.input.recipientName, "Bob");
  assert.equal(call.input.actorName, "Alice");
});

test("request: private account — duplicate pending request does not insert a second row", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    // existing pending found — no insert call
    db: mockDb(
      { data: [{ id: "req-1", status: "pending" }], error: null }    // existing pending
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "private",
    }),
    notifications: notif,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(body(res).state, "PENDING");
  // One upsert notification, no double-insert
  const upserts = notif.calls.filter((c) => c.fn === "upsertCircleRequestNotification");
  assert.equal(upserts.length, 1);
});

test("request: resend after rejection resets existing row to pending", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    // existing rejected found → update to pending → then notify
    db: mockDb(
      { data: [{ id: "req-1", status: "rejected" }], error: null },   // existing rejected
      { error: null }                                                  // update to pending
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "private",
    }),
    notifications: notif,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(body(res).state, "PENDING");
  const upserts = notif.calls.filter((c) => c.fn === "upsertCircleRequestNotification");
  assert.equal(upserts.length, 1);
});

test("request: reverse pending request is not auto-accepted", async () => {
  const notif = makeNotifications();
  let addCalled = false;

  const { POST } = loadRoute(src.request, {
    db: mockDb(
      { data: [], error: null },                             // no outgoing existing request
      { data: { id: "req-2" }, error: null }                // create outgoing pending request
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "private",
      addCircleEdge: async () => { addCalled = true; return { error: null }; },
    }),
    notifications: notif,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(body(res).state, "PENDING");
  assert.equal(addCalled, false);
  const upsert = notif.calls.find((c) => c.fn === "upsertCircleRequestNotification");
  assert.ok(upsert, "private request should notify receiver");
});

// ============================================================
// respond/route.ts — accept / reject
// ============================================================

test("respond: accept pending request → CIRCLE_ONE_WAY + receiver edge created", async () => {
  let addCalls = [];

  const { POST } = loadRoute(src.respond, {
    db: mockDb(
      { data: { id: "req-1", status: "pending" }, error: null }, // maybeSingle: request row
      { error: null },                                            // update status → accepted
      { error: null }                                             // mark notification read
    ),
    circleDb: makeCircleDb({
      addCircleEdge: async (_db, userName, memberName) => {
        addCalls.push([userName, memberName]);
        return { error: null };
      },
    }),
    notifications: makeNotifications(),
    authName: "Bob",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));
  assert.equal(body(res).ok, true);
  assert.equal(body(res).state, "CIRCLE_ONE_WAY");
  assert.deepEqual(addCalls, [["Bob", "Alice"]]);
});

test("request matrix: public sender → private receiver stays pending, then accept creates one-way edge", async () => {
  const requestRoute = loadRoute(src.request, {
    db: mockDb(
      { data: [], error: null },
      { data: [], error: null },
      { data: { id: "req-public-private" }, error: null }
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async (_db, name) => name === "Private Bob" ? "private" : "public",
    }),
    notifications: makeNotifications(),
    authName: "Alice",
  });

  const requestRes = await requestRoute.POST(makeReq({ senderName: "Alice", receiverName: "Private Bob" }));
  assert.equal(status(requestRes), 200);
  assert.equal(body(requestRes).state, "PENDING");

  const addCalls = [];
  const respondRoute = loadRoute(src.respond, {
    db: mockDb(
      { data: { id: "req-public-private", status: "pending" }, error: null },
      { error: null },
      { error: null }
    ),
    circleDb: makeCircleDb({
      addCircleEdge: async (_db, userName, memberName) => {
        addCalls.push([userName, memberName]);
        return { error: null };
      },
    }),
    notifications: makeNotifications(),
    authName: "Private Bob",
  });

  const acceptRes = await respondRoute.POST(makeReq({ senderName: "Alice", action: "accept" }));
  assert.equal(status(acceptRes), 200);
  assert.equal(body(acceptRes).state, "CIRCLE_ONE_WAY");
  assert.deepEqual(addCalls, [["Private Bob", "Alice"]]);
});

test("request matrix: private sender → private receiver stays pending, then accept creates one-way edge", async () => {
  const requestRoute = loadRoute(src.request, {
    db: mockDb(
      { data: [], error: null },
      { data: [], error: null },
      { data: { id: "req-private-private" }, error: null }
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async (_db, name) =>
        name === "Private Bob" || name === "Private Alice" ? "private" : "public",
    }),
    notifications: makeNotifications(),
    authName: "Private Alice",
  });

  const requestRes = await requestRoute.POST(makeReq({ senderName: "Private Alice", receiverName: "Private Bob" }));
  assert.equal(status(requestRes), 200);
  assert.equal(body(requestRes).state, "PENDING");

  const addCalls = [];
  const respondRoute = loadRoute(src.respond, {
    db: mockDb(
      { data: { id: "req-private-private", status: "pending" }, error: null },
      { error: null },
      { error: null }
    ),
    circleDb: makeCircleDb({
      addCircleEdge: async (_db, userName, memberName) => {
        addCalls.push([userName, memberName]);
        return { error: null };
      },
    }),
    notifications: makeNotifications(),
    authName: "Private Bob",
  });

  const acceptRes = await respondRoute.POST(makeReq({ senderName: "Private Alice", action: "accept" }));
  assert.equal(status(acceptRes), 200);
  assert.equal(body(acceptRes).state, "CIRCLE_ONE_WAY");
  assert.deepEqual(addCalls, [["Private Bob", "Private Alice"]]);
});

test("respond: accept sends CIRCLE_REQUEST_ACCEPTED notification to original sender", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.respond, {
    db: mockDb(
      { data: { id: "req-1", status: "pending" }, error: null },
      { error: null },
      { error: null }
    ),
    circleDb: makeCircleDb(),
    notifications: notif,
    authName: "Bob",
  });

  await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));

  const acceptNotif = notif.calls.find(
    (c) => c.fn === "createNotificationForNames" && c.input.type === "CIRCLE_REQUEST_ACCEPTED"
  );
  assert.ok(acceptNotif, "should send accepted notification");
  assert.equal(acceptNotif.input.recipientName, "Alice");
  assert.equal(acceptNotif.input.actorName, "Bob");
});

test("respond: reject pending request → NONE, no circle edges created", async () => {
  let addCalled = false;

  const { POST } = loadRoute(src.respond, {
    db: mockDb(
      { data: { id: "req-1", status: "pending" }, error: null },
      { error: null },
      { error: null }
    ),
    circleDb: makeCircleDb({
      addCircleEdge: async () => { addCalled = true; return { error: null }; },
    }),
    notifications: makeNotifications(),
    authName: "Bob",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "reject" }));
  assert.equal(body(res).ok, true);
  assert.equal(body(res).state, "NONE");
  assert.equal(addCalled, false);
});

test("respond: double accept is idempotent — returns CIRCLE_ONE_WAY without re-inserting edges", async () => {
  let addCalled = false;

  const { POST } = loadRoute(src.respond, {
    db: mockDb({ data: { id: "req-1", status: "accepted" }, error: null }),
    circleDb: makeCircleDb({
      addCircleEdge: async () => { addCalled = true; return { error: null }; },
    }),
    notifications: makeNotifications(),
    authName: "Bob",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));
  assert.equal(body(res).state, "CIRCLE_ONE_WAY");
  assert.equal(addCalled, false);
});

test("respond: double reject is idempotent — returns NONE", async () => {
  const { POST } = loadRoute(src.respond, {
    db: mockDb({ data: { id: "req-1", status: "rejected" }, error: null }),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
    authName: "Bob",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "reject" }));
  assert.equal(body(res).state, "NONE");
});

test("respond: stale accept on a non-pending request (cancelled/rejected) returns 409", async () => {
  const { POST } = loadRoute(src.respond, {
    db: mockDb({ data: { id: "req-1", status: "cancelled" }, error: null }),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
    authName: "Bob",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));
  assert.equal(status(res), 409);
});

test("respond: accept when no request exists returns 404", async () => {
  const { POST } = loadRoute(src.respond, {
    db: mockDb({ data: null, error: null }),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
    authName: "Bob",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));
  assert.equal(status(res), 404);
});

test("respond: invalid action returns 400", async () => {
  const { POST } = loadRoute(src.respond, {
    db: mockDb(),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "follow" }));
  assert.equal(status(res), 400);
});

// ============================================================
// cancel/route.ts — cancelling a pending request
// ============================================================

test("cancel: removes pending request and soft-deletes receiver notification", async () => {
  const { POST } = loadRoute(src.cancel, {
    db: mockDb(
      { data: { status: "pending" }, error: null }, // pre-check: request is pending
      { error: null },                              // delete pending request row
      { error: null }                               // soft-delete notification
    ),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(body(res).ok, true);
});

test("cancel: logged-out user returns 401", async () => {
  const { POST } = loadRoute(src.cancel, {
    db: mockDb(),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
    authName: null,
  });

  const res = await POST(makeReq({ senderName: "", receiverName: "Bob" }));
  assert.equal(status(res), 401);
});

test("cancel: missing receiverName returns 400", async () => {
  const { POST } = loadRoute(src.cancel, {
    db: mockDb(),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "" }));
  assert.equal(status(res), 400);
});

test("cancel: db error on delete returns 500", async () => {
  const { POST } = loadRoute(src.cancel, {
    db: mockDb(
      { data: { status: "pending" }, error: null },            // pre-check passes
      { error: { message: "connection lost", code: "500" } }   // delete fails
    ),
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 500);
});

test("cancel: cancelling an already-accepted request returns 409", async () => {
  const { POST } = loadRoute(src.cancel, {
    db: mockDb({ data: { status: "accepted" }, error: null }), // pre-check: request is accepted
    circleDb: makeCircleDb(),
    notifications: makeNotifications(),
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 409);
});

// ============================================================
// displayName in notification messages
// ============================================================

test("request: ADDED_TO_CIRCLE notification message uses displayName, not actorName", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    db: mockDb({ data: [], error: null }), // circle_requests accepted-status cleanup
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "public",
      addCircleEdge: async () => ({ error: null }),
    }),
    notifications: notif,
    authName: "alice",
    displayName: "Alice Ate",
  });

  await POST(makeReq({ senderName: "alice", receiverName: "Bob" }));

  const n = notif.calls.find((c) => c.fn === "createNotificationForNames" && c.input.type === "ADDED_TO_CIRCLE");
  assert.ok(n, "ADDED_TO_CIRCLE notification should fire");
  assert.ok(n.input.message.includes("Alice Ate"), `message should contain displayName; got: ${n.input.message}`);
  assert.ok(!n.input.message.includes("alice"), `message should not contain actorName; got: ${n.input.message}`);
});

test("request: CIRCLE_REQUEST_RECEIVED notification message uses displayName, not actorName", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.request, {
    db: mockDb(
      { data: [], error: null },              // existing request check
      { data: { id: "req-1" }, error: null }  // insert new request
    ),
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "private",
    }),
    notifications: notif,
    authName: "alice",
    displayName: "Alice Ate",
  });

  await POST(makeReq({ senderName: "alice", receiverName: "Bob" }));

  const n = notif.calls.find((c) => c.fn === "upsertCircleRequestNotification");
  assert.ok(n, "upsertCircleRequestNotification should fire");
  assert.ok(n.input.message.includes("Alice Ate"), `message should contain displayName; got: ${n.input.message}`);
  assert.ok(!n.input.message.includes("alice"), `message should not contain actorName; got: ${n.input.message}`);
});

test("respond: CIRCLE_REQUEST_ACCEPTED notification message uses responder's displayName", async () => {
  const notif = makeNotifications();

  const { POST } = loadRoute(src.respond, {
    db: mockDb(
      { data: { id: "req-1", status: "pending" }, error: null },
      { error: null },
      { error: null }
    ),
    circleDb: makeCircleDb(),
    notifications: notif,
    authName: "bob",
    displayName: "Bob Bites",
  });

  await POST(makeReq({ myName: "bob", senderName: "Alice", action: "accept" }));

  const n = notif.calls.find(
    (c) => c.fn === "createNotificationForNames" && c.input.type === "CIRCLE_REQUEST_ACCEPTED"
  );
  assert.ok(n, "CIRCLE_REQUEST_ACCEPTED notification should fire");
  assert.ok(n.input.message.includes("Bob Bites"), `message should contain displayName; got: ${n.input.message}`);
  assert.ok(!n.input.message.includes("bob"), `message should not contain actorName; got: ${n.input.message}`);
});
