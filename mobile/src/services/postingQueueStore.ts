import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope,
  LOCAL_DATA_SCHEMA_VERSION
} from "@/security/cacheOwnership";
import { createLocalMMKV } from "@/security/localMMKV";
import type { CreatePostInput } from "@/services/posts";

// Posting runs in the background, so the composer is emptied the moment Share
// is tapped and its draft is cleared. That makes this snapshot the only copy of
// the post until the server has it: a failure or a process kill has nothing
// else to recover from. Owner-scoped for the same reason the draft is — a
// pending post must never surface under another account.
export type PersistedPostingEntry = {
  id: string;
  input: Omit<CreatePostInput, "onUploadProgress">;
  mediaCount: number;
  ownerScope: string;
  queuedAt: number;
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
};

const QUEUE_KEY = "pending-posts";
const MAX_ENTRY_AGE_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 10;
const stores = new Map<string, ReturnType<typeof createLocalMMKV>>();

function storeFor(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_posting_queue_owner");
  let store = stores.get(scope);
  if (!store) {
    store = createLocalMMKV(`circlebites.posting-queue.v${LOCAL_DATA_SCHEMA_VERSION}.${scope}`);
    stores.set(scope, store);
  }
  return store;
}

function activeContext() {
  const owner = getActiveCacheOwner();
  const generation = getActiveCacheGeneration();
  if (!owner || !isCacheGenerationActive(generation)) throw new Error("posting_queue_owner_inactive");
  return { generation, owner };
}

function entryIsValid(entry: Partial<PersistedPostingEntry>, scope: string): entry is PersistedPostingEntry {
  return Boolean(
    entry &&
    entry.schemaVersion === LOCAL_DATA_SCHEMA_VERSION &&
    entry.ownerScope === scope &&
    typeof entry.id === "string" && entry.id.length > 0 &&
    typeof entry.queuedAt === "number" && Number.isFinite(entry.queuedAt) &&
    Date.now() - entry.queuedAt <= MAX_ENTRY_AGE_MS &&
    entry.input &&
    typeof entry.input.restaurantName === "string" &&
    Array.isArray(entry.input.mediaItems) &&
    entry.input.mediaItems.length > 0
  );
}

function readEntries(scope: string): PersistedPostingEntry[] {
  const raw = storeFor(scope).getString(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PersistedPostingEntry => entryIsValid(entry, scope));
  } catch {
    storeFor(scope).remove(QUEUE_KEY);
    return [];
  }
}

function writeEntries(scope: string, entries: PersistedPostingEntry[]) {
  const store = storeFor(scope);
  if (entries.length === 0) {
    store.remove(QUEUE_KEY);
    return;
  }
  store.set(QUEUE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

export function readPendingPosts() {
  try {
    const { owner } = activeContext();
    return readEntries(owner.scope);
  } catch {
    return [];
  }
}

export function savePendingPost(id: string, input: Omit<CreatePostInput, "onUploadProgress">) {
  const { generation, owner } = activeContext();
  const entry: PersistedPostingEntry = {
    id,
    input,
    mediaCount: input.mediaItems?.length ?? 0,
    ownerScope: owner.scope,
    queuedAt: Date.now(),
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION
  };
  if (!entryIsValid(entry, owner.scope)) throw new Error("posting_queue_entry_invalid");
  const entries = readEntries(owner.scope).filter((candidate) => candidate.id !== id);
  writeEntries(owner.scope, [...entries, entry]);
  if (getActiveCacheOwner()?.scope !== owner.scope || !isCacheGenerationActive(generation)) {
    throw new Error("posting_queue_owner_changed");
  }
}

export function deletePendingPost(id: string) {
  try {
    const { owner } = activeContext();
    writeEntries(owner.scope, readEntries(owner.scope).filter((entry) => entry.id !== id));
  } catch {
    // A signed-out or switched account has nothing of this owner's to remove.
  }
}

export function clearPostingQueueForScope(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_posting_queue_owner");
  storeFor(scope).clearAll();
  stores.delete(scope);
}
