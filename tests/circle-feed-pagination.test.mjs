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

function loadCircleFeedModule() {
  const mod = { exports: {} };
  vm.runInNewContext(
    transpile(readFileSync(new URL("../lib/circle-feed.ts", import.meta.url), "utf8")),
    {
      module: mod,
      exports: mod.exports,
      console,
      require(id) {
        if (id === "@/lib/supabase/admin") return { createAdminClient: () => ({}) };
        if (id === "@/lib/circle-auth") return { getAuthenticatedCircleActor: async () => null };
        if (id === "@/lib/circle-db") return { getCircleRelationshipsForName: async () => ({ joinedCircles: new Set(), mutualMembers: new Set() }) };
        if (id === "@/lib/feed-ranking") return { rankCircleFeedReviews: (reviews) => reviews };
        if (id === "@/lib/visibility") return { filterCircleTrendingReviews: (reviews) => reviews };
        if (id === "@/lib/feed-config") return { CIRCLE_FEED_PAGE_SIZE: 10, CIRCLE_FEED_MAX_PAGE_SIZE: 10 };
        if (id === "@/lib/private-cache") return { getPrivateCached: async ({ load }) => (await load()).value, invalidatePrivateCacheByTags() {} };
        if (id === "@/lib/server/feed-assembly") {
          return { buildFeedAssemblyMaps: async () => ({ likeCountMap: {}, commentMap: {}, likedByMeMap: {}, bookmarkedPostMap: {}, profileMap: {}, tasteTrustSummaryMap: {} }) };
        }
        if (id === "@/lib/server/normalize-review") return { normalizeReview: (review) => review };
        if (id === "@/lib/server/post-views") return { loadSeenPostIdsForUser: async (_db, _userId, extraPostIds = []) => new Set(extraPostIds) };
        throw new Error(`Unexpected require in circle-feed pagination tests: ${id}`);
      },
    }
  );
  return mod.exports;
}

const {
  cursorForCircleFeedReview,
  isAfterCircleFeedCursor,
  parseCircleFeedCursor,
  serializeCircleFeedCursor,
} = loadCircleFeedModule();

function review(id, createdAt) {
  return { id, created_at: createdAt };
}

test("circle feed cursor uses created_at plus id as a stable tie-breaker", () => {
  const firstPageLast = review("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-05-13T10:00:00.000Z");
  const cursor = cursorForCircleFeedReview(firstPageLast);

  assert.equal(isAfterCircleFeedCursor(firstPageLast, cursor), false);
  assert.equal(isAfterCircleFeedCursor(review("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cursor.createdAt), cursor), true);
  assert.equal(isAfterCircleFeedCursor(review("cccccccc-cccc-4ccc-8ccc-cccccccccccc", cursor.createdAt), cursor), false);
  assert.equal(isAfterCircleFeedCursor(review("ffffffff-ffff-4fff-8fff-ffffffffffff", "2026-05-13T09:59:59.000Z"), cursor), true);
});

test("circle feed cursor serialization round-trips without offset state", () => {
  const cursor = {
    createdAt: "2026-05-13T10:00:00.000Z",
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };

  assert.equal(
    JSON.stringify(parseCircleFeedCursor(serializeCircleFeedCursor(cursor))),
    JSON.stringify(cursor)
  );
  assert.equal(parseCircleFeedCursor("not-json"), null);
  assert.equal(parseCircleFeedCursor(JSON.stringify({ createdAt: cursor.createdAt })), null);
  assert.equal(parseCircleFeedCursor(JSON.stringify({ createdAt: "invalid", id: cursor.id })), null);
  assert.equal(parseCircleFeedCursor(JSON.stringify({ createdAt: cursor.createdAt, id: "not-a-uuid" })), null);
});

test("ranked circle cursor preserves location, seen snapshot, and nullable distance", () => {
  const rankedCursor = {
    createdAt: "2026-07-21T08:30:00.000Z",
    distanceMeters: null,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    locationKey: "12.9716,77.5946",
    seen: false,
    seenCutoff: "2026-07-21T08:31:00.000Z"
  };

  assert.equal(
    JSON.stringify(parseCircleFeedCursor(serializeCircleFeedCursor(rankedCursor))),
    JSON.stringify(rankedCursor)
  );
});

test("partial or malformed ranked circle cursors are rejected", () => {
  const base = {
    createdAt: "2026-07-21T08:30:00.000Z",
    distanceMeters: 1200,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    locationKey: "12.9716,77.5946",
    seen: false,
    seenCutoff: "2026-07-21T08:31:00.000Z"
  };

  assert.equal(parseCircleFeedCursor(JSON.stringify({ ...base, locationKey: undefined })), null);
  assert.equal(parseCircleFeedCursor(JSON.stringify({ ...base, distanceMeters: -1 })), null);
  assert.equal(parseCircleFeedCursor(JSON.stringify({ ...base, seen: "false" })), null);
  assert.equal(parseCircleFeedCursor(JSON.stringify({ ...base, seenCutoff: "invalid" })), null);
});

test("circle feed implementation uses keyset pagination instead of offset ranges", () => {
  const source = readFileSync(new URL("../lib/circle-feed.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /\.range\(/);
  assert.doesNotMatch(source, /nextOffset|offset:/);
  assert.match(source, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(source, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(source, /created_at\.lt\.\$\{scanCursor\.createdAt\}/);
  assert.match(source, /id\.lt\.\$\{scanCursor\.id\}/);
  assert.match(source, /nextCursor = hasMore[\s\S]*cursorForCircleFeedReview\(allReviews\[allReviews\.length - 1\]\)/);
});
