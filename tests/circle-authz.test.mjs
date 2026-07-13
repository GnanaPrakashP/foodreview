import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createApiSecurityStub } from "./helpers/api-security-stub.mjs";

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
  request: transpile(readFileSync(new URL("../app/api/circle/request/route.ts", import.meta.url), "utf8")),
  respond: transpile(readFileSync(new URL("../app/api/circle/respond/route.ts", import.meta.url), "utf8")),
  cancel: transpile(readFileSync(new URL("../app/api/circle/cancel/route.ts", import.meta.url), "utf8")),
  remove: transpile(readFileSync(new URL("../app/api/circle/remove/route.ts", import.meta.url), "utf8")),
  status: transpile(readFileSync(new URL("../app/api/circle/status/route.ts", import.meta.url), "utf8")),
  acceptById: transpile(readFileSync(new URL("../app/api/circle-requests/[requestId]/accept/route.ts", import.meta.url), "utf8")),
  rejectById: transpile(readFileSync(new URL("../app/api/circle-requests/[requestId]/reject/route.ts", import.meta.url), "utf8")),
};

const schemaSql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

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

function eqFilters(entry) {
  return Object.fromEntries(
    entry.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val])
  );
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

const mockNextResponse = {
  json(body, opts) { return { _body: body, _status: opts?.status ?? 200 }; },
};

function makeReq(body) { return { json: async () => body }; }
function makeStatusReq(name) { return { nextUrl: { searchParams: new URLSearchParams(name ? `name=${encodeURIComponent(name)}` : "") } }; }
function body(res) { return res._body; }
function status(res) { return res._status; }

function makeCircleDb(overrides = {}) {
  return {
    hasCircleEdge: async () => false,
    addCircleEdge: async () => ({ error: null }),
    getAccountTypeForName: async () => "public",
    getAccountTypesForNames: async () => ({}),
    ...overrides,
  };
}

function makeNotifications() {
  return {
    createNotificationForNames: async () => null,
    upsertCircleRequestNotification: async () => {},
  };
}

function loadRoute(code, { db, circleDb = makeCircleDb(), notifications = makeNotifications(), authName = "Alice" }) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    process: { env: {} },
    URLSearchParams,
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
      if (id === "@/lib/notifications") return notifications;
      if (id === "@/app/api/notifications/_utils") {
        return {
          createRouteSupabase: async () => db,
          getNotificationViewer: async () => authName ? { id: `${authName.toLowerCase()}-id`, name: authName } : null,
          unauthorized: () => mockNextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
      }
      if (id === "@/lib/circle") return { DEFAULT_ACCOUNT_TYPE: "public" };
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in circle authz tests: ${id}`);
    },
  });
  return mod.exports;
}

test("request: forged senderName is blocked by using authenticated actor", async () => {
  const addCalls = [];
  const { POST } = loadRoute(src.request, {
    db: spyDb({ data: [], error: null }),
    authName: "Alice",
    circleDb: makeCircleDb({
      hasCircleEdge: async () => false,
      getAccountTypeForName: async () => "public",
      addCircleEdge: async (_db, userName, memberName) => {
        addCalls.push([userName, memberName]);
        return { error: null };
      },
    }),
  });

  const res = await POST(makeReq({ senderName: "Mallory", receiverName: "Bob" }));
  assert.equal(status(res), 200);
  assert.deepEqual(addCalls, [["Bob", "Alice"]]);
});

test("request: logged-out direct API call is rejected", async () => {
  const { POST } = loadRoute(src.request, {
    db: spyDb(),
    authName: null,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 401);
});

test("respond: forged myName cannot accept as another receiver", async () => {
  const db = spyDb({ data: null, error: null });
  const { POST } = loadRoute(src.respond, {
    db,
    authName: "Charlie",
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));
  assert.equal(status(res), 404);
  assert.equal(eqFilters(db._calls[0]).receiver_name, "Charlie");
});

test("respond: logged-out direct API call is rejected", async () => {
  const { POST } = loadRoute(src.respond, {
    db: spyDb(),
    authName: null,
  });

  const res = await POST(makeReq({ myName: "Bob", senderName: "Alice", action: "accept" }));
  assert.equal(status(res), 401);
});

test("cancel: forged senderName cannot cancel another user's outgoing request", async () => {
  const db = spyDb(
    { data: null, error: null },
    { error: null },
    { error: null }
  );
  const { POST } = loadRoute(src.cancel, {
    db,
    authName: "Alice",
  });

  const res = await POST(makeReq({ senderName: "Mallory", receiverName: "Bob" }));
  assert.equal(status(res), 200);
  assert.equal(eqFilters(db._calls[0]).sender_name, "Alice");
  assert.equal(eqFilters(db._calls[0]).receiver_name, "Bob");
});

test("cancel: logged-out direct API call is rejected", async () => {
  const { POST } = loadRoute(src.cancel, {
    db: spyDb(),
    authName: null,
  });

  const res = await POST(makeReq({ senderName: "Alice", receiverName: "Bob" }));
  assert.equal(status(res), 401);
});

test("remove: forged myName cannot remove as another user", async () => {
  const db = spyDb(
    { data: [], error: null },
    { error: null },
    { error: null },
    { error: null }
  );
  const { POST } = loadRoute(src.remove, {
    db,
    authName: "Alice",
  });

  const res = await POST(makeReq({ myName: "Mallory", otherName: "Bob" }));
  assert.equal(status(res), 200);

  const deleteEntry = db._calls.find((call) => call.table === "circle_memberships" && hasOp(call, "delete"));
  assert.equal(eqFilters(deleteEntry).user_name, "Bob");
  assert.equal(eqFilters(deleteEntry).member_name, "Alice");
});

test("remove: logged-out direct API call is rejected", async () => {
  const { POST } = loadRoute(src.remove, {
    db: spyDb(),
    authName: null,
  });

  const res = await POST(makeReq({ myName: "Alice", otherName: "Bob" }));
  assert.equal(status(res), 401);
});

test("accept by id: only the rightful receiver can accept", async () => {
  const { POST } = loadRoute(src.acceptById, {
    db: spyDb({ data: { id: "req-1", sender_name: "Alice", receiver_name: "Bob", status: "pending" }, error: null }),
    authName: "Charlie",
  });

  const res = await POST(makeReq({}), { params: Promise.resolve({ requestId: "req-1" }) });
  assert.equal(status(res), 404);
});

test("reject by id: only the rightful receiver can reject", async () => {
  const { POST } = loadRoute(src.rejectById, {
    db: spyDb({ data: { id: "req-1", sender_name: "Alice", receiver_name: "Bob", status: "pending" }, error: null }),
    authName: "Charlie",
  });

  const res = await POST(makeReq({}), { params: Promise.resolve({ requestId: "req-1" }) });
  assert.equal(status(res), 404);
});

test("status: pending request lists are hidden for other users", async () => {
  const db = spyDb(
    { data: [], error: null },
    { data: [{ sender_name: "Alice", receiver_name: "Bob", status: "pending" }], error: null }
  );
  const { GET } = loadRoute(src.status, {
    db,
    authName: "Alice",
    circleDb: makeCircleDb({
      getAccountTypeForName: async () => "public",
      getAccountTypesForNames: async () => ({}),
    }),
  });

  const res = await GET(makeStatusReq("Bob"));
  assert.equal(body(res).pendingIncoming.length, 0);
  assert.equal(body(res).pendingSent.length, 0);
  assert.equal(Object.keys(body(res).memberStates).length, 0);
});

test("status: owner sees pending requests and relationship states", async () => {
  const accountTypeNames = [];
  const db = spyDb(
    {
      data: [
        { user_name: "Alice", member_name: "Bob" },
        { user_name: "Carol", member_name: "Alice" },
        { user_name: "Alice", member_name: "Dave" },
        { user_name: "Dave", member_name: "Alice" },
      ],
      error: null,
    },
    {
      data: [
        { sender_name: "AcceptedOnly", receiver_name: "Alice", status: "accepted" },
        { sender_name: "Erin", receiver_name: "Alice", status: "pending" },
        { sender_name: "Alice", receiver_name: "Frank", status: "pending" },
        { sender_name: "Grace", receiver_name: "Alice", status: "rejected" },
      ],
      error: null,
    }
  );
  const { GET } = loadRoute(src.status, {
    db,
    authName: "Alice",
    circleDb: makeCircleDb({
      getAccountTypeForName: async () => "private",
      getAccountTypesForNames: async (_db, names) => {
        accountTypeNames.push(...names);
        return Object.fromEntries(names.map((name) => [name, name === "Frank" ? "private" : "public"]));
      },
    }),
  });

  const res = await GET(makeStatusReq("Alice"));

  assert.equal(status(res), 200);
  assert.equal(body(res).accountType, "private");
  assert.deepEqual(Array.from(body(res).circleMembers).sort(), ["Bob", "Dave"]);
  assert.deepEqual(Array.from(body(res).joinedCircles).sort(), ["Carol", "Dave"]);
  assert.deepEqual(Array.from(body(res).mutualMembers), []);
  assert.deepEqual(Array.from(body(res).oneWayMembers).sort(), ["Carol", "Dave"]);
  assert.deepEqual(Array.from(body(res).pendingIncoming), ["Erin"]);
  assert.deepEqual(Array.from(body(res).pendingSent), ["Frank"]);
  assert.equal(body(res).memberStates.Carol, "CIRCLE_ONE_WAY");
  assert.equal(body(res).memberStates.Dave, "CIRCLE_ONE_WAY");
  assert.equal(body(res).memberStates.AcceptedOnly, undefined);
  assert.equal(body(res).memberStates.Frank, "PENDING");
  assert.equal(body(res).circleCount, 2);
  assert.ok(accountTypeNames.includes("Erin"));
  assert.ok(accountTypeNames.includes("Frank"));
});

test("schema: Circle RLS does not allow direct client mutation", () => {
  assert.match(schemaSql, /drop policy if exists "Anyone can send circle request"/);
  assert.match(schemaSql, /drop policy if exists "Anyone can respond to circle request"/);
  assert.match(schemaSql, /drop policy if exists "Anyone can delete circle request"/);
  assert.match(schemaSql, /drop policy if exists "Anyone can add to circle"/);
  assert.match(schemaSql, /drop policy if exists "Anyone can remove from circle"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can send circle request"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can respond to circle request"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can delete circle request"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can add to circle"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can remove from circle"/);
});

test("schema: notification RLS is recipient-scoped", () => {
  assert.match(schemaSql, /drop policy if exists "Notifications readable by everyone"/);
  assert.match(schemaSql, /drop policy if exists "Anyone can create notifications"/);
  assert.match(schemaSql, /drop policy if exists "Anyone can mark read"/);
  assert.match(schemaSql, /create policy "Notifications readable by recipient"/);
  assert.match(schemaSql, /create policy "Users can mark own notifications read"/);
  assert.doesNotMatch(schemaSql, /create policy "Notifications readable by everyone"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can create notifications"/);
  assert.doesNotMatch(schemaSql, /create policy "Anyone can mark read"/);
});
