import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function loadModule() {
  const { outputText } = ts.transpileModule(source("lib/server/account-deletion.ts"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Buffer,
    Date,
    console,
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "node:crypto") return crypto;
      if (id === "@/lib/server/account-media-cleanup") {
        return {
          isOwnedAccountStoragePath: ({ path, userId }) => path.includes(`/${userId}/`),
          uniqueStrings: (values) => Array.from(new Set(values.filter(Boolean)))
        };
      }
      if (id === "@/lib/server/review-media") {
        return { REVIEW_MEDIA_BUCKET: "review-photos", publicReviewMediaPathFromUrl: () => null };
      }
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => ({}) };
      throw new Error(`Unexpected require: ${id}`);
    }
  });
  return mod.exports;
}

test("Phase 1B migration is mirrored and creates a service-only resumable state machine", () => {
  const root = source("supabase/migrations/202607130002_complete_account_deletion.sql");
  const mobile = source("mobile/supabase/migrations/202607130002_complete_account_deletion.sql");
  assert.equal(root, mobile);
  assert.match(root, /create table if not exists public\.account_deletion_jobs/);
  assert.match(root, /create table if not exists public\.account_deletion_storage_items/);
  assert.match(root, /create table if not exists public\.account_deletion_ambiguous_items/);
  assert.match(root, /for update skip locked/);
  assert.match(root, /lease_expires_at/);
  assert.match(root, /revoke all on table public\.account_deletion_jobs from public, anon, authenticated/);
  assert.match(root, /grant execute on function public\.request_account_deletion\(\) to authenticated/);
  assert.match(root, /grant execute on function public\.account_deletion_cleanup_database\(uuid\) to service_role/);
  assert.match(root, /purge_expired_account_deletion_records/);
  assert.match(root, /raise exception 'use_durable_account_deletion'/);
});

test("Phase 1B freezes before inventory and requires verified Storage before database cleanup", () => {
  const migration = source("supabase/migrations/202607130002_complete_account_deletion.sql");
  const freeze = migration.indexOf("set account_status = 'deleting'");
  const inventoryFunction = migration.indexOf("account_deletion_storage_candidates");
  const pendingGuard = migration.indexOf("account_deletion_storage_not_complete");
  const profileDelete = migration.indexOf("delete from public.profiles where id = v_uid");
  assert.ok(freeze >= 0 && freeze < inventoryFunction);
  assert.ok(pendingGuard >= 0 && pendingGuard < profileDelete);
  assert.match(migration, /update public\.reviews[\s\S]*status = 'deleted'/);
  assert.match(migration, /account_status = 'active'[\s\S]*deletion_started_at is null/);
  assert.match(migration, /public\.account_is_active\(asset\.owner_id\)/);
});

test("shared Memory policy preserves other-member content and removes deleted-member attribution", () => {
  const migration = source("supabase/migrations/202607130002_complete_account_deletion.sql");
  assert.match(migration, /update %s set created_by = ''deleted-account''/);
  assert.match(migration, /delete from %s where uploader_id = \$1 or uploader_name = \$2/);
  assert.match(migration, /delete from %s where author_name = \$1/);
  assert.match(migration, /member\.user_name <> \$1/);
  assert.match(migration, /sharedRoomsPreserved/);
  assert.match(migration, /soleRoomsDeleted/);
});

test("Auth deletion treats an already-missing user as idempotent completion", async () => {
  const { processClaimedAccountDeletionJob } = loadModule();
  let jobUpdate = null;
  const admin = {
    auth: {
      admin: {
        deleteUser: async () => ({ error: { message: "User not found", status: 404 } })
      }
    },
    from(table) {
      assert.equal(table, "account_deletion_jobs");
      return {
        update(values) {
          jobUpdate = values;
          return { eq: async () => ({ error: null }) };
        }
      };
    }
  };
  const state = await processClaimedAccountDeletionJob(admin, {
    attempts: 2,
    id: "job-1",
    inventory_cursor: {},
    max_attempts: 50,
    owner_name: "owner",
    status: "auth_deletion_pending",
    user_id: "user-1"
  });
  assert.equal(state, "completed");
  assert.equal(jobUpdate.status, "completed");
  assert.ok(jobUpdate.auth_deleted_at);
  assert.ok(jobUpdate.completed_at);
});

test("a partial Storage failure remains retryable and resumes without deleting another path", async () => {
  const { processClaimedAccountDeletionJob } = loadModule();
  let removeShouldFail = true;
  let objectPresent = true;
  const items = [{ attempts: 0, bucket_id: "media-private", id: "item-1", status: "pending", storage_path: "private-posts/user-1/asset/canonical.jpg" }];
  const itemUpdates = [];
  const jobUpdates = [];
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "media-private");
        return {
          list: async () => ({ data: objectPresent ? [{ name: "canonical.jpg" }] : [], error: null }),
          remove: async (paths) => {
            assert.deepEqual(Array.from(paths), ["private-posts/user-1/asset/canonical.jpg"]);
            if (removeShouldFail) return { error: { message: "storage unavailable" } };
            objectPresent = false;
            return { error: null };
          }
        };
      }
    },
    from(table) {
      if (table === "account_deletion_storage_items") {
        return {
          select() {
            const chain = {};
            for (const name of ["eq", "in", "order", "limit"]) chain[name] = () => chain;
            chain.returns = async () => ({ data: items.filter((item) => ["pending", "failed", "deleting"].includes(item.status)), error: null });
            return chain;
          },
          update(values) {
            return {
              eq: async (_column, id) => {
                itemUpdates.push(values);
                const item = items.find((candidate) => candidate.id === id);
                if (item) Object.assign(item, values);
                return { error: null };
              }
            };
          }
        };
      }
      if (table === "account_deletion_jobs") {
        return {
          update(values) {
            jobUpdates.push(values);
            return { eq: async () => ({ error: null }) };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };
  const job = { attempts: 1, id: "job-1", inventory_cursor: {}, max_attempts: 50, owner_name: "owner", status: "storage_cleanup_pending", user_id: "user-1" };

  assert.equal(await processClaimedAccountDeletionJob(admin, job), "storage_cleanup_pending");
  assert.equal(items[0].status, "failed");
  assert.equal(objectPresent, true);

  removeShouldFail = false;
  assert.equal(await processClaimedAccountDeletionJob(admin, job), "storage_cleanup_pending");
  assert.equal(items[0].status, "deleted");
  assert.equal(objectPresent, false);

  assert.equal(await processClaimedAccountDeletionJob(admin, job), "database_cleanup_pending");
  assert.equal(jobUpdates.at(-1).status, "database_cleanup_pending");
  assert.ok(itemUpdates.some((update) => update.last_error_code === "temporary_unavailable"));
});

test("mobile deletion accepts background completion and immediately clears active state", () => {
  const service = source("mobile/src/services/settings.ts");
  const hook = source("mobile/src/hooks/useSettings.ts");
  const screen = source("mobile/app/profile/settings.tsx");
  assert.match(service, /payload\?\.accepted/);
  assert.match(service, /await supabase\.auth\.signOut/);
  assert.match(hook, /clearSession\(\)/);
  assert.match(hook, /queryClient\.clear\(\)/);
  assert.match(screen, /Deletion started/);
  assert.match(screen, /Starting\.\.\./);
});
