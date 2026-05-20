/**
 * Payload-correctness tests for:
 *   POST   /api/reviews          (create)
 *   PATCH  /api/reviews/[id]     (edit)
 *   DELETE /api/reviews/[id]     (delete)
 *
 * These tests verify what is actually written to / deleted from the database —
 * not just the HTTP response code but the exact row values and query filters.
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
        "update", "single", "maybeSingle", "order", "in", "upsert",
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

function updateArg(calls) {
  for (const entry of calls) {
    const op = entry.ops.find(([m]) => m === "update");
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
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName
              ? { userId: `uid-${authName.toLowerCase().replace(/\s/g, "-")}`, actorName: authName }
              : null,
        };
      }
      throw new Error(`Unexpected require in review-crud tests: ${id}`);
    },
  });
  return mod.exports;
}

const VALID_BODY = {
  restaurantName: "Bawarchi",
  items: [{ name: "Mutton Biryani", rating: 5 }],
  media: [{ publicUrl: "https://example.test/photo.jpg", storagePath: "public/photo.jpg", mediaType: "image" }],
  visibility: "public",
};

// ── POST /api/reviews — create payload ────────────────────────────────────────

test("CREATE: reviewer_name is always the authenticated actor, not request body", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice Smith" });
  const res = await POST(makeReq({ ...VALID_BODY, reviewerName: "Mallory" }));
  assert.equal(status(res), 200);
  const row = insertArg(db._calls);
  assert.ok(row, "Expected an insert call");
  assert.equal(row.reviewer_name, "Alice Smith");
  assert.notEqual(row.reviewer_name, "Mallory");
});

test("CREATE: restaurant_name in inserted row is trimmed", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, restaurantName: "  Bawarchi  " }));
  const row = insertArg(db._calls);
  assert.equal(row.restaurant_name, "Bawarchi");
});

test("CREATE: body field is null when empty string", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, body: "" }));
  const row = insertArg(db._calls);
  assert.equal(row.body, null);
});

test("CREATE: body field is null when whitespace-only", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, body: "   " }));
  const row = insertArg(db._calls);
  assert.equal(row.body, null);
});

test("CREATE: blank item names are stripped before insert", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({
    ...VALID_BODY,
    items: [{ name: "Biryani", rating: 5 }, { name: "   " }],
  }));
  const row = insertArg(db._calls);
  assert.equal(row.items.length, 1);
  assert.equal(row.items[0].name, "Biryani");
});

test("CREATE: item names are trimmed in inserted row", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({
    ...VALID_BODY,
    items: [{ name: "  Mutton Biryani  ", rating: 4 }],
  }));
  const row = insertArg(db._calls);
  assert.equal(row.items[0].name, "Mutton Biryani");
});

test("CREATE: item rating out of [1,5] range is rejected", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 6 }] }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
  assert.equal(insertArg(db._calls), undefined);
});

test("CREATE: item rating below 1 is rejected", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 0 }] }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
  assert.equal(insertArg(db._calls), undefined);
});

test("CREATE: missing item rating is stored as 0", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani" }] }));
  const row = insertArg(db._calls);
  assert.equal(row.items[0].rating, 0);
});

test("CREATE: valid item rating within [1,5] is stored as-is", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 4 }] }));
  const row = insertArg(db._calls);
  assert.equal(row.items[0].rating, 4);
});

test("CREATE: visibility=public is stored correctly", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, visibility: "public" }));
  assert.equal(insertArg(db._calls).visibility, "public");
});

test("CREATE: visibility=circle is stored correctly", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, visibility: "circle" }));
  assert.equal(insertArg(db._calls).visibility, "circle");
});

test("CREATE: visibility=me is stored correctly", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, visibility: "me" }));
  assert.equal(insertArg(db._calls).visibility, "me");
});

test("CREATE: selected Google Places metadata is stored with the review", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({
    ...VALID_BODY,
    restaurantId: "places-bawarchi-gachibowli",
    area: "  Gachibowli, Hyderabad  ",
    restaurantAddress: "  Gachibowli, Hyderabad, Telangana 500032, India  ",
    restaurantLat: 17.4239,
    restaurantLng: 78.4738,
  }));

  assert.equal(status(res), 200);
  const row = insertArg(db._calls);
  assert.equal(row.restaurant_id, "places-bawarchi-gachibowli");
  assert.equal(row.area, "Gachibowli, Hyderabad");
  assert.equal(row.restaurant_address, "Gachibowli, Hyderabad, Telangana 500032, India");
  assert.equal(row.restaurant_lat, 17.4239);
  assert.equal(row.restaurant_lng, 78.4738);
});

test("CREATE: invalid coordinate types are stored as null", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({
    ...VALID_BODY,
    restaurantId: "places-bawarchi",
    restaurantLat: "17.4239",
    restaurantLng: { value: 78.4738 },
  }));

  const row = insertArg(db._calls);
  assert.equal(row.restaurant_lat, null);
  assert.equal(row.restaurant_lng, null);
});

// ── DELETE /api/reviews/[id] — double-filter guard ────────────────────────────

test("DELETE: DB call uses both id and reviewer_name as eq filters", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null }, // ownership check
    { data: null, error: null }                          // delete
  );
  const { DELETE } = loadRoute(src.byId, { db, authName: "Alice" });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) });
  assert.equal(status(res), 200);
  const deleteEntry = db._calls.find((c) => c.ops.some(([m]) => m === "delete"));
  assert.ok(deleteEntry, "Expected a delete call");
  const filters = eqFilters(deleteEntry);
  assert.equal(filters.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(filters.reviewer_name, "Alice");
});

// ── PATCH /api/reviews/[id] — update payload ─────────────────────────────────

test("PATCH: reviewer_name is never included in the update payload", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "circle", reviewerName: "Mallory" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const updates = updateArg(db._calls);
  assert.ok(updates, "Expected an update call");
  assert.ok(!("reviewer_name" in updates), "reviewer_name must never be in the update payload");
});

test("PATCH: visibility in update payload matches requested value", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "me" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(updateArg(db._calls).visibility, "me");
});

test("PATCH: body is stored as null when whitespace-only", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ body: "   " }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(updateArg(db._calls).body, null);
});

test("PATCH: update call uses both id and reviewer_name as eq filters", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "77777777-7777-4777-8777-777777777777" }) }
  );
  const updateEntry = db._calls.find((c) => c.ops.some(([m]) => m === "update"));
  assert.ok(updateEntry, "Expected an update call");
  const filters = eqFilters(updateEntry);
  assert.equal(filters.id, "77777777-7777-4777-8777-777777777777");
  assert.equal(filters.reviewer_name, "Alice");
});

test("PATCH: blank item names are stripped from items update", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ items: [{ name: "Biryani" }, { name: "   " }] }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const updates = updateArg(db._calls);
  assert.equal(updates.items.length, 1);
  assert.equal(updates.items[0].name, "Biryani");
  assert.equal(updates.items[0].rating, 0);
});

test("PATCH: item names and ratings are normalized in the update payload", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ items: [{ name: "  Biryani  ", rating: 4 }] }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const updates = updateArg(db._calls);
  assert.equal(updates.items[0].name, "Biryani");
  assert.equal(updates.items[0].rating, 4);
});

test("PATCH: invalid item rating is rejected before update", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  const res = await PATCH(
    makeReq({ items: [{ name: "Biryani", rating: 6 }] }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
  assert.equal(updateArg(db._calls), undefined);
});

test("PATCH: only provided fields appear in the update payload", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "public" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const updates = updateArg(db._calls);
  assert.ok("visibility" in updates, "visibility should be in update");
  assert.ok(!("body" in updates), "body should not be in update when not provided");
  assert.ok(!("items" in updates), "items should not be in update when not provided");
});
