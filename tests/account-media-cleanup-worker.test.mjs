import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/server/account-media-cleanup.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
});

const mod = { exports: {} };
vm.runInNewContext(outputText, {
  Date,
  module: mod,
  exports: mod.exports,
  require(id) {
    if (id === "@/lib/memory-media-policy") return { MEMORY_MEDIA_BUCKET: "memory-media" };
    if (id === "@/lib/server/review-media") {
      return {
        REVIEW_MEDIA_BUCKET: "review-photos",
        REVIEW_MEDIA_QUARANTINE_BUCKET: "review-media-quarantine",
        isOwnedReviewMediaPath: (path, userId) => path.startsWith(`avatars/${userId}/`) || path.startsWith(`posts/${userId}/`),
        isOwnedReviewMediaQuarantinePath: (path, userId) => path.startsWith(`pending/${userId}/`)
      };
    }
    if (id === "@/lib/server/media-pipeline") {
      return {
        MEDIA_PRIVATE_BUCKET: "media-private",
        MEDIA_PUBLIC_BUCKET: "media-public",
        MEDIA_SOURCE_BUCKET: "media-sources",
        isOwnedGenericMediaPath: (path, userId) =>
          path.startsWith(`sources/post/${userId}/`) ||
          path.startsWith(`sources/avatar/${userId}/`) ||
          path.startsWith(`sources/memory/${userId}/`) ||
          path.startsWith(`private-posts/${userId}/`) ||
          path.startsWith(`avatars/${userId}/`) ||
          path.startsWith(`memories/${userId}/`)
      };
    }
    if (id === "@/lib/supabase/admin") return { createAdminClient: () => ({}) };
    throw new Error(`Unexpected require in cleanup worker tests: ${id}`);
  }
});

const {
  isOwnedAccountStoragePath,
  removeStorageObjectsOrQueue,
  recordAccountMediaCleanupJob,
  STORAGE_REMOVE_BATCH_SIZE,
  storageObjectPathsForPrefixes
} = mod.exports;

test("account media cleanup path ownership rejects cross-user review, quarantine, and memory paths", () => {
  assert.equal(isOwnedAccountStoragePath({
    bucketId: "review-photos",
    path: "posts/user-a/intent/media.jpg",
    userId: "user-a"
  }), true);
  assert.equal(isOwnedAccountStoragePath({
    bucketId: "review-photos",
    path: "posts/user-b/intent/media.jpg",
    userId: "user-a"
  }), false);
  assert.equal(isOwnedAccountStoragePath({
    bucketId: "review-media-quarantine",
    path: "pending/user-a/intent/original.jpg",
    userId: "user-a"
  }), true);
  assert.equal(isOwnedAccountStoragePath({
    bucketId: "memory-media",
    ownerNames: ["alice"],
    path: "memories/room-1/alice/intent/media.jpg",
    userId: "user-a"
  }), true);
  assert.equal(isOwnedAccountStoragePath({
    bucketId: "memory-media",
    ownerNames: ["alice"],
    path: "memories/room-1/bob/intent/media.jpg",
    userId: "user-a"
  }), false);
});

test("account media cleanup storage enumeration paginates beyond one storage page", async () => {
  const listCalls = [];
  const admin = {
    storage: {
      from(bucketId) {
        assert.equal(bucketId, "review-photos");
        return {
          list(prefix, options) {
            listCalls.push([prefix, options.offset, options.limit]);
            if (prefix === "posts/user-a/" && options.offset === 0) {
              return Promise.resolve({
                data: [
                  { id: null, metadata: null, name: "bulk" },
                  { id: "single-id", metadata: {}, name: "single.jpg" }
                ],
                error: null
              });
            }
            if (prefix === "posts/user-a/" && options.offset === 2) {
              return Promise.resolve({ data: [], error: null });
            }
            if (prefix === "posts/user-a/bulk/" && options.offset === 0) {
              return Promise.resolve({
                data: [
                  { id: "0", metadata: {}, name: "object-0.jpg" },
                  { id: "1", metadata: {}, name: "object-1.jpg" }
                ],
                error: null
              });
            }
            if (prefix === "posts/user-a/bulk/" && options.offset === 2) {
              return Promise.resolve({
                data: [{ id: "2", metadata: {}, name: "object-2.jpg" }],
                error: null
              });
            }
            return Promise.resolve({ data: [], error: null });
          }
        };
      }
    }
  };

  const paths = await storageObjectPathsForPrefixes(admin, "review-photos", ["posts/user-a/"], 2);

  assert.equal(JSON.stringify(listCalls), JSON.stringify([
    ["posts/user-a/", 0, 2],
    ["posts/user-a/bulk/", 0, 2],
    ["posts/user-a/bulk/", 2, 2],
    ["posts/user-a/", 2, 2]
  ]));
  assert.equal(JSON.stringify(paths), JSON.stringify([
    "posts/user-a/bulk/object-0.jpg",
    "posts/user-a/bulk/object-1.jpg",
    "posts/user-a/bulk/object-2.jpg",
    "posts/user-a/single.jpg"
  ]));
});

test("account media cleanup job records only owner-scoped paths", async () => {
  let inserted;
  const admin = {
    from(table) {
      assert.equal(table, "account_media_cleanup_jobs");
      const chain = {
        insert(row) {
          inserted = row;
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: "job-1" }, error: null });
        },
        select() {
          return chain;
        }
      };
      return chain;
    }
  };

  const jobId = await recordAccountMediaCleanupJob(admin, {
    bucketId: "review-photos",
    error: new Error("remove failed"),
    paths: ["posts/user-a/intent/media.jpg", "posts/user-b/intent/media.jpg"],
    userId: "user-a"
  });

  assert.equal(jobId, "job-1");
  assert.equal(JSON.stringify(inserted.storage_paths), JSON.stringify(["posts/user-a/intent/media.jpg"]));
  assert.equal(inserted.status, "pending");
});

test("account media cleanup removes storage objects in bounded batches", async () => {
  const removeCalls = [];
  const paths = Array.from(
    { length: STORAGE_REMOVE_BATCH_SIZE + 3 },
    (_, index) => `posts/user-a/intent-${index}/media.jpg`
  );
  const admin = {
    storage: {
      from(bucketId) {
        assert.equal(bucketId, "review-photos");
        return {
          remove(batch) {
            removeCalls.push(batch);
            return Promise.resolve({ error: null });
          }
        };
      }
    }
  };

  const result = await removeStorageObjectsOrQueue(admin, {
    bucketId: "review-photos",
    paths,
    userId: "user-a"
  });

  assert.equal(result.cleanupPending, false);
  assert.equal(result.removedCount, paths.length);
  assert.equal(removeCalls.length, 2);
  assert.equal(removeCalls[0].length, STORAGE_REMOVE_BATCH_SIZE);
  assert.equal(removeCalls[1].length, 3);
});

test("account media cleanup queues only failed owner-scoped storage batches", async () => {
  const paths = Array.from(
    { length: STORAGE_REMOVE_BATCH_SIZE + 2 },
    (_, index) => `posts/user-a/intent-${index}/media.jpg`
  );
  paths.push("posts/user-b/not-owned/media.jpg");

  let removeIndex = 0;
  let inserted;
  const admin = {
    from(table) {
      assert.equal(table, "account_media_cleanup_jobs");
      const chain = {
        insert(row) {
          inserted = row;
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: "job-1" }, error: null });
        },
        select() {
          return chain;
        }
      };
      return chain;
    },
    storage: {
      from(bucketId) {
        assert.equal(bucketId, "review-photos");
        return {
          remove() {
            removeIndex += 1;
            if (removeIndex === 1) return Promise.resolve({ error: null });
            return Promise.resolve({ error: new Error("storage unavailable") });
          }
        };
      }
    }
  };

  const result = await removeStorageObjectsOrQueue(admin, {
    bucketId: "review-photos",
    paths,
    userId: "user-a"
  });

  assert.equal(result.cleanupPending, true);
  assert.equal(result.removedCount, STORAGE_REMOVE_BATCH_SIZE);
  assert.equal(inserted.status, "pending");
  assert.equal(inserted.last_error, "storage unavailable");
  assert.equal(JSON.stringify(inserted.storage_paths), JSON.stringify([
    `posts/user-a/intent-${STORAGE_REMOVE_BATCH_SIZE}/media.jpg`,
    `posts/user-a/intent-${STORAGE_REMOVE_BATCH_SIZE + 1}/media.jpg`
  ]));
});
