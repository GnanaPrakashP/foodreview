import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function loadStandaloneTs(relativePath) {
  const { outputText } = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Error,
    Promise,
    exports: mod.exports,
    module: mod,
    require: () => {
      throw new Error("Unexpected import");
    },
    setTimeout
  });
  return mod.exports;
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
    Promise,
    Set,
    console,
    exports: mod.exports,
    module: mod,
    require: requireModule,
    setTimeout
  });
  return mod.exports;
}

test("cursor sync converges through more than 800 changes and commits every page cursor", async () => {
  const { runCursorSync } = loadStandaloneTs("mobile/src/services/memorySyncRunner.ts");
  const pages = new Map([
    ["0", {
      deletedMessageIds: [],
      deletedPhotoIds: [],
      hasMore: true,
      messages: [
        { body: "before", id: "message-updated-after-page-four" },
        { body: "delete me", id: "message-deleted-after-page-four" }
      ],
      photos: [{ id: "photo-deleted-after-page-four" }],
      syncCursor: "200"
    }],
    ...[200, 400, 600].map((cursor) => [String(cursor), {
      deletedMessageIds: [],
      deletedPhotoIds: [],
      hasMore: true,
      messages: [{ body: String(cursor), id: `filler-${cursor}` }],
      photos: [],
      syncCursor: String(cursor + 200)
    }]),
    ["800", {
      deletedMessageIds: ["message-deleted-after-page-four"],
      deletedPhotoIds: ["photo-deleted-after-page-four"],
      hasMore: false,
      messages: [{ body: "after", id: "message-updated-after-page-four" }],
      photos: [],
      syncCursor: "1000"
    }]
  ]);
  const committed = [];
  let durableCursor = "0";
  const result = await runCursorSync({
    fetchPage: async (cursor) => pages.get(cursor),
    initialCursor: durableCursor,
    initialState: { messages: {}, photos: {} },
    isActive: () => true,
    maxPages: 500,
    mergePage: (state, page) => {
      const messages = { ...state.messages };
      const photos = { ...state.photos };
      for (const message of page.messages) messages[message.id] = message;
      for (const photo of page.photos) photos[photo.id] = photo;
      for (const id of page.deletedMessageIds) delete messages[id];
      for (const id of page.deletedPhotoIds) delete photos[id];
      return { messages, photos };
    },
    persistPage: async (_page, _state, nextCursor) => {
      committed.push(nextCursor);
      durableCursor = nextCursor;
    },
    yieldEveryPages: 2
  });

  assert.equal(result.hasMore, false);
  assert.equal(result.syncCursor, "1000");
  assert.equal(result.state.messages["message-updated-after-page-four"].body, "after");
  assert.equal(result.state.messages["message-deleted-after-page-four"], undefined);
  assert.equal(result.state.photos["photo-deleted-after-page-four"], undefined);
  assert.deepEqual(committed, ["200", "400", "600", "800", "1000"]);
  assert.equal(durableCursor, "1000");
});

test("interrupted cursor sync resumes from the last committed page without skipping changes", async () => {
  const { runCursorSync } = loadStandaloneTs("mobile/src/services/memorySyncRunner.ts");
  const pages = new Map(
    [0, 200, 400, 600, 800].map((cursor, index) => [
      String(cursor),
      {
        hasMore: index < 4,
        mutations: [`page-${index + 1}`],
        syncCursor: String(cursor + 200)
      }
    ])
  );
  let durableCursor = "0";
  const durableMutations = [];

  await assert.rejects(
    runCursorSync({
      fetchPage: async (cursor) => pages.get(cursor),
      initialCursor: durableCursor,
      initialState: [],
      isActive: () => true,
      maxPages: 500,
      mergePage: (state, page) => [...state, ...page.mutations],
      persistPage: async (page, _state, nextCursor) => {
        if (nextCursor === "1000") throw new Error("simulated_sqlite_failure");
        durableMutations.push(...page.mutations);
        durableCursor = nextCursor;
      },
      yieldEveryPages: 8
    }),
    /simulated_sqlite_failure/
  );

  assert.equal(durableCursor, "800");
  assert.deepEqual(durableMutations, ["page-1", "page-2", "page-3", "page-4"]);

  const resumed = await runCursorSync({
    fetchPage: async (cursor) => pages.get(cursor),
    initialCursor: durableCursor,
    initialState: [...durableMutations],
    isActive: () => true,
    maxPages: 500,
    mergePage: (state, page) => [...state, ...page.mutations],
    persistPage: async (page, _state, nextCursor) => {
      durableMutations.push(...page.mutations);
      durableCursor = nextCursor;
    },
    yieldEveryPages: 8
  });

  assert.equal(resumed.syncCursor, "1000");
  assert.equal(durableCursor, "1000");
  assert.deepEqual(durableMutations, ["page-1", "page-2", "page-3", "page-4", "page-5"]);
});

test("cursor sync rejects cancellation, missing cursors, and a non-advancing server cursor", async () => {
  const { runCursorSync } = loadStandaloneTs("mobile/src/services/memorySyncRunner.ts");
  const base = {
    initialCursor: "10",
    initialState: [],
    maxPages: 10,
    mergePage: (state) => state,
    persistPage: async () => {},
    yieldEveryPages: 2
  };

  await assert.rejects(
    runCursorSync({
      ...base,
      fetchPage: async () => ({ hasMore: false }),
      isActive: () => true
    }),
    /memory_sync_cursor_missing/
  );
  await assert.rejects(
    runCursorSync({
      ...base,
      fetchPage: async () => ({ hasMore: true, syncCursor: "10" }),
      isActive: () => true
    }),
    /memory_sync_cursor_did_not_advance/
  );
  await assert.rejects(
    runCursorSync({
      ...base,
      fetchPage: async () => ({ hasMore: false, syncCursor: "11" }),
      isActive: () => false
    }),
    /memory_sync_cancelled/
  );
});

test("the execution safeguard pauses at a committed cursor and can resume the remaining backlog", async () => {
  const { runCursorSync } = loadStandaloneTs("mobile/src/services/memorySyncRunner.ts");
  const pages = new Map([
    ["0", { hasMore: true, syncCursor: "1", value: 1 }],
    ["1", { hasMore: true, syncCursor: "2", value: 2 }],
    ["2", { hasMore: false, syncCursor: "3", value: 3 }]
  ]);
  const committed = [];
  const firstChunk = await runCursorSync({
    fetchPage: async (cursor) => pages.get(cursor),
    initialCursor: "0",
    initialState: [],
    isActive: () => true,
    maxPages: 2,
    mergePage: (state, page) => [...state, page.value],
    persistPage: async (_page, _state, cursor) => committed.push(cursor),
    yieldEveryPages: 2
  });
  assert.equal(firstChunk.hasMore, true);
  assert.equal(firstChunk.syncCursor, "2");

  const resumed = await runCursorSync({
    fetchPage: async (cursor) => pages.get(cursor),
    initialCursor: firstChunk.syncCursor,
    initialState: firstChunk.state,
    isActive: () => true,
    maxPages: 2,
    mergePage: (state, page) => [...state, page.value],
    persistPage: async (_page, _state, cursor) => committed.push(cursor),
    yieldEveryPages: 2
  });
  assert.equal(resumed.hasMore, false);
  assert.equal(resumed.syncCursor, "3");
  assert.deepEqual(resumed.state, [1, 2, 3]);
  assert.deepEqual(committed, ["1", "2", "3"]);
});

test("Table Memory SQLite is durable, owner-scoped, safely migrated, and never age-pruned", () => {
  const files = source("mobile/src/services/accountFileStore.ts");
  const offline = source("mobile/src/services/memoryOfflineStore.ts");

  assert.match(files, /PRIVATE_DATA_ROOT = `\$\{FileSystem\.documentDirectory/);
  assert.match(files, /ownerDataDirectory[\s\S]*PRIVATE_DATA_ROOT/);
  assert.match(files, /memoryDatabaseDirectoryForScope[\s\S]*ownerDataDirectory\(scope\)/);
  assert.match(files, /clearMemoryDatabaseDirectory/);
  assert.doesNotMatch(offline, /OFFLINE_CACHE_MAX_AGE_MS|pruneOffline|prune.*updated_at/i);
  assert.doesNotMatch(offline, /delete from memory_[a-z_]+ where updated_at\s*[<=>]/i);

  const migration = offline.slice(
    offline.indexOf("async function migrateLegacyCacheDatabase"),
    offline.indexOf("export async function setMemoryOfflineOwnerScope")
  );
  const checkpoint = migration.indexOf("checkpointLegacyDatabase");
  const copy = migration.indexOf("FileSystem.copyAsync");
  const verifyTemporary = migration.indexOf("verifyDatabaseFile(durableDirectory, MIGRATION_DB_NAME");
  const move = migration.indexOf("FileSystem.moveAsync");
  const verifyDurable = migration.lastIndexOf("verifyDatabaseFile(durableDirectory, DB_NAME");
  const removeLegacy = migration.lastIndexOf("removeLegacyDatabaseFiles");
  assert.ok(checkpoint < copy);
  assert.ok(copy < verifyTemporary);
  assert.ok(verifyTemporary < move);
  assert.ok(move < verifyDurable);
  assert.ok(verifyDurable < removeLegacy);
  assert.match(offline, /pragma quick_check\(1\)/);
  assert.match(migration, /if \(!legacyExists\) throw new Error\("memory_database_migration_failed"\)/);
  assert.match(migration, /if \(promoted\) await removeDatabaseFiles\(durableDirectory\)\.catch/);
});

test("an interrupted cache-to-durable SQLite migration preserves the source and retries losslessly", async () => {
  const ownership = loadStandaloneTs("mobile/src/security/cacheOwnership.ts");
  const owner = ownership.cacheOwnerForUserId("11111111-1111-4111-8111-111111111111");
  const databaseName = `circlebites-memory-offline-v${ownership.LOCAL_DATA_SCHEMA_VERSION}.db`;
  const legacyDirectory = `file:///cache/private/${owner.scope}`;
  const durableDirectory = `file:///documents/private/${owner.scope}/table-memory`;
  const legacyPath = `${legacyDirectory}/${databaseName}`;
  const durablePath = `${durableDirectory}/${databaseName}`;
  const temporaryPath = `${durablePath}.migrating`;
  const files = new Set([legacyPath, `${legacyPath}-wal`, `${legacyPath}-shm`]);
  const databases = new Map([[
    legacyPath,
    {
      meta: { owner_scope: owner.scope, schema_version: ownership.LOCAL_DATA_SCHEMA_VERSION },
      summaries: new Map([["room-before-migration", JSON.stringify({
        id: "room-before-migration",
        latestActivityAt: "2026-01-01T00:00:00.000Z"
      })]])
    }
  ]]);
  const telemetry = [];
  let failTemporaryVerificationOnce = true;

  function cloneDatabase(state) {
    return {
      meta: state.meta ? { ...state.meta } : null,
      summaries: new Map(state.summaries)
    };
  }

  const fileSystem = {
    copyAsync: async ({ from, to }) => {
      files.add(to);
      databases.set(to, cloneDatabase(databases.get(from)));
    },
    deleteAsync: async (path) => {
      files.delete(path);
      databases.delete(path);
    },
    documentDirectory: "file:///documents/",
    getInfoAsync: async (path) => ({ exists: files.has(path) }),
    moveAsync: async ({ from, to }) => {
      files.add(to);
      databases.set(to, cloneDatabase(databases.get(from)));
      files.delete(from);
      databases.delete(from);
    }
  };
  const sqlite = {
    deleteDatabaseAsync: async (name, directory) => {
      const path = `${directory}/${name}`;
      files.delete(path);
      databases.delete(path);
    },
    openDatabaseAsync: async (name, _options, directory) => {
      const path = `${directory}/${name}`;
      if (!databases.has(path)) {
        databases.set(path, { meta: null, summaries: new Map() });
        files.add(path);
      }
      const state = databases.get(path);
      return {
        closeAsync: async () => {},
        execAsync: async () => {},
        getAllAsync: async (sql) => (
          sql.includes("from memory_room_summaries")
            ? Array.from(state.summaries.values(), (payload) => ({ payload }))
            : []
        ),
        getFirstAsync: async (sql) => {
          if (sql.includes("pragma quick_check")) {
            if (path === temporaryPath && failTemporaryVerificationOnce) {
              failTemporaryVerificationOnce = false;
              return { quick_check: "corrupt" };
            }
            return { quick_check: "ok" };
          }
          if (sql.includes("sqlite_master")) return { name: "local_cache_meta" };
          if (sql.includes("local_cache_meta")) return state.meta;
          return null;
        },
        runAsync: async (sql, ...args) => {
          if (sql.includes("insert into local_cache_meta")) {
            state.meta = { owner_scope: args[0], schema_version: args[1] };
          } else if (sql.includes("insert into memory_room_summaries")) {
            state.summaries.set(args[0], args[2]);
          }
          return {};
        },
        withTransactionAsync: async (operation) => operation()
      };
    }
  };

  const store = loadTs("mobile/src/services/memoryOfflineStore.ts", (id) => {
    if (id === "expo-file-system/legacy") return fileSystem;
    if (id === "expo-sqlite") return sqlite;
    if (id === "@/security/cacheOwnership") return ownership;
    if (id === "@/services/accountFileStore") return {
      accountFileDirectoryForScope: () => legacyDirectory,
      clearMemoryDatabaseDirectory: async () => {},
      ensureMemoryDatabaseDirectory: async () => durableDirectory,
      memoryDatabaseDirectoryForScope: () => durableDirectory
    };
    if (id === "@/observability/mobileTelemetry") return {
      captureMobileError: (event) => telemetry.push(event),
      recordMobileFlow: () => {}
    };
    if (id === "@/security/offlineMemorySecurity") return {
      sanitizeOfflineMemoryMessage: (value) => value,
      sanitizeOfflineMemoryPhoto: (value) => value,
      sanitizeOfflineMemoryRoom: (value) => value
    };
    throw new Error(`Unexpected import: ${id}`);
  });

  await assert.rejects(store.setMemoryOfflineOwnerScope(owner.scope), /memory_database_migration_failed/);
  assert.equal(files.has(legacyPath), true);
  assert.equal(files.has(durablePath), false);
  assert.equal(telemetry.includes("memory.sqlite_migration_failed"), true);

  await store.setMemoryOfflineOwnerScope(owner.scope);
  assert.equal(files.has(legacyPath), false);
  assert.equal(files.has(durablePath), true);
  assert.equal((await store.readOfflineMemorySummaries())[0].id, "room-before-migration");
});

test("sync pages apply mutations and cursor atomically, with observable typed failures", () => {
  const offline = source("mobile/src/services/memoryOfflineStore.ts");
  const services = source("mobile/src/services/memories.ts");
  const delta = offline.slice(
    offline.indexOf("export async function applyOfflineMemoryChatDelta"),
    offline.indexOf("export async function saveOfflineMemoryOutboxMessage")
  );

  assert.match(delta, /withTransactionAsync/);
  assert.match(delta, /deletedMessageIds/);
  assert.match(delta, /deletedPhotoIds/);
  assert.match(delta, /memory_room_sync_state/);
  assert.match(delta, /input\.syncCursor/);
  assert.match(offline, /class MemoryOfflinePersistenceError extends Error/);
  assert.match(offline, /captureMobileError\(\s*"memory\.sqlite_write_failed"/);
  assert.match(services, /if \(isOfflineMemoryPersistenceError\(error\)\) throw error;/);
});

test("authoritative access loss removes every local room table in one transaction", () => {
  const offline = source("mobile/src/services/memoryOfflineStore.ts");
  const services = source("mobile/src/services/memories.ts");
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const deletion = offline.slice(
    offline.indexOf("export async function deleteOfflineMemoryRoom"),
    offline.indexOf("export async function saveOfflineMemoryReadState")
  );

  assert.match(deletion, /withTransactionAsync/);
  for (const table of [
    "memory_photos",
    "memory_messages",
    "memory_message_outbox",
    "memory_room_sync_state",
    "memory_room_snapshots",
    "memory_room_summaries"
  ]) {
    assert.match(deletion, new RegExp(`delete from ${table} where room_id`));
  }
  assert.match(services, /error\.status === 403 \|\| error\.status === 404/);
  assert.match(services, /isAuthoritativeMemoryAccessError\(error\)[\s\S]*deleteOfflineMemoryRoom\(roomId\)/);
  assert.match(hooks, /removeAuthoritativeMemoryRoomProjection/);
});

test("realtime resubscription reconciles cursors and all joined summaries are discoverable", () => {
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const bootstrap = source("mobile/src/providers/MemoryRoomSyncBootstrap.tsx");
  const services = source("mobile/src/services/memories.ts");

  assert.equal((hooks.match(/status === "SUBSCRIBED"/g) ?? []).length, 2);
  assert.equal((hooks.match(/scheduleRealtimeCursorReconciliation\(queryClient/g) ?? []).length >= 3, true);
  assert.match(hooks, /syncLoadedMemoryRoomCaches\(queryClient, \{ force: true \}\)/);
  assert.match(hooks, /restoreJoinedMemoryRoomSummaries[\s\S]*while \(cursor/);
  assert.match(hooks, /memory_summary_cursor_repeated/);
  assert.match(bootstrap, /restoreJoinedMemoryRoomSummaries\(queryClient\)/);
  assert.match(services, /const page = await listMemoryRoomsPage\(cursor\);[\s\S]*await saveOfflineMemorySummaries\(page\.rooms\)/);
  assert.doesNotMatch(services, /if \(!cursor\)[^{]*\{[^}]*saveOfflineMemorySummaries/);
  assert.match(services, /nextCursor: null,[\s\S]*rooms: cached/);
});

test("private media rows persist metadata only and renew signed URLs by stable media ID", () => {
  const readRoute = source("app/api/mobile/memories/read/route.ts");
  const finalizeRoute = source("app/api/mobile/memories/finalize-upload/route.ts");
  const mapper = source("mobile/src/services/memoryMapper.ts");
  const offline = source("mobile/src/services/memoryOfflineStore.ts");
  const services = source("mobile/src/services/memories.ts");
  const renewal = readRoute.slice(
    readRoute.indexOf('if (action === "renewMedia")'),
    readRoute.indexOf('if (action === "detail")')
  );

  assert.match(readRoute, /delete safePhoto\.storage_path/);
  assert.match(finalizeRoute, /delete safePhoto\.storage_path/);
  assert.match(finalizeRoute, /signed_url_expires_at: signedUrlExpiresAt/);
  assert.match(renewal, /\.from\("shared_memory_photos"\)/);
  assert.match(renewal, /\.eq\("id", mediaId\)/);
  assert.match(renewal, /\.eq\("room_id", roomId\)/);
  assert.doesNotMatch(renewal, /\.select\("[^"]*storage_path/);
  assert.ok(renewal.indexOf(".maybeSingle()") < renewal.lastIndexOf("signPhotoPayload"));
  assert.match(mapper, /publicUrl: photo\.public_url \|\| ""/);
  assert.doesNotMatch(mapper, /publicUrl:[^\n]*storage_path/);
  assert.match(services, /read\?action=renewMedia&roomId=.*&mediaId=/);
  assert.match(services, /saveOfflineMemoryPhoto\(roomId, renewed\)/);
  assert.match(services, /refreshMemoryMessagePageMedia[\s\S]*renewMemoryPhotos/);
  assert.match(services, /refreshMemoryMediaPageUrls[\s\S]*renewMemoryPhotos/);
  assert.match(offline, /select payload[\s\S]*from memory_photos[\s\S]*where room_id = \?[\s\S]*order by created_at asc, photo_id asc/);
});

test("read state is durable, transient auth preserves replicas, and reactions remain disabled", () => {
  const offline = source("mobile/src/services/memoryOfflineStore.ts");
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const auth = source("mobile/src/providers/AccountSessionBoundary.tsx");
  const room = source("mobile/app/memories/[id].tsx");

  assert.match(offline, /saveOfflineMemoryReadState[\s\S]*lastReadAt/);
  assert.match(offline, /unreadCount: 0/);
  assert.match(hooks, /saveOfflineMemoryReadState\(roomId, context\.readAt\)/);
  assert.match(auth, /authoritativeFailure/);
  assert.match(auth, /replica_retained: true/);
  assert.match(auth, /setTimeout\(\(\) => \{[\s\S]*recoverExpiredSession\(ownerHost, "timer"\)/);
  assert.match(room, /const MEMORY_REACTIONS_ENABLED = false/);
  assert.match(room, /reactions=\{MEMORY_REACTIONS_ENABLED \?/);
  assert.match(room, /isEnabled: MEMORY_REACTIONS_ENABLED/);
});
