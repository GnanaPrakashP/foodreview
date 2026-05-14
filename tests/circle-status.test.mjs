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

const routeSource = transpile(
  readFileSync(new URL("../app/api/circle/status/route.ts", import.meta.url), "utf8")
);

const mockNextResponse = {
  json(body, opts) {
    return { _body: body, _status: opts?.status ?? 200 };
  },
};

function body(res) { return res._body; }
function status(res) { return res._status; }

function makeReq(query = "") {
  return { nextUrl: { searchParams: new URLSearchParams(query) } };
}

function mockDb(...responses) {
  let idx = 0;
  return {
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "or", "limit", "in", "maybeSingle", "single"]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

function loadRoute({ authActor = null, db = mockDb() } = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(routeSource, {
    module: mod,
    exports: mod.exports,
    console,
    process: { env: {} },
    require(id) {
      if (id === "@supabase/ssr") return { createServerClient: () => db };
      if (id === "next/headers") return { cookies: async () => ({ getAll: () => [] }) };
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/server/route-supabase") {
        return { createRouteSupabase: async () => db };
      }
      if (id === "@/lib/circle-auth") {
        return { getAuthenticatedCircleActor: async () => authActor };
      }
      if (id === "@/lib/circle") {
        return { DEFAULT_ACCOUNT_TYPE: "public", normalizeAccountType: (t) => t === "private" ? "private" : "public" };
      }
      if (id === "@/lib/circle-db") {
        return {
          getAccountTypeForName: async () => "public",
          getAccountTypesForNames: async () => ({}),
        };
      }
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in circle-status tests: ${id}`);
    },
  });
  return mod.exports;
}

test("GET /circle/status: no name param returns empty payload without auth check", async () => {
  const { GET } = loadRoute({ authActor: null });
  const res = await GET(makeReq());
  assert.equal(status(res), 200);
  assert.equal(body(res).members.length, 0);
  assert.equal(body(res).pendingSent.length, 0);
  assert.equal(body(res).circleCount, 0);
});

test("GET /circle/status: unauthenticated request with name param returns 401", async () => {
  const { GET } = loadRoute({ authActor: null });
  const res = await GET(makeReq("name=alice"));
  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Authentication required");
});

test("GET /circle/status: authenticated request returns circle data for requested name", async () => {
  const db = mockDb(
    { data: [{ user_name: "alice", member_name: "bob" }], error: null }, // edge rows
    { data: [], error: null },                                            // request rows
    { data: { username: "alice", account_type: "public" }, error: null } // account type
  );
  const { GET } = loadRoute({
    authActor: { userId: "alice-id", actorName: "alice", displayName: "Alice" },
    db,
  });

  const res = await GET(makeReq("name=alice"));
  assert.equal(status(res), 200);
  assert.ok(Array.isArray(body(res).circleMembers));
  assert.ok(Array.isArray(body(res).members));
});

test("GET /circle/status: pendingSent and pendingIncoming hidden when viewer is not the name owner", async () => {
  const db = mockDb(
    { data: [], error: null },
    {
      data: [
        { sender_name: "carol", receiver_name: "bob", status: "pending" },
      ],
      error: null,
    },
    { data: { username: "bob", account_type: "public" }, error: null }
  );
  const { GET } = loadRoute({
    authActor: { userId: "alice-id", actorName: "alice", displayName: "Alice" },
    db,
  });

  // Alice requests Bob's status — Alice is NOT Bob, so pending lists are hidden
  const res = await GET(makeReq("name=bob"));
  assert.equal(status(res), 200);
  assert.equal(body(res).pendingSent.length, 0);
  assert.equal(body(res).pendingIncoming.length, 0);
});
