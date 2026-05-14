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

function loadRoute({ user = { id: "viewer-id" }, deleteUserError = null } = {}) {
  const serverClient = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
  };
  const adminClient = {
    ...spyTableDb(),
    auth: {
      admin: {
        deleteUser: async (id) => ({ data: { id }, error: deleteUserError }),
      },
    },
  };
  const deletedUsers = [];
  adminClient.auth.admin.deleteUser = async (id) => {
    deletedUsers.push(id);
    return { data: { id }, error: deleteUserError };
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
      if (id === "@/lib/server/route-supabase") return { createRouteSupabase: async () => serverClient };
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => adminClient };
      throw new Error(`Unexpected require in delete-account route tests: ${id}`);
    },
  });
  return { route: mod.exports, adminClient, deletedUsers };
}

test("delete account route: logged-out users are rejected", async () => {
  const { route, adminClient, deletedUsers } = loadRoute({ user: null });

  const res = await route.POST();

  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Not authenticated");
  assert.equal(adminClient._calls.length, 0);
  assert.equal(deletedUsers.length, 0);
});

test("delete account route: deletes only the authenticated user's profile before auth user", async () => {
  const { route, adminClient, deletedUsers } = loadRoute({ user: { id: "user-123" } });

  const res = await route.POST();

  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
  const profileDelete = adminClient._calls.find((call) => call.table === "profiles" && hasOp(call, "delete"));
  assert.ok(profileDelete);
  assert.equal(eqFilters(profileDelete).id, "user-123");
  assert.deepEqual(deletedUsers, ["user-123"]);
});

test("delete account route: auth deletion failure is returned as 500", async () => {
  const { route, adminClient, deletedUsers } = loadRoute({
    user: { id: "user-123" },
    deleteUserError: { message: "delete failed" },
  });

  const res = await route.POST();

  assert.equal(status(res), 500);
  assert.equal(body(res).error, "delete failed");
  const profileDelete = adminClient._calls.find((call) => call.table === "profiles" && hasOp(call, "delete"));
  assert.ok(profileDelete);
  assert.deepEqual(deletedUsers, ["user-123"]);
});
