/**
 * Security and validation tests for:
 *   POST   /api/likes    (like a post)
 *   DELETE /api/likes    (unlike a post)
 *
 * Key invariant: user_name is ALWAYS the authenticated actor — never from
 * the request body.  A user cannot like or unlike as someone else.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// ── transpile ─────────────────────────────────────────────────────────────────

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

const src = transpile(
  readFileSync(new URL("../app/api/likes/route.ts", import.meta.url), "utf8")
);

// ── mock helpers ──────────────────────────────────────────────────────────────

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    get _calls() { return calls; },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: null, error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of [
        "select", "eq", "limit", "insert", "delete",
        "update", "single", "maybeSingle", "order", "in",
      ]) {
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

function insertArg(entry) {
  const op = entry.ops.find(([op]) => op === "insert");
  return op ? op[1] : undefined;
}

const mockNextResponse = {
  json(b, opts) { return { _body: b, _status: opts?.status ?? 200 }; },
};

function makeReq(body) { return { json: async () => body }; }
function body(res) { return res._body; }
function status(res) { return res._status; }

function loadRoute(code, { db, authName }) {
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
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => db };
      if (id === "@/lib/server/review-access") {
        return { canActorReadPost: async () => ({ allowed: true }) };
      }
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
            actor: authName
              ? { userId: `uid-${authName.toLowerCase()}`, actorName: authName, displayName: authName }
              : null,
          }),
        };
      }
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName
              ? { userId: `uid-${authName.toLowerCase()}`, actorName: authName }
              : null,
        };
      }
      throw new Error(`Unexpected require in likes tests: ${id}`);
    },
  });
  return mod.exports;
}

// ── POST /api/likes ───────────────────────────────────────────────────────────

test("POST /likes: logged-out user is rejected with 401", async () => {
  const { POST } = loadRoute(src, { db: spyDb(), authName: null });
  const res = await POST(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 401);
});

test("POST /likes: missing postId returns 400", async () => {
  const { POST } = loadRoute(src, { db: spyDb(), authName: "Alice" });
  const res = await POST(makeReq({}));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /postId/i);
});

test("POST /likes: user_name is always the authenticated actor, not the request body", async () => {
  const db = spyDb({ error: null });
  const { POST } = loadRoute(src, { db, authName: "Alice" });
  const res = await POST(makeReq({ postId: "post-1", userName: "Mallory" }));
  assert.equal(status(res), 200);
  const likeEntry = db._calls.find((c) => c.ops.some(([op]) => op === "insert"));
  assert.ok(likeEntry, "Expected an insert call");
  assert.equal(insertArg(likeEntry)?.user_name, "Alice");
  assert.notEqual(insertArg(likeEntry)?.user_name, "Mallory");
});

test("POST /likes: insert contains correct post_id", async () => {
  const db = spyDb({ error: null });
  const { POST } = loadRoute(src, { db, authName: "Alice" });
  await POST(makeReq({ postId: "post-42" }));
  const likeEntry = db._calls.find((c) => c.ops.some(([op]) => op === "insert"));
  assert.equal(insertArg(likeEntry)?.post_id, "post-42");
});

test("POST /likes: duplicate like (23505) returns ok with alreadyLiked flag", async () => {
  const { POST } = loadRoute(src, {
    db: spyDb({ error: { code: "23505", message: "unique constraint" } }),
    authName: "Alice",
  });
  const res = await POST(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 200);
  assert.equal(body(res).alreadyLiked, true);
});

test("POST /likes: other DB error returns 500", async () => {
  const { POST } = loadRoute(src, {
    db: spyDb({ error: { code: "42P01", message: "relation not found" } }),
    authName: "Alice",
  });
  const res = await POST(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 500);
});

// ── DELETE /api/likes ─────────────────────────────────────────────────────────

test("DELETE /likes: logged-out user is rejected with 401", async () => {
  const { DELETE } = loadRoute(src, { db: spyDb(), authName: null });
  const res = await DELETE(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 401);
});

test("DELETE /likes: missing postId returns 400", async () => {
  const { DELETE } = loadRoute(src, { db: spyDb(), authName: "Alice" });
  const res = await DELETE(makeReq({}));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /postId/i);
});

test("DELETE /likes: unlike uses authenticated actor's user_name, not request body", async () => {
  const db = spyDb({ error: null });
  const { DELETE } = loadRoute(src, { db, authName: "Alice" });
  const res = await DELETE(makeReq({ postId: "post-1", userName: "Mallory" }));
  assert.equal(status(res), 200);
  const deleteEntry = db._calls.find((c) => c.ops.some(([op]) => op === "delete"));
  assert.ok(deleteEntry, "Expected a delete call");
  assert.equal(eqFilters(deleteEntry).user_name, "Alice");
  assert.notEqual(eqFilters(deleteEntry).user_name, "Mallory");
});

test("DELETE /likes: another user cannot unlike by forging the owner name", async () => {
  const db = spyDb({ error: null });
  const { DELETE } = loadRoute(src, { db, authName: "Bob" });
  const res = await DELETE(makeReq({ postId: "post-1", userName: "Alice" }));
  assert.equal(status(res), 200);
  const deleteEntry = db._calls.find((c) => c.ops.some(([op]) => op === "delete"));
  assert.ok(deleteEntry, "Expected a delete call");
  assert.equal(eqFilters(deleteEntry).user_name, "Bob");
  assert.notEqual(eqFilters(deleteEntry).user_name, "Alice");
});

test("DELETE /likes: unlike filters by the correct post_id", async () => {
  const db = spyDb({ error: null });
  const { DELETE } = loadRoute(src, { db, authName: "Alice" });
  await DELETE(makeReq({ postId: "post-99" }));
  const deleteEntry = db._calls.find((c) => c.ops.some(([op]) => op === "delete"));
  assert.equal(eqFilters(deleteEntry).post_id, "post-99");
});

test("DELETE /likes: successful unlike returns ok", async () => {
  const { DELETE } = loadRoute(src, {
    db: spyDb({ error: null }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
});

test("DELETE /likes: DB error returns 500", async () => {
  const { DELETE } = loadRoute(src, {
    db: spyDb({ error: { message: "delete failed" } }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 500);
  assert.match(body(res).error, /delete failed/);
});
