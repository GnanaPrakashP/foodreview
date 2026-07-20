/**
 * Tests for GET /api/feed/public
 *
 * Key invariants:
 *   - Only public-visibility posts are returned
 *   - Posts from explicit excludeNames are filtered out client-side
 *   - hasMore / nextCursor reflect whether more pages exist
 *   - likeCountMap, likedByMeMap, commentMap, bookmarkedPostMap, profileMap are built correctly
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

const routeSource = transpile(
  readFileSync(new URL("../app/api/feed/public/route.ts", import.meta.url), "utf8")
);

const mockNextResponse = {
  json(body, opts) { return { _body: body, _status: opts?.status ?? 200 }; },
};

function body(res) { return res._body; }
function status(res) { return res._status; }

function makeReq(query = "") {
  return { nextUrl: { searchParams: new URLSearchParams(query) } };
}

// Sequential mock: each from() call consumes the next response
function mockDb(...responses) {
  let idx = 0;
  return {
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "is", "or", "limit", "order", "in", "gte", "lte"]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

// Spy variant — records ops for assertion
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
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "is", "or", "limit", "order", "in", "gte", "lte"]) {
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

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

// Small page size so hasMore tests are easy
const PAGE_SIZE = 5;

function loadRoute({ db, viewerName = "" }) {
  const mod = { exports: {} };
  vm.runInNewContext(routeSource, {
    module: mod,
    exports: mod.exports,
    console,
    URLSearchParams,
    require(id) {
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/types") return {};
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => db };
      if (id === "@/lib/feed-config") return { PUBLIC_FEED_PAGE_SIZE: PAGE_SIZE, PUBLIC_FEED_MAX_PAGE_SIZE: PAGE_SIZE * 2 };
      if (id === "@/lib/circle-feed") {
        return {
          parseCircleFeedCursor: (raw) => {
            if (!raw) return null;
            try {
              const p = JSON.parse(raw);
              if (typeof p?.createdAt === "string" && typeof p?.id === "string") return p;
            } catch {}
            return null;
          },
        };
      }
      if (id === "@/lib/server/feed-assembly") {
        return {
          buildFeedAssemblyMaps: async (db, reviews, options = {}) => {
            const postIds = reviews.map((review) => review.id);
            if (postIds.length === 0) {
              return { likeCountMap: {}, commentMap: {}, likedByMeMap: {}, bookmarkedPostMap: {}, profileMap: {}, tasteTrustSummaryMap: {} };
            }
            const viewerName = options.viewerName ?? "";
            const [{ data: likes }, { data: comments }, { data: wishlist }, { data: profiles }] = await Promise.all([
              db.from("likes").select("post_id, user_name").in("post_id", postIds),
              db.from("comments").select("id, post_id, user_name, content, created_at").in("post_id", postIds).order("created_at", { ascending: false }),
              viewerName ? db.from("wishlist").select("post_id").eq("user_name", viewerName).in("post_id", postIds) : Promise.resolve({ data: [] }),
              db.from("profiles").select("username, first_name, last_name").in("username", Array.from(new Set(reviews.map((review) => review.reviewer_name))))
            ]);
            const likeCountMap = {};
            const likedByMeMap = {};
            for (const like of likes ?? []) {
              likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
              if (viewerName && like.user_name === viewerName) likedByMeMap[like.post_id] = true;
            }
            const commentMap = {};
            for (const comment of comments ?? []) {
              if (!commentMap[comment.post_id]) commentMap[comment.post_id] = { count: 1, top: comment };
              else commentMap[comment.post_id].count += 1;
            }
            const bookmarkedPostMap = {};
            for (const item of wishlist ?? []) if (item.post_id) bookmarkedPostMap[item.post_id] = true;
            const profileMap = {};
            for (const profile of profiles ?? []) {
              const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
              if (profile.username && displayName) profileMap[profile.username] = displayName;
            }
            return { likeCountMap, commentMap, likedByMeMap, bookmarkedPostMap, profileMap, tasteTrustSummaryMap: {} };
          },
        };
      }
      if (id === "@/lib/server/normalize-review") {
        return { normalizeReview: (review) => review };
      }
      if (id === "@/lib/server/route-supabase") {
        return {
          getRouteActor: async () => ({
            actor: viewerName
              ? { userId: "viewer-id", actorName: viewerName, displayName: viewerName }
              : null,
          }),
        };
      }
      if (id === "@/lib/server/post-views") {
        return { loadSeenPostIdsForUser: async (_db, _userId, extraPostIds = []) => new Set(extraPostIds) };
      }
      throw new Error(`Unexpected require in public-feed tests: ${id}`);
    },
  });
  return mod.exports;
}

let _seq = 0;
function review(overrides = {}) {
  const id = `rev-${++_seq}`;
  return {
    id,
    reviewer_name: "alice",
    restaurant_name: "Cafe One",
    visibility: "public",
    created_at: "2026-01-01T00:00:00.000Z",
    items: [],
    body: null,
    photo_url: null,
    photo_urls: null,
    area: null,
    restaurant_id: null,
    restaurant_address: null,
    restaurant_lat: null,
    restaurant_lng: null,
    deleted_at: null,
    hidden_at: null,
    reported_at: null,
    status: "active",
    ...overrides,
  };
}

// ── invalid cursor ────────────────────────────────────────────────────────────

test("public feed: invalid cursor returns 400", async () => {
  const { GET } = loadRoute({ db: mockDb() });
  const res = await GET(makeReq("cursor=not-valid-json"));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /invalid cursor/i);
});

// ── visibility filter ─────────────────────────────────────────────────────────

test("public feed: query uses eq('visibility', 'public')", async () => {
  const db = spyDb(
    { data: [], error: null }, // reviews
  );
  const { GET } = loadRoute({ db, viewerName: "viewer" });
  await GET(makeReq());
  const reviewCall = db._calls.find((c) => c.table === "reviews");
  assert.ok(reviewCall, "should query reviews table");
  assert.equal(eqFilters(reviewCall)["visibility"], "public");
  assert.equal(eqFilters(reviewCall)["status"], "active");
});

test("public feed: location params constrain reviews to nearby restaurants", async () => {
  const db = spyDb(
    { data: [], error: null }, // reviews
  );
  const { GET } = loadRoute({ db, viewerName: "carol" });
  await GET(makeReq("lat=17.4239&lng=78.4738"));
  const reviewCall = db._calls.find((c) => c.table === "reviews");
  assert.ok(reviewCall, "should query reviews table");
  assert.ok(reviewCall.ops.some(([op, col]) => op === "gte" && col === "restaurant_lat"));
  assert.ok(reviewCall.ops.some(([op, col]) => op === "lte" && col === "restaurant_lat"));
  assert.ok(reviewCall.ops.some(([op, col]) => op === "gte" && col === "restaurant_lng"));
  assert.ok(reviewCall.ops.some(([op, col]) => op === "lte" && col === "restaurant_lng"));
});

// ── exclude filter ────────────────────────────────────────────────────────────

test("public feed: posts from excluded names are not returned", async () => {
  const db = mockDb(
    { data: [review({ reviewer_name: "alice" }), review({ reviewer_name: "bob" }), review({ reviewer_name: "charlie" })], error: null }, // reviews
    { data: [], error: null }, // likes
    { data: [], error: null }, // comments
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq("exclude=alice,bob"));
  assert.equal(status(res), 200);
  assert.equal(body(res).reviews.length, 1);
  assert.equal(body(res).reviews[0].reviewer_name, "charlie");
});

test("public feed: excludeSynthetic hides E2E fixture posts for discovery surfaces", async () => {
  const db = mockDb(
    {
      data: [
        review({ reviewer_name: "e2e_alice", restaurant_name: "Good Real Cafe" }),
        review({ reviewer_name: "alice", restaurant_name: "E2E Smoke Test Eats" }),
        review({ reviewer_name: "alice", restaurant_name: "Smoke Test Eats" }),
        review({ reviewer_name: "bob", restaurant_name: "Good Real Cafe" }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq("excludeSynthetic=1"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res).reviews.map((r) => r.reviewer_name), ["bob"]);
});

test("public feed: excludeSeen removes locally seen post ids from refresh results", async () => {
  const db = mockDb(
    {
      data: [
        review({ id: "seen-1", reviewer_name: "alice" }),
        review({ id: "fresh-1", reviewer_name: "bob" }),
        review({ id: "seen-2", reviewer_name: "carol" }),
        review({ id: "fresh-2", reviewer_name: "dave" }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq("excludeSeen=seen-1,seen-2"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res).reviews.map((r) => r.id), ["fresh-1", "fresh-2"]);
});

test("public feed: excludeSeen falls back to seen rows instead of returning an empty feed", async () => {
  const db = mockDb(
    {
      data: [
        review({ id: "seen-1", reviewer_name: "alice" }),
        review({ id: "seen-2", reviewer_name: "bob" }),
      ],
      error: null,
    },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq("excludeSeen=seen-1,seen-2"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res).reviews.map((r) => r.id), ["seen-1", "seen-2"]);
});

test("public feed: empty exclude returns all rows", async () => {
  const db = mockDb(
    { data: [review({ reviewer_name: "alice" }), review({ reviewer_name: "bob" })], error: null },
    { data: [], error: null }, // likes
    { data: [], error: null }, // comments
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(status(res), 200);
  assert.equal(body(res).reviews.length, 2);
});

test("public feed: viewer's own posts are included in the public universe", async () => {
  const db = mockDb(
    { data: [review({ reviewer_name: "carol" }), review({ reviewer_name: "viewer" })], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db, viewerName: "viewer" });
  const res = await GET(makeReq("viewer=viewer"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res).reviews.map((r) => r.reviewer_name), ["carol", "viewer"]);
});

test("public feed: posts from joined circles are included in the public universe", async () => {
  const db = mockDb(
    { data: [review({ reviewer_name: "alice" }), review({ reviewer_name: "bob" }), review({ reviewer_name: "charlie" })], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq("viewer=viewer"));
  assert.equal(status(res), 200);
  assert.deepEqual(body(res).reviews.map((r) => r.reviewer_name), ["alice", "bob", "charlie"]);
});

// ── pagination ────────────────────────────────────────────────────────────────

test("public feed: hasMore is true and nextCursor is set when DB returns more than limit", async () => {
  // Return PAGE_SIZE + 1 rows so hasMore triggers
  const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
    review({ id: `r${i}`, created_at: `2026-01-0${i + 1}T00:00:00.000Z` })
  );
  const db = mockDb(
    { data: rows, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(status(res), 200);
  assert.equal(body(res).hasMore, true);
  assert.equal(body(res).reviews.length, PAGE_SIZE);
  assert.ok(body(res).nextCursor, "nextCursor should be set");
  assert.ok(body(res).nextCursor.id, "nextCursor.id should be present");
  assert.ok(body(res).nextCursor.createdAt, "nextCursor.createdAt should be present");
});

test("public feed: hasMore is false and nextCursor is null when rows fit in one page", async () => {
  const rows = [review(), review()];
  const db = mockDb(
    { data: rows, error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(status(res), 200);
  assert.equal(body(res).hasMore, false);
  assert.equal(body(res).nextCursor, null);
});

test("public feed: cursor is applied to the reviews query as an or filter", async () => {
  const db = spyDb({ data: [], error: null });
  const { GET } = loadRoute({ db });
  const cursor = JSON.stringify({ createdAt: "2026-01-05T00:00:00.000Z", id: "rev-abc" });
  await GET(makeReq(`cursor=${encodeURIComponent(cursor)}`));
  const reviewCall = db._calls.find((c) => c.table === "reviews");
  assert.ok(hasOp(reviewCall, "or"), "should apply cursor as or filter");
});

// ── empty result ──────────────────────────────────────────────────────────────

test("public feed: empty DB result returns empty arrays and maps", async () => {
  const db = mockDb({ data: [], error: null });
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(status(res), 200);
  assert.equal(body(res).reviews.length, 0);
  assert.equal(body(res).hasMore, false);
  assert.equal(body(res).nextCursor, null);
});

// ── likeCountMap ──────────────────────────────────────────────────────────────

test("public feed: likeCountMap counts all likes per post", async () => {
  const r = review({ id: "post-1" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [{ post_id: "post-1", user_name: "alice" }, { post_id: "post-1", user_name: "bob" }], error: null }, // likes
    { data: [], error: null }, // comments
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(body(res).likeCountMap["post-1"], 2);
});

// ── likedByMeMap ──────────────────────────────────────────────────────────────

test("public feed: likedByMeMap marks posts liked by the viewer", async () => {
  const r = review({ id: "post-2" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [{ post_id: "post-2", user_name: "carol" }, { post_id: "post-2", user_name: "viewer" }], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null }, // wishlist (viewer present)
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db, viewerName: "viewer" });
  const res = await GET(makeReq("viewer=viewer"));
  assert.equal(body(res).likedByMeMap["post-2"], true);
});

test("public feed: likedByMeMap does not mark posts not liked by the viewer", async () => {
  const r = review({ id: "post-3" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [{ post_id: "post-3", user_name: "alice" }], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  );
  const { GET } = loadRoute({ db, viewerName: "carol" });
  const res = await GET(makeReq("viewer=carol"));
  assert.equal(body(res).likedByMeMap["post-3"], undefined);
});

// ── commentMap ────────────────────────────────────────────────────────────────

test("public feed: commentMap counts comments and stores top comment", async () => {
  const r = review({ id: "post-4" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [], error: null }, // likes
    {
      data: [
        { id: "c1", post_id: "post-4", user_name: "alice", content: "first", created_at: "2026-01-02T00:00:00.000Z" },
        { id: "c2", post_id: "post-4", user_name: "bob", content: "second", created_at: "2026-01-01T00:00:00.000Z" },
      ],
      error: null,
    },
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(body(res).commentMap["post-4"].count, 2);
  assert.equal(body(res).commentMap["post-4"].top.id, "c1");
});

// ── bookmarkedPostMap ───────────────────────────────────────────────────

test("public feed: bookmarkedPostMap marks posts in viewer's wishlist", async () => {
  const r = review({ id: "post-5", restaurant_name: "Bawarchi" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [], error: null }, // likes
    { data: [], error: null }, // comments
    { data: [{ post_id: "post-5" }], error: null }, // wishlist
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db, viewerName: "carol" });
  const res = await GET(makeReq("viewer=carol"));
  assert.equal(body(res).bookmarkedPostMap["post-5"], true);
});

test("public feed: wishlist lookup is keyed by visible post ids, not restaurant names", async () => {
  const r = review({ id: "post-wishlist-key", restaurant_name: "Same Place" });
  const db = spyDb(
    { data: [r], error: null }, // reviews
    { data: [], error: null }, // likes
    { data: [], error: null }, // comments
    { data: [], error: null }, // wishlist
    { data: [], error: null }, // profiles
  );
  const { GET } = loadRoute({ db, viewerName: "viewer" });
  await GET(makeReq("viewer=viewer"));

  const wishlistCall = db._calls.find((c) => c.table === "wishlist");
  assert.ok(wishlistCall, "should query wishlist when a viewer is present");
  assert.ok(
    wishlistCall.ops.some(([op, col]) => op === "select" && col === "post_id"),
    "wishlist lookup should only select post_id"
  );
  assert.ok(
    wishlistCall.ops.some(
      ([op, col, ids]) =>
        op === "in" &&
        col === "post_id" &&
        Array.isArray(ids) &&
        ids.includes("post-wishlist-key")
    ),
    "wishlist lookup should filter by visible post ids"
  );
  assert.ok(
    !wishlistCall.ops.some(([, col]) => col === "restaurant_name"),
    "wishlist lookup must not use restaurant_name for post save state"
  );
});

// ── profileMap ────────────────────────────────────────────────────────────────

test("public feed: profileMap maps reviewer username to display name", async () => {
  const r = review({ id: "post-6", reviewer_name: "alice" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [], error: null }, // likes
    { data: [], error: null }, // comments
    { data: [{ username: "alice", first_name: "Alice", last_name: "Ate" }], error: null }, // profiles
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(body(res).profileMap["alice"], "Alice Ate");
});

test("public feed: profileMap skips profiles with no display name", async () => {
  const r = review({ id: "post-7", reviewer_name: "ghost" });
  const db = mockDb(
    { data: [r], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [{ username: "ghost", first_name: null, last_name: null }], error: null },
  );
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal("ghost" in body(res).profileMap, false);
});

// ── DB error ──────────────────────────────────────────────────────────────────

test("public feed: DB error on reviews query returns 500", async () => {
  const db = mockDb({ data: null, error: { message: "connection failed" } });
  const { GET } = loadRoute({ db });
  const res = await GET(makeReq());
  assert.equal(status(res), 500);
  assert.match(body(res).error, /connection failed/);
});
