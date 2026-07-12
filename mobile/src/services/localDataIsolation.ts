import type { QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import { clearSupabaseLocalSessionStorage, supabase } from "@/api/supabase";
import {
  cacheOwnerForUserId,
  getActiveCacheOwner,
  isValidCacheOwnerScope,
  LOCAL_DATA_SCHEMA_VERSION,
  setActiveCacheOwner,
  type CacheOwner
} from "@/security/cacheOwnership";
import { clearRegisteredSensitiveResources } from "@/security/sensitiveResourceRegistry";
import {
  activateOwnerQueryPersistence,
  clearLegacyGlobalQueryCache,
  clearOwnerPersistedQueryCache,
  legacyQueryCachePresent,
  ownerQueryCachePresent,
  stopOwnerQueryPersistence
} from "@/providers/queryPersistence";
import {
  clearLegacyGlobalMemoryDatabase,
  clearMemoryOfflineOwnerScope,
  legacyGlobalMemoryDatabasePresent,
  memoryOfflineDiagnostics,
  setMemoryOfflineOwnerScope
} from "@/services/memoryOfflineStore";
import {
  accountFileCount,
  clearAccountFiles,
  setAccountFileOwnerScope
} from "@/services/accountFileStore";
import {
  clearLegacyUnownedUserLocation,
  clearSavedUserLocationForScope,
  setUserLocationOwnerScope
} from "@/services/userLocation";
import { clearAccountProfileCache } from "@/services/accountProfileCache";
import { clearOccasionCorrectionsForScope } from "@/features/occasions/occasionStorage";
import { clearMemoryCaptureSession } from "@/services/memoryCaptureSession";
import { clearPostCaptureSession } from "@/services/postCaptureSession";
import { useCommentsSheetStore } from "@/stores/commentsSheetStore";
import { useComposerStore } from "@/stores/composerStore";
import { useUserLocationStore } from "@/stores/userLocationStore";
import { createLocalMMKV } from "@/security/localMMKV";

export type LocalCleanupReason =
  | "explicit_logout"
  | "account_switch"
  | "session_invalid"
  | "token_expired"
  | "account_deletion"
  | "account_frozen"
  | "owner_mismatch"
  | "manual_security_reset";

type CleanupStatus =
  | "cleanup_required"
  | "stopping_activity"
  | "clearing_query_cache"
  | "clearing_local_database"
  | "clearing_files"
  | "clearing_account_storage";

type CleanupJournal = {
  attempts: number;
  ownerScope: string;
  reason: LocalCleanupReason;
  schemaVersion: number;
  status: CleanupStatus;
  updatedAt: number;
};

const SECURITY_STORAGE_ID = `circlebites.local-security.v${LOCAL_DATA_SCHEMA_VERSION}`;
const ACTIVE_OWNER_KEY = "active-owner-scope";
const CLEANUP_JOURNAL_KEY = "cleanup-journal";
const LEGACY_MIGRATION_KEY = `legacy-cleanup-v${LOCAL_DATA_SCHEMA_VERSION}`;
const LEGACY_MIGRATION_COUNTS_KEY = `legacy-cleanup-counts-v${LOCAL_DATA_SCHEMA_VERSION}`;
const MAX_CLEANUP_ATTEMPTS = 8;
const memoryFallback = new Map<string, string>();
const cleanupReasons = new Set<LocalCleanupReason>([
  "explicit_logout",
  "account_switch",
  "session_invalid",
  "token_expired",
  "account_deletion",
  "account_frozen",
  "owner_mismatch",
  "manual_security_reset"
]);
const cleanupStatuses = new Set<CleanupStatus>([
  "cleanup_required",
  "stopping_activity",
  "clearing_query_cache",
  "clearing_local_database",
  "clearing_files",
  "clearing_account_storage"
]);

function reasonInvalidatesSession(reason: LocalCleanupReason) {
  return reason !== "account_switch" && reason !== "manual_security_reset";
}

let securityStorage: ReturnType<typeof createLocalMMKV> | null = null;
try {
  securityStorage = createLocalMMKV(SECURITY_STORAGE_ID);
} catch {
  securityStorage = null;
}

function readSecurityValue(key: string) {
  return securityStorage?.getString(key) ?? memoryFallback.get(key) ?? null;
}

function writeSecurityValue(key: string, value: string) {
  if (securityStorage) securityStorage.set(key, value);
  else memoryFallback.set(key, value);
}

function removeSecurityValue(key: string) {
  if (securityStorage) securityStorage.remove(key);
  else memoryFallback.delete(key);
}

function readJournal(): CleanupJournal | null {
  const raw = readSecurityValue(CLEANUP_JOURNAL_KEY);
  if (!raw) return null;
  try {
    const journal = JSON.parse(raw) as Partial<CleanupJournal>;
    if (
      !isValidCacheOwnerScope(journal.ownerScope) ||
      journal.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION ||
      typeof journal.attempts !== "number" ||
      !Number.isInteger(journal.attempts) ||
      journal.attempts < 0 ||
      !cleanupReasons.has(journal.reason as LocalCleanupReason) ||
      !cleanupStatuses.has(journal.status as CleanupStatus)
    ) return null;
    return journal as CleanupJournal;
  } catch {
    return null;
  }
}

function writeJournal(journal: CleanupJournal) {
  writeSecurityValue(CLEANUP_JOURNAL_KEY, JSON.stringify({ ...journal, updatedAt: Date.now() }));
}

function activeOwnerMarker() {
  const value = readSecurityValue(ACTIVE_OWNER_KEY);
  return isValidCacheOwnerScope(value) ? value : null;
}

async function runLegacyCleanupOnce() {
  if (readSecurityValue(LEGACY_MIGRATION_KEY) === "complete") return;
  const [queryCachePresent, memoryDatabasePresent] = await Promise.all([
    Promise.resolve(legacyQueryCachePresent()),
    legacyGlobalMemoryDatabasePresent()
  ]);
  await clearLegacyGlobalQueryCache();
  await clearLegacyGlobalMemoryDatabase();
  await clearLegacyUnownedUserLocation();
  writeSecurityValue(LEGACY_MIGRATION_COUNTS_KEY, JSON.stringify({
    memoryDatabaseNamespacesRemoved: memoryDatabasePresent ? 1 : 0,
    queryCacheNamespacesRemoved: queryCachePresent ? 1 : 0
  }));
  writeSecurityValue(LEGACY_MIGRATION_KEY, "complete");
}

async function cleanupStep(journal: CleanupJournal, status: CleanupStatus, action: () => void | Promise<void>) {
  writeJournal({ ...journal, status });
  await action();
}

async function runCleanupJournal(journal: CleanupJournal, queryClient?: QueryClient | null) {
  if (journal.attempts >= MAX_CLEANUP_ATTEMPTS) throw new Error("local_cleanup_retry_exhausted");
  const next = { ...journal, attempts: journal.attempts + 1 };
  writeJournal(next);
  // Revoke the generation before stopping async work. Any callback already in
  // flight can now prove it belongs to a stale account and must do nothing.
  if (getActiveCacheOwner()?.scope === next.ownerScope) setActiveCacheOwner(null);

  try {
    await cleanupStep(next, "stopping_activity", async () => {
      const channelCleanup = await supabase.removeAllChannels();
      if (channelCleanup.some((result) => result !== "ok")) throw new Error("realtime_cleanup_failed");
      const failedResourceCleanups = await clearRegisteredSensitiveResources();
      if (failedResourceCleanups > 0) throw new Error("sensitive_resource_cleanup_failed");
      clearMemoryCaptureSession();
      clearPostCaptureSession();
      useCommentsSheetStore.getState().closeCommentsSheet();
      useComposerStore.getState().reset();
      useUserLocationStore.getState().resetForAccountTransition();
    });
    await cleanupStep(next, "clearing_query_cache", async () => {
      stopOwnerQueryPersistence();
      await queryClient?.cancelQueries().catch(() => {});
      queryClient?.clear();
      await clearOwnerPersistedQueryCache(next.ownerScope);
    });
    await cleanupStep(next, "clearing_local_database", async () => {
      await setMemoryOfflineOwnerScope(null);
      await clearMemoryOfflineOwnerScope(next.ownerScope);
    });
    await cleanupStep(next, "clearing_files", async () => {
      setAccountFileOwnerScope(null);
      await clearAccountFiles(next.ownerScope);
    });
    await cleanupStep(next, "clearing_account_storage", async () => {
      setUserLocationOwnerScope(null);
      await Promise.all([
        clearSavedUserLocationForScope(next.ownerScope),
        clearAccountProfileCache(next.ownerScope),
        clearOccasionCorrectionsForScope(next.ownerScope)
      ]);
      if (reasonInvalidatesSession(next.reason)) await clearSupabaseLocalSessionStorage();
    });

    if (activeOwnerMarker() === next.ownerScope) removeSecurityValue(ACTIVE_OWNER_KEY);
    if (getActiveCacheOwner()?.scope === next.ownerScope) setActiveCacheOwner(null);
    removeSecurityValue(CLEANUP_JOURNAL_KEY);
  } catch {
    // Preserve the most recently entered step so restart diagnostics identify
    // the interrupted operation and the idempotent replay resumes safely.
    writeJournal(readJournal() ?? next);
    throw new Error("local_cleanup_incomplete");
  }
}

export async function resumeIncompleteLocalCleanup(queryClient?: QueryClient | null) {
  const journal = readJournal();
  if (!journal) {
    if (!readSecurityValue(CLEANUP_JOURNAL_KEY)) return null;
    const markerScope = activeOwnerMarker();
    if (markerScope) {
      const recovery: CleanupJournal = {
        attempts: 0,
        ownerScope: markerScope,
        reason: "owner_mismatch",
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        status: "cleanup_required",
        updatedAt: Date.now()
      };
      writeJournal(recovery);
      await runCleanupJournal(recovery, queryClient);
    } else {
      // The corrupt record has no provable namespace. Invalidate auth locally,
      // discard the unusable journal, and require a fresh sign-in; per-owner
      // stores remain inaccessible to any different account.
      await clearSupabaseLocalSessionStorage();
      removeSecurityValue(CLEANUP_JOURNAL_KEY);
      setActiveCacheOwner(null);
    }
    return "owner_mismatch";
  }
  await runCleanupJournal(journal, queryClient);
  return journal.reason;
}

export async function cleanupLocalDataForOwner(
  ownerScope: string,
  reason: LocalCleanupReason,
  queryClient?: QueryClient | null
) {
  if (!isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_cleanup_owner");
  const existing = readJournal();
  if (existing && existing.ownerScope !== ownerScope) await runCleanupJournal(existing, queryClient);
  const journal: CleanupJournal = existing?.ownerScope === ownerScope
    ? { ...existing, reason }
    : {
        attempts: 0,
        ownerScope,
        reason,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        status: "cleanup_required",
        updatedAt: Date.now()
      };
  writeJournal(journal);
  await runCleanupJournal(journal, queryClient);
}

export async function prepareLocalDataForOwner(
  userId: string,
  queryClient: QueryClient,
  previousQueryClient?: QueryClient | null
) {
  if (!securityStorage && Platform.OS !== "web") {
    await clearSupabaseLocalSessionStorage().catch(() => {});
    throw new Error("local_security_storage_unavailable");
  }
  await runLegacyCleanupOnce();
  const resumedReason = await resumeIncompleteLocalCleanup(previousQueryClient);
  if (resumedReason && reasonInvalidatesSession(resumedReason)) {
    throw new Error("invalidated_session_cleanup_resumed");
  }
  const owner = cacheOwnerForUserId(userId);
  const previousScope = activeOwnerMarker();
  const ownerChanged = resumedReason === "account_switch" || Boolean(previousScope && previousScope !== owner.scope);
  if (previousScope && previousScope !== owner.scope) {
    await cleanupLocalDataForOwner(previousScope, "account_switch", previousQueryClient);
  } else {
    stopOwnerQueryPersistence();
    await previousQueryClient?.cancelQueries().catch(() => {});
    previousQueryClient?.clear();
  }

  writeSecurityValue(ACTIVE_OWNER_KEY, owner.scope);
  const generation = setActiveCacheOwner(owner);
  setAccountFileOwnerScope(owner.scope);
  setUserLocationOwnerScope(owner.scope);
  useUserLocationStore.getState().resetForAccountTransition();
  await setMemoryOfflineOwnerScope(owner.scope);
  await activateOwnerQueryPersistence(queryClient, owner.scope);
  writeSecurityValue(ACTIVE_OWNER_KEY, owner.scope);
  return { generation, owner, ownerChanged };
}

export async function prepareSignedOutLocalData(queryClient: QueryClient, previousQueryClient?: QueryClient | null) {
  await runLegacyCleanupOnce();
  await resumeIncompleteLocalCleanup(previousQueryClient);
  const previousScope = activeOwnerMarker();
  if (previousScope) await cleanupLocalDataForOwner(previousScope, "session_invalid", previousQueryClient);
  stopOwnerQueryPersistence();
  await previousQueryClient?.cancelQueries().catch(() => {});
  previousQueryClient?.clear();
  queryClient.clear();
  await setMemoryOfflineOwnerScope(null);
  setAccountFileOwnerScope(null);
  setUserLocationOwnerScope(null);
  setActiveCacheOwner(null);
}

export async function cleanupCurrentLocalData(reason: LocalCleanupReason, queryClient: QueryClient) {
  const scope = getActiveCacheOwner()?.scope ?? activeOwnerMarker();
  if (!scope) {
    queryClient.clear();
    return true;
  }
  try {
    await cleanupLocalDataForOwner(scope, reason, queryClient);
    return true;
  } catch {
    stopOwnerQueryPersistence();
    queryClient.clear();
    setActiveCacheOwner(null);
    setAccountFileOwnerScope(null);
    setUserLocationOwnerScope(null);
    await setMemoryOfflineOwnerScope(null).catch(() => {});
    clearMemoryCaptureSession();
    clearPostCaptureSession();
    useCommentsSheetStore.getState().closeCommentsSheet();
    useComposerStore.getState().reset();
    useUserLocationStore.getState().resetForAccountTransition();
    return false;
  }
}

export async function localDataDiagnostics() {
  const activeOwner = getActiveCacheOwner();
  const markerScope = activeOwnerMarker();
  const scope = activeOwner?.scope ?? markerScope;
  const journal = readJournal();
  const corruptJournalPresent = Boolean(readSecurityValue(CLEANUP_JOURNAL_KEY) && !journal);
  const memoryDiagnostics = await memoryOfflineDiagnostics();
  let legacyCounts = { memoryDatabaseNamespacesRemoved: 0, queryCacheNamespacesRemoved: 0 };
  try {
    legacyCounts = JSON.parse(readSecurityValue(LEGACY_MIGRATION_COUNTS_KEY) ?? "") as typeof legacyCounts;
  } catch {
    // Sanitized counters are optional diagnostics only.
  }
  return {
    activeCacheOwnerPresent: Boolean(activeOwner),
    accountScopedFileCount: scope ? await accountFileCount(scope) : 0,
    cleanupAttempts: journal?.attempts ?? 0,
    cleanupStatus: corruptJournalPresent ? "corrupt" : journal?.status ?? "idle",
    durableCleanupJournalAvailable: Boolean(securityStorage) || Platform.OS === "web",
    legacyCachePresent: legacyQueryCachePresent() || await legacyGlobalMemoryDatabasePresent(),
    legacyItemsRemoved: legacyCounts,
    legacyMigrationComplete: readSecurityValue(LEGACY_MIGRATION_KEY) === "complete",
    ownerQueryCachePresent: scope ? ownerQueryCachePresent(scope) : false,
    ownerMarkerPresent: Boolean(markerScope),
    queryCacheNamespaceCount: scope && ownerQueryCachePresent(scope) ? 1 : 0,
    memoryDatabaseNamespaceCount: memoryDiagnostics.namespaceCount,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    signedUrlRecordCount: memoryDiagnostics.signedUrlRecordCount
  };
}

export async function developmentResetAccountSensitiveData(queryClient: QueryClient) {
  const journal = readJournal();
  if (journal) await runCleanupJournal({ ...journal, attempts: 0 }, queryClient);
  const scope = activeOwnerMarker();
  if (scope) await cleanupLocalDataForOwner(scope, "manual_security_reset", queryClient);
  await runLegacyCleanupOnce();
}

export function currentLocalDataOwner(): CacheOwner | null {
  return getActiveCacheOwner();
}
