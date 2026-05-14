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

const src = {
  list: transpile(readFileSync(new URL("../app/api/notifications/route.ts", import.meta.url), "utf8")),
  unreadCount: transpile(readFileSync(new URL("../app/api/notifications/unread-count/route.ts", import.meta.url), "utf8")),
  read: transpile(readFileSync(new URL("../app/api/notifications/[notificationId]/read/route.ts", import.meta.url), "utf8")),
  readAll: transpile(readFileSync(new URL("../app/api/notifications/read-all/route.ts", import.meta.url), "utf8")),
  remove: transpile(readFileSync(new URL("../app/api/notifications/[notificationId]/route.ts", import.meta.url), "utf8")),
};

const mockNextResponse = {
  json(body, opts) {
    return { _body: body, _status: opts?.status ?? 200 };
  },
};

function body(res) {
  return res._body;
}

function status(res) {
  return res._status;
}

function makeReq(query = "") {
  return { nextUrl: { searchParams: new URLSearchParams(query) } };
}

function params(notificationId = "notif-1") {
  return { params: Promise.resolve({ notificationId }) };
}

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    get _calls() {
      return calls;
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) {
          return next().then(res, rej);
        },
        catch(rej) {
          return next().catch(rej);
        },
      };
      for (const m of ["select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains"]) {
        chain[m] = (...args) => {
          entry.ops.push([m, ...args]);
          return chain;
        };
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

function opArgs(entry, name) {
  const op = entry.ops.find(([opName]) => opName === name);
  return op?.slice(1) ?? [];
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

function mergeNotifications(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const notification of group ?? []) {
      const createdAt = notification.created_at ?? "2026-01-01T00:00:00.000Z";
      byId.set(notification.id, {
        read: false,
        is_read: false,
        updated_at: createdAt,
        created_at: createdAt,
        ...notification,
      });
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()
  );
}

function loadRoute(code, {
  db,
  admin = db,
  viewer = { id: "viewer-id", name: "Alice" },
  filterValidNotifications = async (_db, notifications) => notifications,
} = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    URLSearchParams,
    require(id) {
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/types") return {};
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
      if (id === "@/lib/profile-names") {
        return {
          profileDisplayName: (profile, fallback = "") =>
            [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || fallback,
        };
      }
      if (id.endsWith("_utils")) {
        return {
          createRouteSupabase: async () => db,
          getNotificationViewer: async () => viewer,
          isNotificationSchemaError: (error) => error?.code === "42703" || error?.code === "PGRST204",
          unauthorized: () => mockNextResponse.json({ error: "Unauthorized" }, { status: 401 }),
          mergeNotifications,
          filterValidNotifications,
        };
      }
      throw new Error(`Unexpected require in notification route tests: ${id}`);
    },
  });
  return mod.exports;
}

test("unread count: logged-out direct API call is rejected", async () => {
  const { GET } = loadRoute(src.unreadCount, {
    db: spyDb(),
    viewer: null,
  });

  const res = await GET();
  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Unauthorized");
});

test("notification list: resolves actor usernames to display names through admin profile lookup", async () => {
  const db = spyDb(
    {
      data: [
        {
          id: "notif-1",
          recipient_user_id: "viewer-id",
          actor_user_id: "rahul-id",
          actor_name: "rahul_gupta",
          type: "POST_COMMENTED",
          message: "rahul_gupta commented on your post",
          created_at: "2026-01-04T00:00:00.000Z",
        },
      ],
      error: null,
    },
    { data: [], error: null }
  );
  const admin = spyDb(
    {
      data: [
        {
          id: "rahul-id",
          username: "rahul_gupta",
          first_name: "Rahul",
          last_name: "Gupta",
        },
      ],
      error: null,
    },
    {
      data: [
        {
          id: "rahul-id",
          username: "rahul_gupta",
          first_name: "Rahul",
          last_name: "Gupta",
        },
      ],
      error: null,
    }
  );
  const { GET } = loadRoute(src.list, { db, admin });

  const res = await GET(makeReq());

  assert.equal(status(res), 200);
  assert.equal(body(res).profileMap.rahul_gupta, "Rahul Gupta");
  assert.equal(admin._calls.length, 2);
  assert.equal(admin._calls[0].table, "profiles");
  assert.equal(admin._calls[1].table, "profiles");
});

test("unread count: combines user-id and legacy-name rows without double-counting", async () => {
  const db = spyDb(
    { data: [{ id: "notif-1" }, { id: "notif-2" }], error: null },
    { data: [{ id: "notif-2" }, { id: "notif-3" }], error: null }
  );
  const { GET } = loadRoute(src.unreadCount, { db });

  const res = await GET();

  assert.equal(status(res), 200);
  assert.equal(body(res).unreadCount, 3);
  assert.equal(eqFilters(db._calls[0]).recipient_user_id, "viewer-id");
  assert.equal(eqFilters(db._calls[1]).recipient_name, "Alice");
});

test("unread count: filters stale unread rows before counting badge total", async () => {
  const db = spyDb(
    {
      data: [
        { id: "stale", type: "CIRCLE_REQUEST_RECEIVED", recipient_name: "Alice", actor_name: "Rahul", created_at: "2026-01-01T00:00:00.000Z" },
        { id: "valid", type: "POST_LIKED", recipient_name: "Alice", actor_name: "Priya", created_at: "2026-01-02T00:00:00.000Z" },
      ],
      error: null,
    },
    { data: [{ id: "valid", type: "POST_LIKED", recipient_name: "Alice", actor_name: "Priya", created_at: "2026-01-02T00:00:00.000Z" }], error: null }
  );
  const filterCalls = [];
  const { GET } = loadRoute(src.unreadCount, {
    db,
    filterValidNotifications: async (_db, notifications) => {
      filterCalls.push(notifications.map((notification) => notification.id));
      return notifications.filter((notification) => notification.id !== "stale");
    },
  });

  const res = await GET();

  assert.equal(status(res), 200);
  assert.equal(body(res).unreadCount, 1);
  assert.deepEqual(filterCalls, [["valid", "stale"]]);
  assert.equal(opArgs(db._calls[0], "select")[0], "*");
  assert.equal(opArgs(db._calls[1], "select")[0], "*");
});

test("unread count: matches client read-state logic across is_read and legacy read flags", async () => {
  const db = spyDb(
    {
      data: [
        { id: "modern-read", is_read: true, read: false, created_at: "2026-01-03T00:00:00.000Z" },
        { id: "legacy-read", is_read: false, read: true, created_at: "2026-01-02T00:00:00.000Z" },
        { id: "unread", is_read: false, read: false, created_at: "2026-01-01T00:00:00.000Z" },
      ],
      error: null,
    },
    { data: [], error: null }
  );
  const { GET } = loadRoute(src.unreadCount, { db });

  const res = await GET();

  assert.equal(status(res), 200);
  assert.equal(body(res).unreadCount, 1);
});

test("mark read: cannot mark another recipient notification", async () => {
  const db = spyDb({
    data: { id: "notif-1", recipient_user_id: "other-id", recipient_name: "Alice" },
    error: null,
  });
  const { PATCH } = loadRoute(src.read, { db });

  const res = await PATCH({}, params());

  assert.equal(status(res), 404);
  assert.equal(db._calls.filter((call) => hasOp(call, "update")).length, 0);
});

test("mark read: marks owned notification read", async () => {
  const db = spyDb(
    { data: { id: "notif-1", recipient_user_id: "viewer-id", recipient_name: "Alice" }, error: null },
    { error: null }
  );
  const { PATCH } = loadRoute(src.read, { db });

  const res = await PATCH({}, params());

  assert.equal(status(res), 200);
  const update = db._calls.find((call) => hasOp(call, "update"));
  assert.equal(opArgs(update, "update")[0].is_read, true);
  assert.equal(opArgs(update, "update")[0].read, true);
  assert.equal(eqFilters(update).id, "notif-1");
});

test("delete notification: soft-deletes only owned notifications", async () => {
  const db = spyDb(
    { data: { id: "notif-1", recipient_user_id: "viewer-id", recipient_name: "Alice" }, error: null },
    { error: null }
  );
  const { DELETE } = loadRoute(src.remove, { db });

  const res = await DELETE({}, params());

  assert.equal(status(res), 200);
  const update = db._calls.find((call) => hasOp(call, "update"));
  assert.equal(typeof opArgs(update, "update")[0].deleted_at, "string");
  assert.equal(typeof opArgs(update, "update")[0].updated_at, "string");
  assert.equal(eqFilters(update).id, "notif-1");
});

test("delete notification: cannot delete another recipient notification", async () => {
  const db = spyDb({
    data: { id: "notif-1", recipient_user_id: "other-id", recipient_name: "Alice" },
    error: null,
  });
  const { DELETE } = loadRoute(src.remove, { db });

  const res = await DELETE({}, params());

  assert.equal(status(res), 404);
  assert.equal(db._calls.filter((call) => hasOp(call, "update") || hasOp(call, "delete")).length, 0);
});

test("read all: updates both authenticated user-id rows and legacy name rows", async () => {
  const db = spyDb({ error: null }, { error: null });
  const { PATCH } = loadRoute(src.readAll, { db });

  const res = await PATCH();

  assert.equal(status(res), 200);
  const updates = db._calls.filter((call) => hasOp(call, "update"));
  assert.equal(updates.length, 2);
  assert.equal(eqFilters(updates[0]).recipient_user_id, "viewer-id");
  assert.equal(eqFilters(updates[1]).recipient_name, "Alice");
  assert.equal(opArgs(updates[0], "update")[0].is_read, true);
  assert.equal(opArgs(updates[1], "update")[0].read, true);
});

test("unread count: legacy schema path (42703 error) passes rows through filterValidNotifications before counting", async () => {
  // byId triggers schema error → legacy path fetches by name, runs filter, then counts isUnread rows
  const db = spyDb(
    { data: null, error: { code: "42703", message: "column deleted_at does not exist" } }, // byId: schema error
    { data: null, error: { code: "42703", message: "column deleted_at does not exist" } }, // byName: schema error
    {
      data: [
        { id: "stale", type: "CIRCLE_REQUEST_RECEIVED", recipient_name: "Alice", actor_name: "Rahul", read: false, is_read: false, created_at: "2026-01-01T00:00:00.000Z" },
        { id: "read-notif", type: "POST_LIKED", recipient_name: "Alice", actor_name: "Priya", read: true, is_read: false, created_at: "2026-01-02T00:00:00.000Z" },
        { id: "unread", type: "POST_LIKED", recipient_name: "Alice", actor_name: "Dev", read: false, is_read: false, created_at: "2026-01-03T00:00:00.000Z" },
      ],
      error: null,
    }
  );
  const { GET } = loadRoute(src.unreadCount, {
    db,
    filterValidNotifications: async (_db, notifications) =>
      notifications.filter((n) => n.id !== "stale"),
  });

  const res = await GET();

  assert.equal(status(res), 200);
  // "stale" removed by filter, "read-notif" excluded by isUnread, only "unread" counted
  assert.equal(body(res).unreadCount, 1);
});

test("notification list: profileMap is empty object when there are no notifications", async () => {
  const db = spyDb(
    { data: [], error: null },  // byId: empty
    { data: [], error: null }   // byName: empty
  );
  const admin = spyDb(); // must not be called

  const { GET } = loadRoute(src.list, { db, admin });
  const res = await GET(makeReq());

  assert.equal(status(res), 200);
  assert.equal(Object.keys(body(res).profileMap).length, 0);
  assert.equal(admin._calls.length, 0, "should not query profiles when there are no notifications");
});

test("notification list: profileMap uses actor username as key for notifications with only actor_user_id", async () => {
  // actor_name is null — only actor_user_id is present
  const db = spyDb(
    {
      data: [{ id: "notif-1", actor_user_id: "rahul-id", actor_name: null, type: "POST_LIKED", created_at: "2026-01-01T00:00:00.000Z" }],
      error: null,
    },
    { data: [], error: null }   // byName
  );
  // actorNames=[] → byUsername branch uses Promise.resolve (no admin call); byId branch consumes idx 0
  const admin = spyDb(
    { data: [{ id: "rahul-id", username: "rahul_gupta", first_name: "Rahul", last_name: "Gupta" }], error: null }  // byId
  );

  const { GET } = loadRoute(src.list, { db, admin });
  const res = await GET(makeReq());

  assert.equal(status(res), 200);
  // Profile is keyed by username from the profile row, not by null actor_name
  assert.equal(body(res).profileMap["rahul_gupta"], "Rahul Gupta");
  assert.equal("null" in body(res).profileMap, false);
});

test("notification list: clamps limit, merges duplicate rows, and filters final list", async () => {
  const db = spyDb(
    {
      data: [
        { id: "notif-1", recipient_user_id: "viewer-id", created_at: "2026-01-01T00:00:00.000Z" },
        { id: "notif-2", recipient_user_id: "viewer-id", created_at: "2026-01-02T00:00:00.000Z" },
      ],
      error: null,
    },
    {
      data: [
        { id: "notif-2", recipient_name: "Alice", created_at: "2026-01-03T00:00:00.000Z" },
        { id: "notif-3", recipient_name: "Alice", created_at: "2026-01-04T00:00:00.000Z" },
      ],
      error: null,
    }
  );
  const filterCalls = [];
  const { GET } = loadRoute(src.list, {
    db,
    filterValidNotifications: async (_db, notifications) => {
      filterCalls.push(notifications.map((notification) => notification.id));
      return notifications.filter((notification) => notification.id !== "notif-2");
    },
  });

  const res = await GET(makeReq("limit=999"));

  assert.equal(status(res), 200);
  assert.deepEqual(body(res).notifications.map((notification) => notification.id), ["notif-3", "notif-1"]);
  assert.deepEqual(filterCalls, [["notif-3", "notif-2", "notif-1"]]);
  assert.equal(opArgs(db._calls[0], "limit")[0], 100);
  assert.equal(opArgs(db._calls[1], "limit")[0], 100);
});
