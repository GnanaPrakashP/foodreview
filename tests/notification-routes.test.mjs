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

function loadRoute(code, { db, viewer = { id: "viewer-id", name: "Alice" }, filterValidNotifications = async (_db, notifications) => notifications } = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    URLSearchParams,
    require(id) {
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/types") return {};
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
  assert.equal(eqFilters(db._calls[0]).is_read, false);
  assert.equal(eqFilters(db._calls[1]).recipient_name, "Alice");
  assert.equal(eqFilters(db._calls[1]).is_read, false);
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
