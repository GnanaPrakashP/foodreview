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

const routeSource = transpile(readFileSync(new URL("../app/api/delete-account/route.ts", import.meta.url), "utf8"));

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

function spyTableDb() {
  const calls = [];
  return {
    get _calls() {
      return calls;
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const chain = {
        then(res) {
          return Promise.resolve({ data: null, error: null }).then(res);
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

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

function loadRoute({
  accountDeleteError = null,
  mediaRows = [{ storage_path: "memories/room/user/intent/media.jpg" }],
  storageError = null,
  user = { id: "viewer-id" }
} = {}) {
  const serverRpcCalls = [];
  const serverClient = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
    rpc: async (name) => {
      serverRpcCalls.push(name);
      return { data: null, error: accountDeleteError };
    }
  };
  const adminRpcCalls = [];
  const removedPaths = [];
  const adminClient = {
    ...spyTableDb(),
    rpc: async (name, params) => {
      adminRpcCalls.push({ name, params });
      return { data: mediaRows, error: null };
    },
    storage: {
      from(bucket) {
        return {
          remove: async (paths) => {
            removedPaths.push({ bucket, paths });
            return { data: [], error: storageError };
          }
        };
      }
    }
  };

  const mod = { exports: {} };
  vm.runInNewContext(routeSource, {
    module: mod,
    exports: mod.exports,
    console,
    process: {
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      },
    },
    require(id) {
      if (id === "next/server") return { NextResponse: mockNextResponse };
      if (id === "next/headers") return { cookies: async () => ({ getAll: () => [] }) };
      if (id === "@supabase/ssr") return { createServerClient: () => serverClient };
      if (id === "@supabase/supabase-js") return { createClient: () => adminClient };
      if (id === "@/lib/memory-media-policy") return { MEMORY_MEDIA_BUCKET: "memory-media" };
      if (id === "@/lib/server/memory-observability") {
        return {
          memoryErrorKind: () => "test_error",
          memoryOperationDurationMs: () => 1,
          recordMemoryOperation: () => {}
        };
      }
      if (id === "@/lib/server/route-supabase") return { createRouteSupabase: async () => serverClient };
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => adminClient };
      throw new Error(`Unexpected require in delete-account route tests: ${id}`);
    },
  });
  return { route: mod.exports, adminClient, adminRpcCalls, removedPaths, serverRpcCalls };
}

test("delete account route: logged-out users are rejected", async () => {
  const { route, adminClient, removedPaths, serverRpcCalls } = loadRoute({ user: null });

  const res = await route.POST();

  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Not authenticated");
  assert.equal(adminClient._calls.length, 0);
  assert.equal(removedPaths.length, 0);
  assert.equal(serverRpcCalls.length, 0);
});

test("delete account route: removes DB-backed memory media before deleting the authenticated account", async () => {
  const { route, adminRpcCalls, removedPaths, serverRpcCalls } = loadRoute({ user: { id: "user-123" } });

  const res = await route.POST();

  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
  assert.equal(JSON.stringify(adminRpcCalls), JSON.stringify([{
    name: "shared_memory_account_media_paths",
    params: { p_user_id: "user-123" }
  }]));
  assert.equal(JSON.stringify(removedPaths), JSON.stringify([{
    bucket: "memory-media",
    paths: ["memories/room/user/intent/media.jpg"]
  }]));
  assert.equal(JSON.stringify(serverRpcCalls), JSON.stringify(["delete_current_account"]));
});

test("delete account route: account deletion failure is returned as a generic 500", async () => {
  const { route, removedPaths, serverRpcCalls } = loadRoute({
    accountDeleteError: { message: "delete failed" },
    user: { id: "user-123" },
  });

  const res = await route.POST();

  assert.equal(status(res), 500);
  assert.equal(body(res).error, "Unable to delete account");
  assert.equal(removedPaths.length, 1);
  assert.equal(JSON.stringify(serverRpcCalls), JSON.stringify(["delete_current_account"]));
});
