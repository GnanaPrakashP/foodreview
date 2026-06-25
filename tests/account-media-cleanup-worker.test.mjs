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
    if (id === "@/lib/supabase/admin") return { createAdminClient: () => ({}) };
    throw new Error(`Unexpected require in cleanup worker tests: ${id}`);
  }
});

const {
  isOwnedAccountStoragePath,
  recordAccountMediaCleanupJob,
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
  const ranges = [];
  const pages = [
    Array.from({ length: 2 }, (_, i) => ({ name: `posts/user-a/${i}/media.jpg` })),
    [{ name: "posts/user-a/2/media.jpg" }]
  ];
  const admin = {
    schema(schemaName) {
      assert.equal(schemaName, "storage");
      return {
        from(table) {
          assert.equal(table, "objects");
          const chain = {
            _from: 0,
            _to: 0,
            eq() { return chain; },
            like() { return chain; },
            order() { return chain; },
            range(from, to) {
              ranges.push([from, to]);
              chain._from = from;
              chain._to = to;
              return chain;
            },
            returns() { return chain; },
            select() { return chain; },
            then(resolve) {
              const index = chain._from === 0 ? 0 : 1;
              return Promise.resolve({ data: pages[index], error: null }).then(resolve);
            }
          };
          return chain;
        }
      };
    }
  };

  const paths = await storageObjectPathsForPrefixes(admin, "review-photos", ["posts/user-a/"], 2);

  assert.deepEqual(ranges, [[0, 1], [2, 3]]);
  assert.equal(JSON.stringify(paths), JSON.stringify([
    "posts/user-a/0/media.jpg",
    "posts/user-a/1/media.jpg",
    "posts/user-a/2/media.jpg"
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
