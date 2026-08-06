import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function loadTs(relativePath, requireModule) {
  const { outputText } = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Error,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    Set,
    console,
    exports: mod.exports,
    module: mod,
    require: requireModule
  });
  return mod.exports;
}

function loadPostingStore() {
  return loadTs("mobile/src/stores/postingStore.ts", (id) => {
    if (id === "zustand") return nodeRequire("../mobile/node_modules/zustand");
    throw new Error(`Unexpected import: ${id}`);
  });
}

const SCOPE = "owner-scope";

function loadQueueStore({ scope = SCOPE, generation = 7 } = {}) {
  const storage = new Map();
  const queue = loadTs("mobile/src/services/postingQueueStore.ts", (id) => {
    if (id === "@/security/cacheOwnership") return {
      getActiveCacheGeneration: () => generation,
      getActiveCacheOwner: () => (scope ? { scope } : null),
      isCacheGenerationActive: (value) => value === generation,
      isValidCacheOwnerScope: (value) => typeof value === "string" && value.length > 0,
      LOCAL_DATA_SCHEMA_VERSION: 2
    };
    if (id === "@/security/localMMKV") return {
      createLocalMMKV: (name) => ({
        clearAll: () => {
          for (const key of Array.from(storage.keys())) {
            if (key.startsWith(`${name}:`)) storage.delete(key);
          }
        },
        getString: (key) => storage.get(`${name}:${key}`),
        remove: (key) => storage.delete(`${name}:${key}`),
        set: (key, value) => storage.set(`${name}:${key}`, value)
      })
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  return { queue, storage };
}

function postInput(overrides = {}) {
  return {
    caption: "great dosa",
    dishes: [{ name: "Ghee roast", rating: 5 }],
    mediaItems: [{ mediaType: "image", uri: "file:///a.jpg" }],
    restaurantName: "Test Place",
    visibility: "public",
    ...overrides
  };
}

test("a second post can be started while the first is still on its way", () => {
  const { usePostingStore, postingJobsInFlight, postingOverallProgress } = loadPostingStore();
  const store = usePostingStore.getState();

  store.enqueue({ id: "a", input: postInput(), mediaCount: 1 });
  store.setProgress("a", 0.5);
  store.enqueue({ id: "b", input: postInput(), mediaCount: 3 });

  const jobs = usePostingStore.getState().jobs;
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].status, "uploading");
  assert.equal(jobs[1].status, "queued");
  assert.equal(postingJobsInFlight(jobs).length, 2);
  // The bar describes both, not just the newest.
  assert.equal(postingOverallProgress(jobs), 0.25);
});

test("crossing into processing is a status change, not a stalled bar", () => {
  const { usePostingStore } = loadPostingStore();
  const store = usePostingStore.getState();
  store.enqueue({ id: "a", input: postInput(), mediaCount: 1 });

  store.setProgress("a", 0.89);
  assert.equal(usePostingStore.getState().jobs[0].status, "uploading");
  store.setProgress("a", 0.9);
  assert.equal(usePostingStore.getState().jobs[0].status, "processing");
  // Progress is bounded, so a runaway callback cannot overflow the bar.
  store.setProgress("a", 4);
  assert.equal(usePostingStore.getState().jobs[0].progress, 1);
});

test("a failed post stays in the list until it is retried or dismissed", () => {
  const { usePostingStore, postingJobsInFlight } = loadPostingStore();
  const store = usePostingStore.getState();
  store.enqueue({ id: "a", input: postInput(), mediaCount: 1 });

  store.fail("a", "Media did not pass the safety review.");
  let jobs = usePostingStore.getState().jobs;
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].error, "Media did not pass the safety review.");
  // A failure is not in flight — the bar must not keep animating for it.
  assert.equal(postingJobsInFlight(jobs).length, 0);

  store.requeue("a");
  jobs = usePostingStore.getState().jobs;
  assert.equal(jobs[0].status, "queued");
  assert.equal(jobs[0].error, null);
  assert.equal(jobs[0].progress, 0);

  store.remove("a");
  assert.equal(usePostingStore.getState().jobs.length, 0);
});

test("a queued post survives a restart and belongs to one account", () => {
  const { queue } = loadQueueStore();
  queue.savePendingPost("post-1", postInput());
  const restored = queue.readPendingPosts();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "post-1");
  assert.equal(restored[0].input.restaurantName, "Test Place");
  assert.equal(restored[0].mediaCount, 1);

  queue.deletePendingPost("post-1");
  assert.equal(queue.readPendingPosts().length, 0);
});

test("another account's queued post is never returned", () => {
  const { storage } = loadQueueStore();
  const own = loadQueueStore();
  own.queue.savePendingPost("post-1", postInput());
  const raw = Array.from(own.storage.entries())[0];
  assert.ok(raw, "the entry is persisted under a scoped store name");

  // Same storage payload, different active owner.
  const other = loadQueueStore({ scope: "someone-else" });
  other.storage.set(raw[0], raw[1]);
  assert.equal(other.queue.readPendingPosts().length, 0);
  assert.equal(storage.size, 0);
});

test("a post with no media is never queued", () => {
  const { queue } = loadQueueStore();
  assert.throws(
    () => queue.savePendingPost("post-1", postInput({ mediaItems: [] })),
    /posting_queue_entry_invalid/
  );
});

test("sharing hands the post off and returns an empty composer", () => {
  const share = source("mobile/app/(tabs)/share.tsx");
  const runner = source("mobile/src/providers/PostingQueueRunner.tsx");
  const home = source("mobile/app/(tabs)/index.tsx");
  const isolation = source("mobile/src/services/localDataIsolation.ts");

  // Persisted before the composer is cleared: that snapshot becomes the only
  // copy of the post.
  const submit = share.slice(share.indexOf("const postId = createUuid()"), share.indexOf("router.replace(\"/\")"));
  assert.match(submit, /savePendingPost\(postId, input\)/);
  assert.ok(submit.indexOf("savePendingPost") < submit.indexOf("clearActivePostDraft"));
  assert.match(submit, /usePostingStore\.getState\(\)\.enqueue\(/);
  assert.match(share, /router\.replace\("\/"\)/);
  // Nothing waits, and the composer shows no in-flight state at all.
  assert.doesNotMatch(share, /await createPost\.mutateAsync/);
  assert.doesNotMatch(share, /createPost\.isPending|uploadPercent|createPost\.isError/);

  // The runner outlives the composer and drains one post at a time.
  assert.match(source("mobile/app/(tabs)/_layout.tsx"), /<PostingQueueRunner \/>/);
  assert.match(runner, /if \(runningRef\.current\) return;/);
  assert.match(runner, /createPost\(\{/);
  assert.match(runner, /deletePendingPost\(next\.id\)/);
  assert.match(runner, /applyCreatedPostInvalidations\(queryClient\)/);
  assert.match(runner, /readPendingPosts\(\)/);

  // The line lives on Home only.
  assert.match(home, /<PostingProgressBar \/>/);
  assert.doesNotMatch(share, /PostingProgressBar/);

  // Unsent content leaves with the account that wrote it.
  assert.match(isolation, /clearPostingQueueForScope\(next\.ownerScope\)/);
  assert.match(isolation, /usePostingStore\.getState\(\)\.reset\(\)/);
});

test("a permanent rejection is reported as its reason and never offered as a retry", () => {
  const { usePostingStore } = loadPostingStore();
  const store = usePostingStore.getState();
  store.enqueue({ id: "a", input: postInput(), mediaCount: 1 });
  store.fail("a", "Media did not pass the safety review.", "permanent");

  const job = usePostingStore.getState().jobs[0];
  assert.equal(job.failureKind, "permanent");
  assert.equal(job.error, "Media did not pass the safety review.");

  // A retry clears the verdict with it, so a genuine second attempt is not
  // pre-judged by the first.
  store.requeue("a");
  assert.equal(usePostingStore.getState().jobs[0].failureKind, "retryable");

  const bar = source("mobile/src/components/home/PostingProgressBar.tsx");
  const runner = source("mobile/src/providers/PostingQueueRunner.tsx");
  // The strip prints the server's reason rather than a generic line, and the
  // action follows the verdict.
  assert.match(bar, /\{first\.error \?\? "Could not share this post\."\}/);
  assert.match(bar, /permanent \? "Tap to dismiss" : "Tap to retry"/);
  assert.match(bar, /permanent \? remove\(first\.id\) : requeue\(first\.id\)/);
  // With several posts queued the reason alone does not say which one stopped.
  assert.match(bar, /const failedPlace = first\?\.input\.restaurantName\?\.trim\(\) \?\? ""/);
  assert.match(bar, /failedPlace \? <Text style=\{styles\.failurePlace\}>/);
  assert.match(runner, /mediaProcessingIssueKind\(error\) === "permanent"/);
  // A failure stays visible while another post is still uploading.
  assert.match(bar, /active\.length > 0 \? \(/);
});
