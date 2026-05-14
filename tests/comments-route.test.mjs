/**
 * Security and validation tests for:
 *   POST   /api/comments       (create a comment)
 *   DELETE /api/comments/[id]  (delete — owner only)
 *
 * Key invariants:
 *   - user_name is always the authenticated actor — never from the request body.
 *   - Only the comment owner can delete their own comment.
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

const src = {
  create: transpile(
    readFileSync(new URL("../app/api/comments/route.ts", import.meta.url), "utf8")
  ),
  deleteById: transpile(
    readFileSync(new URL("../app/api/comments/[id]/route.ts", import.meta.url), "utf8")
  ),
};

// ── mock helpers ──────────────────────────────────────────────────────────────

function mockDb(...responses) {
  let idx = 0;
  return {
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: null, error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of [
        "select", "eq", "limit", "insert", "delete",
        "update", "single", "maybeSingle", "order", "in",
      ]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

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

function insertArg(calls) {
  for (const entry of calls) {
    const op = entry.ops.find(([m]) => m === "insert");
    if (op) return op[1];
  }
  return undefined;
}

function eqFilters(entry) {
  return Object.fromEntries(
    entry.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val])
  );
}

const mockNextResponse = {
  json(b, opts) { return { _body: b, _status: opts?.status ?? 200 }; },
};

function makeReq(b) { return { json: async () => b }; }
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
      if (id === "@/lib/server/review-validation") {
        return {
          isValidUuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
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
      throw new Error(`Unexpected require in comments tests: ${id}`);
    },
  });
  return mod.exports;
}

// ── POST /api/comments ────────────────────────────────────────────────────────

test("POST /comments: logged-out user is rejected with 401", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: null });
  const res = await POST(makeReq({ postId: "post-1", content: "Great food!" }));
  assert.equal(status(res), 401);
});

test("POST /comments: missing postId returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ content: "Great food!" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /postId/i);
});

test("POST /comments: missing content returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ postId: "post-1" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /content/i);
});

test("POST /comments: whitespace-only content returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ postId: "post-1", content: "   " }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /content/i);
});

test("POST /comments: content over 500 characters returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const longContent = "x".repeat(501);
  const res = await POST(makeReq({ postId: "post-1", content: longContent }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /500/);
});

test("POST /comments: content exactly 500 characters is accepted", async () => {
  const db = mockDb({ data: { id: "33333333-3333-4333-8333-333333333333" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ postId: "post-1", content: "x".repeat(500) }));
  assert.equal(status(res), 200);
});

test("POST /comments: user_name is always the authenticated actor, not the request body", async () => {
  const db = spyDb({ data: { id: "33333333-3333-4333-8333-333333333333" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(
    makeReq({ postId: "post-1", content: "Nice!", userName: "Mallory" })
  );
  assert.equal(status(res), 200);
  const inserted = insertArg(db._calls);
  assert.ok(inserted, "Expected an insert call");
  assert.equal(inserted.user_name, "Alice");
  assert.notEqual(inserted.user_name, "Mallory");
});

test("POST /comments: inserted content is trimmed and tied to the post id", async () => {
  const db = spyDb({ data: { id: "33333333-3333-4333-8333-333333333333" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ postId: "post-1", content: "  Delicious!  " }));
  assert.equal(status(res), 200);
  const inserted = insertArg(db._calls);
  assert.equal(inserted.post_id, "post-1");
  assert.equal(inserted.content, "Delicious!");
});

test("POST /comments: valid comment returns the new comment id", async () => {
  const db = mockDb({ data: { id: "cmt-xyz" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ postId: "post-1", content: "Delicious!" }));
  assert.equal(status(res), 200);
  assert.equal(body(res).id, "cmt-xyz");
});

test("POST /comments: DB error returns 500", async () => {
  const { POST } = loadRoute(src.create, {
    db: mockDb({ data: null, error: { message: "insert failed" } }),
    authName: "Alice",
  });
  const res = await POST(makeReq({ postId: "post-1", content: "Nice!" }));
  assert.equal(status(res), 500);
});

// ── DELETE /api/comments/[id] ─────────────────────────────────────────────────

test("DELETE /comments/[id]: logged-out user is rejected with 401", async () => {
  const { DELETE } = loadRoute(src.deleteById, { db: mockDb(), authName: null });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 401);
});

test("DELETE /comments/[id]: malformed comment id returns 400", async () => {
  const { DELETE } = loadRoute(src.deleteById, { db: mockDb(), authName: "Alice" });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "not-a-comment-id" }) });
  assert.equal(status(res), 400);
  assert.match(body(res).error, /comment id/i);
});

test("DELETE /comments/[id]: comment not found returns 404", async () => {
  const { DELETE } = loadRoute(src.deleteById, {
    db: mockDb({ data: null, error: null }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 404);
});

test("DELETE /comments/[id]: another user cannot delete someone else's comment", async () => {
  const { DELETE } = loadRoute(src.deleteById, {
    db: mockDb(
      { data: { user_name: "Bob" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 403);
  assert.match(body(res).error, /not your comment/i);
});

test("DELETE /comments/[id]: owner can delete their own comment", async () => {
  const { DELETE } = loadRoute(src.deleteById, {
    db: mockDb(
      { data: { user_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
});

test("DELETE /comments/[id]: delete uses both id and user_name filters", async () => {
  const db = spyDb(
    { data: { user_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { DELETE } = loadRoute(src.deleteById, { db, authName: "Alice" });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 200);
  const deleteEntry = db._calls.find((call) => call.ops.some(([op]) => op === "delete"));
  assert.ok(deleteEntry, "Expected a delete call");
  assert.equal(eqFilters(deleteEntry).id, "33333333-3333-4333-8333-333333333333");
  assert.equal(eqFilters(deleteEntry).user_name, "Alice");
});

test("DELETE /comments/[id]: DB delete error returns 500", async () => {
  const { DELETE } = loadRoute(src.deleteById, {
    db: mockDb(
      { data: { user_name: "Alice" }, error: null },
      { data: null, error: { message: "delete failed" } }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 500);
  assert.match(body(res).error, /delete failed/);
});

test("DELETE /comments/[id]: DB fetch error returns 404", async () => {
  const { DELETE } = loadRoute(src.deleteById, {
    db: mockDb({ data: null, error: { message: "fetch failed" } }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal(status(res), 404);
});

test("POST /comments: success response includes full comment row (id, post_id, user_name, content, created_at)", async () => {
  const fullRow = {
    id: "cmt-1",
    post_id: "post-1",
    user_name: "Alice",
    content: "Delicious!",
    created_at: "2026-05-01T00:00:00.000Z",
  };
  const db = mockDb({ data: fullRow, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });

  const res = await POST(makeReq({ postId: "post-1", content: "Delicious!" }));

  assert.equal(status(res), 200);
  assert.equal(body(res).id, "cmt-1");
  assert.equal(body(res).post_id, "post-1");
  assert.equal(body(res).user_name, "Alice");
  assert.equal(body(res).content, "Delicious!");
  assert.equal(typeof body(res).created_at, "string");
});

test("DELETE /comments/[id]: ownership check selects user_name and post_id", async () => {
  const db = spyDb(
    { data: { user_name: "Alice", post_id: "post-1" }, error: null },
    { data: null, error: null }
  );
  const { DELETE } = loadRoute(src.deleteById, { db, authName: "Alice" });

  await DELETE(makeReq({}), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });

  const fetchCall = db._calls.find(
    (c) => c.table === "comments" && c.ops.some(([op]) => op === "select")
  );
  assert.ok(fetchCall, "should SELECT from comments");
  const selectArg = fetchCall.ops.find(([op]) => op === "select")?.[1] ?? "";
  assert.ok(selectArg.includes("user_name"), "select should include user_name");
  assert.ok(selectArg.includes("post_id"), "select should include post_id");
});
