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

function createSessionStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => Array.from(values.keys())[index] ?? null,
  };
}

function loadFeedState(sessionStorage = createSessionStorage(), now = () => 1_000) {
  const source = readFileSync(new URL("../lib/browser-feed-state.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    sessionStorage,
    Date: {
      now,
    },
    require(id) {
      throw new Error(`Unexpected require in browser-feed-state tests: ${id}`);
    },
  });
  return { feedState: mod.exports, sessionStorage };
}

test("browser feed state restores values until TTL expiry", () => {
  let now = 1_000;
  const { feedState, sessionStorage } = loadFeedState(createSessionStorage(), () => now);

  feedState.writeFeedState("/api/me?viewer=alice", { ids: ["a", "b"] }, 500);

  assert.equal(JSON.stringify(feedState.readFeedState("/api/me?viewer=alice")), JSON.stringify({ ids: ["a", "b"] }));
  now = 1_600;
  assert.equal(feedState.readFeedState("/api/me?viewer=alice"), null);
  assert.equal(sessionStorage.getItem("fc_feed_state:/api/me?viewer=alice"), null);
});

test("browser feed state prefix clearing removes matching snapshots only", () => {
  const { feedState } = loadFeedState();

  feedState.writeFeedState("/api/me?viewer=alice", { ids: ["me"] }, 500);
  feedState.writeFeedState("/api/feed/circle?viewer=alice", { ids: ["circle"] }, 500);
  feedState.writeFeedState("/api/feed/public?viewer=alice", { ids: ["public"] }, 500);

  feedState.clearFeedState("/api/feed/");

  assert.equal(JSON.stringify(feedState.readFeedState("/api/me?viewer=alice")), JSON.stringify({ ids: ["me"] }));
  assert.equal(feedState.readFeedState("/api/feed/circle?viewer=alice"), null);
  assert.equal(feedState.readFeedState("/api/feed/public?viewer=alice"), null);
});

test("seen post storage is versioned so old seen maps can be invalidated safely", () => {
  const source = readFileSync(new URL("../lib/browser-post-views.ts", import.meta.url), "utf8");

  assert.match(source, /const SEEN_POST_STORAGE_VERSION = "v2"/);
  assert.match(source, /const STORAGE_PREFIX = `fc_seen_posts:\$\{SEEN_POST_STORAGE_VERSION\}:`/);
  assert.doesNotMatch(source, /const STORAGE_PREFIX = "fc_seen_posts:"/);
});

test("browser feed state removes a deleted post from all persisted snapshots", () => {
  const { feedState } = loadFeedState();

  feedState.writeFeedState("/api/feed/circle?viewer=alice", {
    reviews: [{ id: "keep" }, { id: "delete-me" }],
    likeCountMap: { keep: 1, "delete-me": 2 },
    commentMap: { "delete-me": { count: 1 } },
    likedByMeMap: { "delete-me": true },
    bookmarkedPostMap: { "delete-me": true },
    tasteTrustSummaryMap: { "delete-me": { tried_count: 1 } },
  }, 500);
  feedState.writeFeedState("/api/feed/public?viewer=alice", {
    posts: [{ id: "delete-me" }, { id: "other" }],
  }, 500);

  feedState.removePostFromPersistedFeedSnapshots("delete-me");

  const circle = feedState.readFeedState("/api/feed/circle?viewer=alice");
  const publicFeed = feedState.readFeedState("/api/feed/public?viewer=alice");
  assert.equal(JSON.stringify(circle.reviews), JSON.stringify([{ id: "keep" }]));
  assert.equal(JSON.stringify(circle.likeCountMap), JSON.stringify({ keep: 1 }));
  assert.equal(circle.commentMap["delete-me"], undefined);
  assert.equal(circle.likedByMeMap["delete-me"], undefined);
  assert.equal(circle.bookmarkedPostMap["delete-me"], undefined);
  assert.equal(circle.tasteTrustSummaryMap["delete-me"], undefined);
  assert.equal(JSON.stringify(publicFeed.posts), JSON.stringify([{ id: "other" }]));
});

test("post deletion invalidation preserves feed snapshots while clearing API caches", () => {
  const cache = readFileSync(new URL("../lib/browser-api-cache.ts", import.meta.url), "utf8");

  assert.match(cache, /function invalidatePostDeletionCaches/);
  assert.match(cache, /removePostFromPersistedFeedSnapshots\(postId\)/);
  assert.match(cache, /invalidateCachedJson\(prefix, \{ clearFeedSnapshots: false \}\)/);
});

test("private feed snapshots and auth sync are guarded by viewer-specific cache safety", () => {
  const circle = readFileSync(new URL("../components/circle/CircleFeedClient.tsx", import.meta.url), "utf8");
  const me = readFileSync(new URL("../components/me/MeClient.tsx", import.meta.url), "utf8");
  const authSync = readFileSync(new URL("../components/auth/AuthSync.tsx", import.meta.url), "utf8");

  assert.match(circle, /function circleFeedStateKey/);
  assert.match(circle, /\/api\/feed\/circle\?viewer=/);
  assert.match(me, /function meFeedStateKey/);
  assert.match(me, /\/api\/me\?viewer=/);
  assert.match(authSync, /invalidateViewerCaches/);
  assert.match(authSync, /clearStoredActor/);
  assert.match(authSync, /getStoredActorName/);
});
