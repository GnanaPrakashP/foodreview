import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function loadTs(relativePath, requireModule = () => { throw new Error("Unexpected import"); }) {
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
    require: requireModule
  });
  return mod.exports;
}

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const BOB_ID = "22222222-2222-4222-8222-222222222222";

test("canonical Supabase user IDs create collision-free owners and revoke stale generations", () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts");
  const alice = ownership.cacheOwnerForUserId(ALICE_ID.toUpperCase());
  const bob = ownership.cacheOwnerForUserId(BOB_ID);
  assert.equal(alice.userId, ALICE_ID);
  assert.notEqual(alice.scope, bob.scope);
  assert.equal(alice.scope.length, 32);
  const aliceGeneration = ownership.setActiveCacheOwner(alice);
  assert.equal(ownership.isCacheGenerationActive(aliceGeneration), true);
  ownership.setActiveCacheOwner(bob);
  assert.equal(ownership.isCacheGenerationActive(aliceGeneration), false);
  assert.throws(() => ownership.cacheOwnerForUserId("alice@example.com"), /invalid_cache_owner/);
});

test("every native owner-scoped SecureStore key uses supported characters", () => {
  const locationStorage = source("mobile/src/services/userLocation.ts");
  const occasionStorage = source("mobile/src/features/occasions/occasionStorage.ts");
  for (const storageSource of [locationStorage, occasionStorage]) {
    assert.match(storageSource, /SECURE_STORE_KEY_PATTERN = \/\^\[A-Za-z0-9\._-\]\+\$\//);
  }
  assert.match(locationStorage, /`\$\{key\}\.v\$\{ACCOUNT_LOCATION_KEY_VERSION\}\.\$\{ownerScope\}`/);
  assert.match(occasionStorage, /`\$\{STORAGE_PREFIX\}\.v\$\{STORAGE_VERSION\}\.\$\{ownerScope\}`/);
  assert.match(occasionStorage, /Platform\.OS === "web"[\s\S]*legacyWebStorageKeyForScope/);
});

test("persisted Query caches restore only the matching owner envelope", async () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts");
  const stores = new Map();
  const restored = [];
  const mmkv = (id) => {
    if (!stores.has(id)) stores.set(id, new Map());
    const values = stores.get(id);
    return {
      contains: (key) => values.has(key),
      getString: (key) => values.get(key),
      remove: (key) => values.delete(key),
      set: (key, value) => values.set(key, value)
    };
  };
  const persistence = loadTs("mobile/src/providers/queryPersistence.ts", (id) => {
    if (id === "react-native-mmkv") return { createMMKV: ({ id: storageId }) => mmkv(storageId) };
    if (id === "@/security/cacheOwnership") return ownership;
    if (id === "@/security/localMMKV") return { createLocalMMKV: (storageId) => mmkv(storageId) };
    if (id === "@tanstack/react-query-persist-client") return {
      persistQueryClientRestore: async ({ persister, queryClient }) => {
        const value = await persister.restoreClient();
        restored.push({ name: queryClient.name, value });
      },
      persistQueryClientSubscribe: ({ persister, queryClient }) => {
        void persister.persistClient(queryClient.persisted);
        return () => {};
      }
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  const alice = ownership.cacheOwnerForUserId(ALICE_ID);
  const bob = ownership.cacheOwnerForUserId(BOB_ID);
  const aliceClient = { name: "alice", persisted: { buster: "v2", clientState: { aliceSecret: true }, timestamp: 1 } };
  await persistence.activateOwnerQueryPersistence(aliceClient, alice.scope);
  persistence.stopOwnerQueryPersistence();
  const bobClient = { name: "bob", persisted: { buster: "v2", clientState: { bobSecret: true }, timestamp: 2 } };
  await persistence.activateOwnerQueryPersistence(bobClient, bob.scope);
  assert.equal(restored.find((entry) => entry.name === "bob").value, undefined);
  assert.equal(stores.size, 2);

  const bobStore = stores.get(`circlebites.query-cache.v2.${bob.scope}`);
  bobStore.set("circlebites:query-cache:v2", JSON.stringify({
    client: aliceClient.persisted,
    ownerScope: alice.scope,
    schemaVersion: 2
  }));
  persistence.stopOwnerQueryPersistence();
  await persistence.activateOwnerQueryPersistence({ ...bobClient, name: "bob-mismatch" }, bob.scope);
  assert.equal(restored.find((entry) => entry.name === "bob-mismatch").value, undefined);
  const repaired = JSON.parse(bobStore.get("circlebites:query-cache:v2"));
  assert.equal(repaired.ownerScope, bob.scope);
});

test("crash-interrupted cleanup remains fail-closed and completes before Bob activates", async () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts");
  const securityValues = new Map();
  const calls = [];
  let failAliceFilesOnce = true;
  const stateStore = { getState: () => ({
    closeCommentsSheet: () => calls.push("comments.reset"),
    reset: () => calls.push("composer.reset"),
    resetForAccountTransition: () => calls.push("location.reset")
  }) };
  const coordinator = loadTs("mobile/src/services/localDataIsolation.ts", (id) => {
    if (id === "react-native-mmkv") return { createMMKV: () => ({
      getString: (key) => securityValues.get(key),
      remove: (key) => securityValues.delete(key),
      set: (key, value) => securityValues.set(key, value)
    }) };
    if (id === "@/security/localMMKV") return { createLocalMMKV: () => ({
      getString: (key) => securityValues.get(key),
      remove: (key) => securityValues.delete(key),
      set: (key, value) => securityValues.set(key, value)
    }) };
    if (id === "@/api/supabase") return {
      clearSupabaseLocalSessionStorage: async () => calls.push("auth.storage.clear"),
      supabase: { removeAllChannels: async () => [] }
    };
    if (id === "react-native") return { Platform: { OS: "test" } };
    if (id === "expo-image") return { Image: {
      clearDiskCache: async () => calls.push("image.disk.clear"),
      clearMemoryCache: async () => calls.push("image.memory.clear")
    } };
    if (id === "@/security/cacheOwnership") return ownership;
    if (id === "@/security/sensitiveResourceRegistry") return { clearRegisteredSensitiveResources: async () => 0 };
    if (id === "@/security/mediaCacheCleanup") return {
      clearImageCachesWithRetry: async (memory, disk) => {
        await memory();
        await disk();
        return { attempts: 1, diskCleared: true, memoryCleared: true };
      }
    };
    if (id === "@/services/homeMediaPrefetch") return {
      cancelHomeMediaPrefetches: async (scope) => calls.push(`prefetch.cancel:${scope}`)
    };
    if (id === "@/services/mediaUploadRecovery") return { clearMediaUploadRecoveryForScope: (scope) => calls.push(`uploads.clear:${scope}`) };
    if (id === "@/providers/queryPersistence") return {
      activateOwnerQueryPersistence: async (_client, scope) => calls.push(`query.activate:${scope}`),
      clearLegacyGlobalQueryCache: async () => calls.push("legacy.query.clear"),
      clearOwnerPersistedQueryCache: async (scope) => calls.push(`query.clear:${scope}`),
      legacyQueryCachePresent: () => false,
      ownerQueryCachePresent: () => false,
      stopOwnerQueryPersistence: () => calls.push("query.stop")
    };
    if (id === "@/services/memoryOfflineStore") return {
      clearLegacyGlobalMemoryDatabase: async () => calls.push("legacy.db.clear"),
      clearMemoryOfflineOwnerScope: async (scope) => calls.push(`db.clear:${scope}`),
      legacyGlobalMemoryDatabasePresent: async () => false,
      memoryOfflineDiagnostics: async () => ({ namespaceCount: 0, signedUrlRecordCount: 0 }),
      setMemoryOfflineOwnerScope: async (scope) => calls.push(`db.owner:${scope ?? "none"}`)
    };
    if (id === "@/services/accountFileStore") return {
      accountFileCount: async () => 0,
      clearAccountFiles: async (scope) => {
        calls.push(`files.clear:${scope}`);
        if (failAliceFilesOnce) {
          failAliceFilesOnce = false;
          throw new Error("simulated_crash");
        }
      },
      setAccountFileOwnerScope: (scope) => calls.push(`files.owner:${scope ?? "none"}`)
    };
    if (id === "@/services/userLocation") return {
      clearLegacyUnownedUserLocation: async () => calls.push("legacy.location.clear"),
      clearSavedUserLocationForScope: async (scope) => calls.push(`location.clear:${scope}`),
      setUserLocationOwnerScope: (scope) => calls.push(`location.owner:${scope ?? "none"}`)
    };
    if (id === "@/services/accountProfileCache") return { clearAccountProfileCache: async (scope) => calls.push(`profile.clear:${scope}`) };
    if (id === "@/observability/mobileTelemetry") return {
      captureMobileError: () => {},
      clearMobileTelemetryIdentity: () => {},
      recordMobileFlow: () => {}
    };
    if (id === "@/features/occasions/occasionStorage") return { clearOccasionCorrectionsForScope: async (scope) => calls.push(`occasion.clear:${scope}`) };
    if (id === "@/services/memoryCaptureSession") return { clearMemoryCaptureSession: () => calls.push("memory.capture.clear") };
    if (id === "@/services/postCaptureSession") return { clearPostCaptureSession: () => calls.push("post.capture.clear") };
    if (id === "@/services/postDraftStore") return { clearPostDraftForScope: (scope) => calls.push(`post.draft.clear:${scope}`) };
    if (["@/stores/commentsSheetStore", "@/stores/composerStore", "@/stores/userLocationStore"].includes(id)) {
      const exportName = id.includes("comments") ? "useCommentsSheetStore" : id.includes("composer") ? "useComposerStore" : "useUserLocationStore";
      return { [exportName]: stateStore };
    }
    throw new Error(`Unexpected import: ${id}`);
  });
  const client = (name) => ({
    cancelQueries: async () => calls.push(`query.cancel:${name}`),
    clear: () => calls.push(`query.memory.clear:${name}`)
  });
  const aliceClient = client("alice");
  const bobClient = client("bob");
  const alice = await coordinator.prepareLocalDataForOwner(ALICE_ID, aliceClient);
  await assert.rejects(
    coordinator.cleanupLocalDataForOwner(alice.owner.scope, "account_switch", aliceClient),
    /local_cleanup_incomplete/
  );
  const interrupted = await coordinator.localDataDiagnostics();
  assert.equal(interrupted.cleanupStatus, "clearing_files");
  assert.equal(interrupted.activeCacheOwnerPresent, false);

  const bob = await coordinator.prepareLocalDataForOwner(BOB_ID, bobClient, aliceClient);
  assert.equal(ownership.getActiveCacheOwner().scope, bob.owner.scope);
  const lastAliceFileClear = calls.lastIndexOf(`files.clear:${alice.owner.scope}`);
  const bobActivation = calls.indexOf(`query.activate:${bob.owner.scope}`);
  assert.ok(lastAliceFileClear >= 0 && lastAliceFileClear < bobActivation);
  for (const cleanupCall of [
    "memory.capture.clear",
    "post.capture.clear",
    `post.draft.clear:${alice.owner.scope}`,
    "comments.reset",
    "composer.reset",
    "location.reset"
  ]) {
    assert.ok(calls.indexOf(cleanupCall) >= 0 && calls.indexOf(cleanupCall) < bobActivation);
  }
  assert.equal((await coordinator.localDataDiagnostics()).cleanupStatus, "idle");

  securityValues.set("cleanup-journal", "{corrupt");
  assert.equal(await coordinator.resumeIncompleteLocalCleanup(bobClient), "owner_mismatch");
  assert.equal(ownership.getActiveCacheOwner(), null);
  assert.ok(calls.includes("auth.storage.clear"));
  assert.equal((await coordinator.localDataDiagnostics()).cleanupStatus, "idle");
});

test("owned files are moved out of the unowned cache and Alice cleanup cannot delete Bob", async () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts");
  const files = new Map([
    ["file:///cache/alice-raw.jpg", "alice"],
    ["file:///cache/bob-raw.jpg", "bob"]
  ]);
  const fs = {
    cacheDirectory: "file:///cache/",
    documentDirectory: "file:///documents/",
    copyAsync: async ({ from, to }) => files.set(to, files.get(from)),
    deleteAsync: async (path) => {
      for (const key of Array.from(files.keys())) if (key === path || key.startsWith(`${path}/`)) files.delete(key);
    },
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async (path) => Array.from(files.keys()).filter((key) => key.startsWith(`${path}/`))
  };
  const fileStore = loadTs("mobile/src/services/accountFileStore.ts", (id) => {
    if (id === "expo-file-system/legacy") return fs;
    if (id === "@/security/cacheOwnership") return ownership;
    throw new Error(`Unexpected import: ${id}`);
  });
  const alice = ownership.cacheOwnerForUserId(ALICE_ID);
  const bob = ownership.cacheOwnerForUserId(BOB_ID);
  ownership.setActiveCacheOwner(alice);
  fileStore.setAccountFileOwnerScope(alice.scope);
  const alicePath = await fileStore.stageAccountFile("file:///cache/alice-raw.jpg", "picker");
  assert.match(alicePath, new RegExp(alice.scope));
  assert.equal(files.has("file:///cache/alice-raw.jpg"), false);

  ownership.setActiveCacheOwner(bob);
  fileStore.setAccountFileOwnerScope(bob.scope);
  const bobPath = await fileStore.stageAccountFile("file:///cache/bob-raw.jpg", "picker");
  await fileStore.clearAccountFiles(alice.scope);
  assert.equal(files.has(alicePath), false);
  assert.equal(files.get(bobPath), "bob");
});

test("Memory SQLite opens separate owner directories and never queries Alice rows for Bob", async () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts");
  const reconciliation = await import("../mobile/src/services/memoryMessageReconciliation.mjs");
  const databases = new Map();
  function database(directory) {
    if (!databases.has(directory)) databases.set(directory, { meta: null, summaries: new Map() });
    const state = databases.get(directory);
    return {
      closeAsync: async () => {},
      execAsync: async () => {},
      getAllAsync: async (sql) => {
        if (sql.includes("from memory_room_summaries")) {
          return Array.from(state.summaries.values(), (payload) => ({ payload }));
        }
        return [];
      },
      getFirstAsync: async (sql) => sql.includes("local_cache_meta") ? state.meta : null,
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
  const sqlite = {
    deleteDatabaseAsync: async (_name, directory = "legacy") => databases.delete(directory),
    openDatabaseAsync: async (_name, _options, directory) => database(directory)
  };
  const store = loadTs("mobile/src/services/memoryOfflineStore.ts", (id) => {
    if (id === "expo-sqlite") return sqlite;
    if (id === "expo-file-system/legacy") return {
      documentDirectory: "file:///documents/",
      deleteAsync: async () => {},
      getInfoAsync: async () => ({ exists: false })
    };
    if (id === "@/services/accountFileStore") return {
      accountFileDirectoryForScope: (scope) => `file:///cache/private/${scope}`,
      clearMemoryDatabaseDirectory: async () => {},
      ensureMemoryDatabaseDirectory: async (scope) => `file:///documents/private/${scope}/table-memory`,
      memoryDatabaseDirectoryForScope: (scope) => `file:///documents/private/${scope}/table-memory`
    };
    if (id === "@/security/cacheOwnership") return ownership;
    if (id === "@/services/memoryMessageReconciliation.mjs") return reconciliation;
    if (id === "@/security/offlineMemorySecurity") return {
      sanitizeOfflineMemoryMessage: (value) => value,
      sanitizeOfflineMemoryPhoto: (value) => value,
      sanitizeOfflineMemoryRoom: (value) => value
    };
    if (id === "@/services/memories" || id === "@/types/models") return {};
    if (id === "@/services/memoryPageCursor") return {
      encodeMemoryPageCursor: (createdAt, cursorId) => (
        createdAt && cursorId ? `${createdAt}|${cursorId}` : null
      ),
      memoryPageCursorFromMessage: (message) => (
        message?.serverCreatedAt && message?.serverId
          ? `${message.serverCreatedAt}|${message.serverId}`
          : null
      ),
      parseMemoryPageCursor: (cursor) => {
        if (!cursor) return null;
        const at = cursor.lastIndexOf("|");
        if (at <= 0) return { createdAt: cursor, id: null };
        return { createdAt: cursor.slice(0, at), id: cursor.slice(at + 1) || null };
      }
    };
    if (id === "@/observability/mobileTelemetry") return {
      captureMobileError: () => {},
      recordMobileFlow: () => {}
    };
    if (id === "@/performance/memoryRoomReleaseProfile") return {
      beginMemoryRoomSqliteOperation: () => () => {}
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  const alice = ownership.cacheOwnerForUserId(ALICE_ID);
  const bob = ownership.cacheOwnerForUserId(BOB_ID);
  await store.setMemoryOfflineOwnerScope(alice.scope);
  await store.saveOfflineMemorySummaries([{ id: "alice-room", latestActivityAt: "2026-01-01T00:00:00Z" }]);
  assert.equal((await store.readOfflineMemorySummaries())[0].id, "alice-room");

  await store.setMemoryOfflineOwnerScope(bob.scope);
  assert.equal(await store.readOfflineMemorySummaries(), null);
  await store.saveOfflineMemorySummaries([{ id: "bob-room", latestActivityAt: "2026-01-02T00:00:00Z" }]);
  await store.clearMemoryOfflineOwnerScope(alice.scope);
  assert.equal((await store.readOfflineMemorySummaries())[0].id, "bob-room");
  assert.equal(databases.has(`file:///documents/private/${alice.scope}/table-memory`), false);
});

test("offline private signed URLs expire closed while public legacy media remains readable", () => {
  const policy = loadTs("mobile/src/security/offlineMemorySecurity.ts", (id) => {
    if (id === "@/types/models") return {};
    throw new Error(`Unexpected import: ${id}`);
  });
  const base = {
    id: "photo-1",
    publicUrl: "https://signed.example/alice-secret",
    signedUrlExpiresAt: "2026-01-01T00:00:00.000Z",
    storagePath: "memories/room-1/photo.jpg"
  };
  const expired = policy.sanitizeOfflineMemoryPhoto(base, Date.parse("2026-01-02T00:00:00.000Z"));
  assert.equal(expired.publicUrl, "");
  assert.equal(expired.signedUrlExpiresAt, null);
  const fresh = policy.sanitizeOfflineMemoryPhoto({ ...base, signedUrlExpiresAt: "2026-01-03T00:00:00.000Z" }, Date.parse("2026-01-02T00:00:00.000Z"));
  assert.equal(fresh.publicUrl, base.publicUrl);
  const publicMedia = policy.sanitizeOfflineMemoryPhoto({
    ...base,
    signedUrlExpiresAt: null,
    storagePath: "legacy/public.jpg"
  }, Date.parse("2027-01-01T00:00:00.000Z"));
  assert.equal(publicMedia.publicUrl, base.publicUrl);
});

test("native backup rules exclude SecureStore, MMKV, and offline databases", () => {
  const legacy = source("mobile/android/app/src/main/res/xml/secure_store_backup_rules.xml");
  const modern = source("mobile/android/app/src/main/res/xml/secure_store_data_extraction_rules.xml");
  for (const xml of [legacy, modern]) {
    assert.match(xml, /domain="sharedpref" path="SecureStore"/);
    assert.match(xml, /domain="file" path="mmkv\/"/);
    assert.match(xml, /domain="database" path="\."/);
  }
  assert.match(modern, /<cloud-backup>/);
  assert.match(modern, /<device-transfer>/);

  let mmkvConfig = null;
  const localMMKV = loadTs("mobile/src/security/localMMKV.ts", (id) => {
    if (id === "expo-file-system/legacy") return { cacheDirectory: "file:///var/mobile/cache/" };
    if (id === "react-native") return { Platform: { OS: "ios" } };
    if (id === "react-native-mmkv") return { createMMKV: (config) => { mmkvConfig = config; return {}; } };
    throw new Error(`Unexpected import: ${id}`);
  });
  localMMKV.createLocalMMKV("security-test");
  assert.equal(mmkvConfig.id, "security-test");
  assert.equal(mmkvConfig.path, "/var/mobile/cache/circlebites-mmkv-v2");
});

test("session boundary, realtime, notifications, deletion, and offline logout share the isolation path", () => {
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  const authGate = source("mobile/src/providers/AuthGate.tsx");
  const realtime = source("mobile/src/hooks/useMemories.ts");
  const notifications = source("mobile/src/providers/PushNotificationBootstrap.tsx");
  const settings = source("mobile/src/hooks/useSettings.ts");
  const auth = source("mobile/src/services/auth.ts");
  const statusRoute = source("app/api/mobile/auth/account-status/route.ts");
  assert.match(boundary, /prepareLocalDataForOwner/);
  assert.match(boundary, /authoritative_owner_mismatch/);
  assert.doesNotMatch(boundary, /useRouter|router\.replace/);
  assert.match(authGate, /Stack\.Protected/);
  assert.match(realtime, /isCacheGenerationActive\(ownerGeneration\)/);
  assert.match(notifications, /recipientName/);
  assert.match(settings, /cleanupCurrentLocalData\("account_deletion"/);
  assert.match(auth, /Promise\.race/);
  assert.match(auth, /clearSupabaseLocalSessionStorage/);
  assert.match(statusRoute, /getRouteActor\(req\)/);
  assert.match(statusRoute, /actorResolution\.status/);
  assert.doesNotMatch(statusRoute, /supabase\.auth\.getUser/);
  assert.match(statusRoute, /Cache-Control.*private, no-store/);
});
