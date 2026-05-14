/**
 * Security and validation tests for:
 *   POST   /api/reviews          (create)
 *   DELETE /api/reviews/[id]     (delete — owner only)
 *   PATCH  /api/reviews/[id]     (edit — owner only)
 *
 * Key invariant: reviewer_name is ALWAYS derived from the authenticated
 * session via getAuthenticatedCircleActor — it is never read from the
 * request body.
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
    readFileSync(new URL("../app/api/reviews/route.ts", import.meta.url), "utf8")
  ),
  byId: transpile(
    readFileSync(new URL("../app/api/reviews/[id]/route.ts", import.meta.url), "utf8")
  ),
};

// ── mock helpers ──────────────────────────────────────────────────────────────

/**
 * Sequential mock DB: each from() call consumes the next response.
 * All chain methods return `this` so the call can be awaited anywhere.
 */
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
        "select", "eq", "ilike", "or", "limit", "insert",
        "delete", "update", "order", "in", "single", "maybeSingle", "upsert",
      ]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

/**
 * Capturing mock DB: records the argument passed to `.insert()` so tests
 * can verify what row was written to the database.
 */
function capturingDb(resolveWith = { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null }) {
  let insertedRow;
  return {
    get _inserted() { return insertedRow; },
    from(_table) {
      const chain = {
        then(res, rej) { return Promise.resolve(resolveWith).then(res, rej); },
        catch(rej) { return Promise.resolve(resolveWith).catch(rej); },
        insert(row) { insertedRow = row; return chain; },
      };
      for (const m of [
        "select", "eq", "limit", "single", "maybeSingle",
        "delete", "update", "order", "in",
      ]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

const mockNextResponse = {
  json(body, opts) { return { _body: body, _status: opts?.status ?? 200 }; },
};

function makeReq(body) { return { json: async () => body }; }
function body(res) { return res._body; }
function status(res) { return res._status; }

function loadRoute(code, { db, adminDb, authName }) {
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
              ? { userId: `uid-${authName.toLowerCase().replace(/\s/g, "-")}`, actorName: authName, displayName: authName }
              : null,
          }),
        };
      }
      if (id === "@/lib/server/review-validation") {
        const isValidUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        const isValidVisibility = (value) => ["public", "circle", "me"].includes(value);
        const normalizeReviewItems = (items) => {
          if (!Array.isArray(items)) return { error: "At least one dish is required" };
          const normalized = [];
          for (const item of items) {
            const name = item?.name?.trim();
            if (!name) continue;
            if (item.rating !== undefined && (typeof item.rating !== "number" || item.rating < 1 || item.rating > 5)) {
              return { error: "Invalid rating" };
            }
            normalized.push({ name, rating: item.rating ?? 0 });
          }
          return normalized.length ? { items: normalized } : { error: "At least one dish is required" };
        };
        const validateReviewBody = (value) => {
          if (value === undefined) return {};
          if (value === null) return { body: null };
          if (typeof value !== "string") return { error: "Invalid body" };
          const trimmed = value.trim();
          if (trimmed && trimmed.length < 5) return { error: "Body must be at least 5 characters" };
          return { body: trimmed || null };
        };
        return { isValidUuid, isValidVisibility, normalizeReviewItems, validateReviewBody };
      }
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => adminDb ?? db };
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName
              ? { userId: `uid-${authName.toLowerCase().replace(/\s/g, "-")}`, actorName: authName }
              : null,
        };
      }
      throw new Error(`Unexpected require in reviews tests: ${id}`);
    },
  });
  return mod.exports;
}

const VALID_BODY = {
  restaurantName: "Bawarchi",
  items: [{ name: "Mutton Biryani", rating: 5 }],
  visibility: "public",
};

// ── POST /api/reviews ─────────────────────────────────────────────────────────

test("POST /reviews: logged-out user is rejected with 401", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: null });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 401);
});

test("POST /reviews: forged reviewerName in body is ignored; authenticated actor is used", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice Smith" });
  const res = await POST(
    makeReq({ ...VALID_BODY, reviewerName: "Mallory Hacker" })
  );
  assert.equal(status(res), 200);
  assert.equal(db._inserted.reviewer_name, "Alice Smith");
  assert.notEqual(db._inserted.reviewer_name, "Mallory Hacker");
});

test("POST /reviews: reviewer_name in response row is the auth actor, not request body", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Priya Kumar" });
  await POST(makeReq(VALID_BODY));
  assert.equal(db._inserted.reviewer_name, "Priya Kumar");
});

test("POST /reviews: missing restaurantName returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ items: [{ name: "Biryani" }], visibility: "public" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /restaurantName/i);
});

test("POST /reviews: empty restaurantName returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, restaurantName: "   " }));
  assert.equal(status(res), 400);
});

test("POST /reviews: empty items array returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ restaurantName: "Bawarchi", items: [], visibility: "public" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /dish/i);
});

test("POST /reviews: more than four photos returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const photos = Array.from({ length: 5 }, (_, i) => ({
    publicUrl: `https://example.test/photo-${i}.jpg`,
    storagePath: `public/photo-${i}.jpg`,
  }));

  const res = await POST(makeReq({ ...VALID_BODY, photos }));

  assert.equal(status(res), 400);
  assert.match(body(res).error, /Maximum 4 photos/i);
});

test("POST /reviews: items with only whitespace names returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "  " }] }));
  assert.equal(status(res), 400);
});

test("POST /reviews: invalid visibility value returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, visibility: "friends" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /visibility/i);
});

test("POST /reviews: invalid rating returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 6 }] }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
});

test("POST /reviews: visibility=circle is accepted", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, visibility: "circle" }));
  assert.equal(status(res), 200);
});

test("POST /reviews: visibility=me is accepted", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, visibility: "me" }));
  assert.equal(status(res), 200);
});

test("POST /reviews: body shorter than 5 chars returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, body: "ok" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /5 char/i);
});

test("POST /reviews: empty body field is accepted (optional)", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, body: "" }));
  assert.equal(status(res), 200);
});

test("POST /reviews: valid review returns the new review id", async () => {
  const db = capturingDb({ data: { id: "rev-abc-123" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 200);
  assert.equal(body(res).id, "rev-abc-123");
});

test("POST /reviews: DB error returns 500", async () => {
  const { POST } = loadRoute(src.create, {
    db: mockDb({ data: null, error: { message: "db connection failed" } }),
    authName: "Alice",
  });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 500);
  assert.match(body(res).error, /db connection failed/);
});

// ── DELETE /api/reviews/[id] ──────────────────────────────────────────────────

test("DELETE /reviews/[id]: logged-out user is rejected with 401", async () => {
  const { DELETE } = loadRoute(src.byId, { db: mockDb(), authName: null });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 401);
});

test("DELETE /reviews/[id]: malformed review id returns 400", async () => {
  const { DELETE } = loadRoute(src.byId, { db: mockDb(), authName: "Alice" });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "not-a-review-id" }) });
  assert.equal(status(res), 400);
  assert.match(body(res).error, /review id/i);
});

test("DELETE /reviews/[id]: review not found returns 404", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb({ data: null, error: null }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 404);
});

test("DELETE /reviews/[id]: another user cannot delete someone else's review", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Bob" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 403);
  assert.match(body(res).error, /not your review/i);
});

test("DELETE /reviews/[id]: owner can delete their own review", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
});

test("DELETE /reviews/[id]: DB delete error returns 500", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: { message: "delete failed" } }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 500);
  assert.match(body(res).error, /delete failed/);
});

test("DELETE /reviews/[id]: DB fetch error returns 404", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb({ data: null, error: { message: "fetch failed" } }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 404);
});

// ── PATCH /api/reviews/[id] ───────────────────────────────────────────────────

test("PATCH /reviews/[id]: logged-out user is rejected with 401", async () => {
  const { PATCH } = loadRoute(src.byId, { db: mockDb(), authName: null });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 401);
});

test("PATCH /reviews/[id]: malformed review id returns 400", async () => {
  const { PATCH } = loadRoute(src.byId, { db: mockDb(), authName: "Alice" });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "not-a-review-id" }) }
  );
  assert.equal(status(res), 400);
  assert.match(body(res).error, /review id/i);
});

test("PATCH /reviews/[id]: another user cannot edit someone else's review", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Bob" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 403);
  assert.match(body(res).error, /not your review/i);
});

test("PATCH /reviews/[id]: invalid visibility value returns 400", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "everyone" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 400);
  assert.match(body(res).error, /visibility/i);
});

test("PATCH /reviews/[id]: body shorter than 5 chars returns 400", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb({ data: { reviewer_name: "Alice" }, error: null }),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ body: "meh" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 400);
});

test("PATCH /reviews/[id]: owner can update visibility", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
});

test("PATCH /reviews/[id]: DB update error returns 500", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: { message: "update failed" } }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 500);
  assert.match(body(res).error, /update failed/);
});

test("PATCH /reviews/[id]: review not found returns 404", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb({ data: null, error: null }),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "public" }),
    { params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }) }
  );
  assert.equal(status(res), 404);
});

test("POST /reviews: write goes through the admin client, not the SSR session client", async () => {
  const sessionDb = capturingDb({ data: null, error: null });
  const adminDb = capturingDb();
  const { POST } = loadRoute(src.create, { db: sessionDb, adminDb, authName: "Alice" });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 200);
  assert.ok(adminDb._inserted, "admin client should have received the insert");
  assert.equal(adminDb._inserted.reviewer_name, "Alice");
  assert.equal(sessionDb._inserted, undefined, "SSR session client should not have received the insert");
});
