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

function loadUtils({ profileName = "Alice" } = {}) {
  const source = readFileSync(new URL("../app/api/notifications/_utils.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    process: { env: {} },
    require(id) {
      if (id === "@supabase/ssr") return { createServerClient: () => ({}) };
      if (id === "next/headers") return { cookies: async () => ({ getAll: () => [] }) };
      if (id === "@/lib/server/route-supabase") return { createRouteSupabase: async () => ({}) };
      if (id === "next/server") {
        return {
          NextResponse: {
            json(body, opts) {
              return { _body: body, _status: opts?.status ?? 200 };
            },
          },
        };
      }
      if (id === "@/lib/notifications") {
        return {
          getAuthenticatedProfileName: async () => profileName,
        };
      }
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in notification utils tests: ${id}`);
    },
  });
  return mod.exports;
}

function tableDb(responsesByTable = {}) {
  const calls = [];
  const queues = new Map(
    Object.entries(responsesByTable).map(([table, responses]) => [table, [...responses]])
  );

  return {
    get _calls() {
      return calls;
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(
        queues.get(table)?.shift() ?? { data: [], error: null }
      );
      const chain = {
        then(res, rej) {
          return next().then(res, rej);
        },
        catch(rej) {
          return next().catch(rej);
        },
      };
      for (const m of [
        "select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains",
      ]) {
        chain[m] = (...args) => {
          entry.ops.push([m, ...args]);
          return chain;
        };
      }
      return chain;
    },
  };
}

function opArgs(entry, name) {
  const op = entry.ops.find(([opName]) => opName === name);
  return op?.slice(1) ?? [];
}

function notif(id, type, extra = {}) {
  return {
    id,
    type,
    recipient_name: "Bob",
    actor_name: "Alice",
    post_id: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

test("notification utils: unauthorized returns a 401 JSON response", () => {
  const { unauthorized } = loadUtils();

  const res = unauthorized();

  assert.equal(res._status, 401);
  assert.equal(res._body.error, "Unauthorized");
});

test("notification utils: viewer resolves authenticated user id and profile name", async () => {
  const { getNotificationViewer } = loadUtils({ profileName: "Priya Kumar" });
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  };

  const viewer = await getNotificationViewer(supabase);

  assert.equal(viewer.id, "user-1");
  assert.equal(viewer.name, "Priya Kumar");
});

test("notification utils: viewer is null when auth fails or no user is present", async () => {
  const { getNotificationViewer } = loadUtils();

  assert.equal(
    await getNotificationViewer({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
    null
  );
  assert.equal(
    await getNotificationViewer({ auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: { message: "bad token" } }) } }),
    null
  );
});

test("notification utils: mergeNotifications normalizes, dedupes, and sorts by effective date", () => {
  const { mergeNotifications } = loadUtils();

  const result = mergeNotifications(
    [
      { id: "older", type: "POST_LIKED", post_id: "post-1", read: true, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "dupe", type: "POST_COMMENTED", post_id: "post-2", created_at: "2026-01-02T00:00:00.000Z" },
    ],
    [
      { id: "dupe", type: "POST_COMMENTED", post_id: "post-2", is_read: true, created_at: "2026-01-03T00:00:00.000Z" },
      { id: "newer", created_at: "2026-01-04T00:00:00.000Z" },
    ]
  );

  assert.deepEqual(Array.from(result, (n) => n.id), ["newer", "dupe", "older"]);
  assert.equal(result[0].type, "SYSTEM_ANNOUNCEMENT");
  assert.equal(result[0].entity_type, "SYSTEM");
  assert.equal(result[1].read, true);
  assert.equal(result[1].is_read, true);
});

test("notification utils: schema error detection covers modern and legacy schema drift", () => {
  const { isNotificationSchemaError } = loadUtils();

  assert.equal(isNotificationSchemaError({ code: "42703" }), true);
  assert.equal(isNotificationSchemaError({ code: "PGRST204" }), true);
  assert.equal(isNotificationSchemaError({ message: "column recipient_user_id does not exist" }), true);
  assert.equal(isNotificationSchemaError({ message: "metadata not found" }), true);
  assert.equal(isNotificationSchemaError({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isNotificationSchemaError(null), false);
});

test("notification utils: filterValidNotifications keeps backed entities and soft-deletes stale rows", async () => {
  const { filterValidNotifications } = loadUtils();
  const db = tableDb({
    circle_requests: [
      {
        data: [{ sender_name: "Alice", receiver_name: "Bob" }],
        error: null,
      },
    ],
    likes: [
      {
        data: [{ user_name: "Carol", post_id: "post-1" }],
        error: null,
      },
    ],
    comments: [
      {
        data: [{ id: "comment-1" }],
        error: null,
      },
    ],
    notifications: [{ data: [], error: null }],
  });
  const input = [
    notif("system", "SYSTEM_ANNOUNCEMENT", { updated_at: "2026-01-09T00:00:00.000Z" }),
    notif("circle-old", "CIRCLE_REQUEST_RECEIVED", { updated_at: "2026-01-01T00:00:00.000Z" }),
    notif("circle-new", "CIRCLE_REQUEST_RECEIVED", { updated_at: "2026-01-08T00:00:00.000Z" }),
    notif("circle-stale", "CIRCLE_REQUEST_RECEIVED", { actor_name: "Mallory", updated_at: "2026-01-07T00:00:00.000Z" }),
    notif("like-valid", "POST_LIKED", { actor_name: "Carol", post_id: "post-1", updated_at: "2026-01-06T00:00:00.000Z" }),
    notif("like-stale", "POST_LIKED", { actor_name: "Dave", post_id: "post-2", updated_at: "2026-01-05T00:00:00.000Z" }),
    notif("comment-valid", "POST_COMMENTED", { metadata: { commentId: "comment-1" }, updated_at: "2026-01-04T00:00:00.000Z" }),
    notif("comment-stale", "POST_COMMENTED", { metadata: { commentId: "comment-2" }, updated_at: "2026-01-03T00:00:00.000Z" }),
  ];

  const result = await filterValidNotifications(db, input);

  assert.deepEqual(
    Array.from(result, (n) => n.id),
    ["system", "circle-new", "like-valid", "comment-valid"]
  );

  const cleanup = db._calls.find((call) => call.table === "notifications");
  assert.ok(cleanup, "Expected stale notifications to be soft-deleted");
  assert.deepEqual(
    Array.from(opArgs(cleanup, "in")[1]).sort(),
    ["circle-old", "circle-stale", "comment-stale", "like-stale"].sort()
  );
  assert.equal(typeof opArgs(cleanup, "update")[0].deleted_at, "string");
});

test("notification utils: legacy like rows survive when backing like lookup cannot be trusted", async () => {
  const { filterValidNotifications } = loadUtils();
  const db = tableDb({
    likes: [{ data: null, error: { message: "likes unavailable" } }],
  });
  const input = [
    notif("legacy-like", "like", { actor_name: "Alice", post_id: "post-1" }),
    notif("modern-like", "POST_LIKED", { actor_name: "Alice", post_id: "post-1" }),
  ];

  const result = await filterValidNotifications(db, input);

  assert.deepEqual(Array.from(result, (n) => n.id), ["legacy-like"]);
});
