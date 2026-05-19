/**
 * Tests for cursor pagination in lib/me-page-data.ts + GET /api/me
 *
 * Key invariants:
 *   - hasMore / nextCursor reflect whether more pages exist
 *   - cursor is applied as an "or" filter on the reviews query
 *   - circleMembers is always returned regardless of cursor
 *   - invalid cursor returns 400
 */

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

// Spy DB — records ops per from() call; sequential responses consumed by index
function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    get _calls() { return calls; },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej)     { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "is", "or", "limit", "order", "in", "not"]) {
        chain[m] = (...args) => { entry.ops.push([m, ...args]); return chain; };
      }
      chain.maybeSingle = (...args) => {
        entry.ops.push(["maybeSingle", ...args]);
        if (table === "profiles") {
          return Promise.resolve({ data: null, error: null });
        }
        return chain;
      };
      return chain;
    },
  };
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

function opArgs(entry, name) {
  const op = entry.ops.find(([n]) => n === name);
  return op ? op.slice(1) : [];
}

function review(overrides = {}) {
  const id = `rev-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    reviewer_name: "alice",
    restaurant_name: "Cafe X",
    visibility: "public",
    created_at: "2026-01-01T00:00:00.000Z",
    items: [],
    body: null,
    photo_url: null,
    photo_urls: null,
    status: "active",
    deleted_at: null,
    ...overrides,
  };
}

// Load me-page-data module with injected mocks
function loadMePageDataModule({ circleRelationships = { circleMembers: new Set(), joinedCircles: new Set() }, db }) {
  const source = readFileSync(new URL("../lib/me-page-data.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id === "@/lib/types") return {};
      if (id === "@/lib/circle-db") {
        return { getCircleRelationshipsForName: async () => circleRelationships };
      }
      if (id === "@/lib/private-cache") {
        return {
          getPrivateCached: async ({ load }) => { const r = await load(); return r.value; },
          invalidatePrivateCacheByTags: () => {},
        };
      }
      if (id === "@/lib/selects") {
        return {
          REVIEW_SELECT: "id, reviewer_name, restaurant_id, restaurant_name, area, restaurant_address, restaurant_lat, restaurant_lng, items, body, photo_url, photo_urls, review_photos(public_url, media_type, position), visibility, deleted_at, hidden_at, reported_at, status, created_at",
        };
      }
      if (id === "@/lib/server/normalize-review") {
        return {
          normalizeReview: (review) => ({
            ...review,
            photo_urls: review.photo_urls ?? (review.photo_url ? [review.photo_url] : []),
            media_items: [],
          }),
        };
      }
      if (id === "@/lib/server/engagement-list") {
        return { engagementForPosts: async () => ({}) };
      }
      throw new Error(`Unexpected require in me-page-pagination tests: ${id}`);
    },
  });
  return mod.exports;
}

// Load /api/me route with mocked supabase + me-page-data
function loadMeRoute({ db, authUser }) {
  const source = readFileSync(new URL("../app/api/me/route.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    URLSearchParams,
    require(id) {
      if (id === "next/server") {
        return {
          NextRequest: class {},
          NextResponse: {
            json(body, opts) { return { _body: body, _status: opts?.status ?? 200 }; },
          },
        };
      }
      if (id === "@/lib/server/route-supabase") {
        return {
          createRouteSupabase: async () => ({
            auth: {
              getUser: async () => ({ data: { user: authUser ?? null } }),
            },
            from: (...args) => db.from(...args),
          }),
        };
      }
      if (id === "@/lib/me-page-data") {
        // Re-load the actual me-page-data module with the injected db
        return loadMePageDataModule({ db });
      }
      if (id === "@/lib/people-page-data") {
        return { invalidatePeoplePageCacheForNames: () => {} };
      }
      if (id === "@/lib/trending-page-data") {
        return { invalidateTrendingPageCacheForNames: () => {} };
      }
      throw new Error(`Unexpected require in me-route tests: ${id}`);
    },
  });
  return mod.exports;
}

function makeReq(query = "") {
  return { nextUrl: { searchParams: new URLSearchParams(query) } };
}

function body(res) { return res._body; }
function status(res) { return res._status; }

// ── lib/me-page-data pagination ───────────────────────────────────────────────

test("me-page: hasMore is false and nextCursor is null when reviews fit in one page", async () => {
  const rows = [review(), review(), review()];
  // getCircleRelationshipsForName is mocked directly — it does NOT consume a db response
  const db = spyDb(
    { data: rows, error: null }   // reviews query
  );
  const { getMePageData } = loadMePageDataModule({ db });
  const result = await getMePageData(db, "alice", { limit: 10 });
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  assert.equal(result.reviews.length, 3);
});

test("me-page: hasMore is true and nextCursor is set when DB returns more than limit", async () => {
  // Return limit+1 rows so hasMore triggers
  const rows = Array.from({ length: 6 }, (_, i) =>
    review({ id: `r${i}`, created_at: `2026-01-0${i + 1}T00:00:00.000Z` })
  );
  const db = spyDb(
    { data: rows, error: null }
  );
  const { getMePageData } = loadMePageDataModule({ db });
  const result = await getMePageData(db, "alice", { limit: 5 });
  assert.equal(result.hasMore, true);
  assert.equal(result.reviews.length, 5);
  assert.ok(result.nextCursor, "nextCursor should be set");
  assert.ok(result.nextCursor.id, "nextCursor.id should be present");
  assert.ok(result.nextCursor.createdAt, "nextCursor.createdAt should be present");
  // nextCursor points at the last item in the returned page
  assert.equal(result.nextCursor.id, result.reviews[result.reviews.length - 1].id);
});

test("me-page: cursor is applied as .or() filter on the reviews query", async () => {
  const db = spyDb(
    { data: [], error: null },  // circle relationships
    { data: [], error: null }   // reviews
  );
  const { getMePageData } = loadMePageDataModule({ db });
  const cursor = { createdAt: "2026-01-05T00:00:00.000Z", id: "rev-abc" };
  await getMePageData(db, "alice", { cursor });

  const reviewsCall = db._calls.find((c) => c.table === "reviews");
  assert.ok(reviewsCall, "should query reviews table");
  assert.ok(hasOp(reviewsCall, "or"), "cursor should be applied as .or() filter");
});

test("me-page: circleMembers is always returned regardless of cursor", async () => {
  const circle = new Set(["bob", "carol"]);
  const db = spyDb(
    { data: [], error: null }  // reviews
  );
  const { getMePageData } = loadMePageDataModule({
    db,
    circleRelationships: { circleMembers: circle, joinedCircles: new Set() },
  });
  const result = await getMePageData(db, "alice", {
    cursor: { createdAt: "2026-01-01T00:00:00.000Z", id: "rev-1" },
  });
  assert.equal(result.circleMembers.length, 2);
  assert.ok(result.circleMembers.includes("bob"));
  assert.ok(result.circleMembers.includes("carol"));
});

test("me-page: empty name returns empty result without DB calls", async () => {
  const db = spyDb();
  const { getMePageData } = loadMePageDataModule({ db });
  const result = await getMePageData(db, "");
  assert.equal(result.reviews.length, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  assert.equal(db._calls.length, 0);
});

// ── /api/me route ─────────────────────────────────────────────────────────────

test("GET /api/me: hasMore is true and nextCursor is set when limit is smaller than result set", async () => {
  // getCircleRelationshipsForName is mocked — no spy entries consumed for circle data.
  // Only the reviews query consumes an entry.
  const rows = Array.from({ length: 11 }, (_, i) =>
    review({ id: `r${i}`, created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` })
  );
  const db = spyDb(
    { data: rows, error: null }  // reviews query (11 rows → hasMore true with limit 10)
  );
  const authUser = { user_metadata: { username: "alice" } };
  const { GET } = loadMeRoute({ db, authUser });
  const res = await GET(makeReq("limit=10"));
  assert.equal(status(res), 200);
  assert.equal(body(res).hasMore, true, "hasMore should be true when DB returns more than limit");
  assert.ok(body(res).nextCursor, "nextCursor should be set when hasMore is true");
});

test("GET /api/me: hasMore is false when rows fit within limit", async () => {
  const rows = [review(), review(), review()];
  const db = spyDb(
    { data: rows, error: null }
  );
  const authUser = { user_metadata: { username: "alice" } };
  const { GET } = loadMeRoute({ db, authUser });
  const res = await GET(makeReq("limit=10"));
  assert.equal(status(res), 200);
  assert.equal(body(res).hasMore, false);
  assert.equal(body(res).nextCursor, null);
});

test("GET /api/me: invalid cursor (not JSON) returns 400", async () => {
  const db = spyDb();
  const authUser = { user_metadata: { username: "alice" } };
  const { GET } = loadMeRoute({ db, authUser });
  const res = await GET(makeReq("cursor=not-valid-json"));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /invalid cursor/i);
});

test("GET /api/me: cursor with non-UUID id returns 400", async () => {
  const db = spyDb();
  const authUser = { user_metadata: { username: "alice" } };
  const { GET } = loadMeRoute({ db, authUser });
  const badCursor = JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z", id: "not-a-uuid" });
  const res = await GET(makeReq(`cursor=${encodeURIComponent(badCursor)}`));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /invalid cursor/i);
});

test("GET /api/me: cursor with invalid timestamp returns 400", async () => {
  const db = spyDb();
  const authUser = { user_metadata: { username: "alice" } };
  const { GET } = loadMeRoute({ db, authUser });
  const badCursor = JSON.stringify({ createdAt: "not-a-date", id: "00000000-0000-0000-0000-000000000001" });
  const res = await GET(makeReq(`cursor=${encodeURIComponent(badCursor)}`));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /invalid cursor/i);
});

test("GET /api/me: valid UUID+ISO cursor passes validation and queries DB", async () => {
  const db = spyDb(
    { data: [], error: null }  // reviews query
  );
  const authUser = { user_metadata: { username: "alice" } };
  const { GET } = loadMeRoute({ db, authUser });
  const validCursor = JSON.stringify({
    createdAt: "2026-01-05T00:00:00.000Z",
    id: "00000000-0000-0000-0000-000000000001",
  });
  const res = await GET(makeReq(`cursor=${encodeURIComponent(validCursor)}`));
  assert.equal(status(res), 200);
});

test("GET /api/me: unauthenticated request returns 401", async () => {
  const db = spyDb();
  const { GET } = loadMeRoute({ db, authUser: null });
  const res = await GET(makeReq());
  assert.equal(status(res), 401);
});
