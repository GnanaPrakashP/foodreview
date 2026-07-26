import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import {
  accountFileDirectoryForScope,
  clearMemoryDatabaseDirectory,
  ensureMemoryDatabaseDirectory,
  memoryDatabaseDirectoryForScope
} from "@/services/accountFileStore";
import { isValidCacheOwnerScope, LOCAL_DATA_SCHEMA_VERSION } from "@/security/cacheOwnership";
import type { MemoryMediaPage, MemoryMessagesPage } from "@/services/memories";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";
import {
  sanitizeOfflineMemoryMessage,
  sanitizeOfflineMemoryPhoto,
  sanitizeOfflineMemoryRoom
} from "@/security/offlineMemorySecurity";

const DB_NAME = `circlebites-memory-offline-v${LOCAL_DATA_SCHEMA_VERSION}.db`;
const LEGACY_DB_NAME = "circlebites-memory-offline.db";
const MEMORY_PAGE_CURSOR_SEPARATOR = "|";
const DEFAULT_CHAT_PAGE_LIMIT = 50;
const DEFAULT_MEDIA_PAGE_LIMIT = 30;
const MIGRATION_DB_NAME = `${DB_NAME}.migrating`;

type StoredPayloadRow = {
  payload: string;
};

type StoredCursorRow = StoredPayloadRow & {
  created_at: string;
  id: string;
};

type StoredSyncCursorRow = {
  sync_cursor: string;
};

let dbState: { ownerScope: string; promise: Promise<SQLite.SQLiteDatabase> } | null = null;

async function closeActiveDb() {
  const current = dbState;
  dbState = null;
  if (!current) return;
  try {
    await (await current.promise).closeAsync();
  } catch {
    // A missing/already-closed database is an idempotent close.
  }
}

function databasePath(directory: string, name = DB_NAME) {
  return `${directory}/${name}`;
}

async function fileExists(path: string) {
  return (await FileSystem.getInfoAsync(path)).exists;
}

async function verifyDatabaseFile(directory: string, name: string, ownerScope: string) {
  const db = await SQLite.openDatabaseAsync(name, {}, directory);
  try {
    const integrity = await db.getFirstAsync<Record<string, unknown>>("pragma quick_check(1)");
    if (!integrity || !Object.values(integrity).some((value) => value === "ok")) {
      throw new Error("memory_database_integrity_failed");
    }
    const table = await db.getFirstAsync<{ name: string }>(
      "select name from sqlite_master where type = 'table' and name = 'local_cache_meta'"
    );
    if (table) {
      const meta = await db.getFirstAsync<{ owner_scope: string }>(
        "select owner_scope from local_cache_meta where singleton = 1"
      );
      if (meta && meta.owner_scope !== ownerScope) throw new Error("memory_cache_owner_mismatch");
    }
  } finally {
    await db.closeAsync();
  }
}

async function checkpointLegacyDatabase(directory: string) {
  const db = await SQLite.openDatabaseAsync(DB_NAME, {}, directory);
  try {
    await db.execAsync("pragma wal_checkpoint(full);");
  } finally {
    await db.closeAsync();
  }
}

async function removeDatabaseFiles(directory: string, name = DB_NAME) {
  await Promise.all(
    ["", "-wal", "-shm"].map((suffix) => (
      FileSystem.deleteAsync(`${databasePath(directory, name)}${suffix}`, { idempotent: true })
    ))
  );
}

async function removeLegacyDatabaseFiles(directory: string) {
  await removeDatabaseFiles(directory);
}

async function migrateLegacyCacheDatabase(ownerScope: string, durableDirectory: string) {
  const startedAt = Date.now();
  const legacyDirectory = accountFileDirectoryForScope(ownerScope);
  const legacyPath = databasePath(legacyDirectory);
  const durablePath = databasePath(durableDirectory);
  const temporaryPath = databasePath(durableDirectory, MIGRATION_DB_NAME);
  const legacyExists = await fileExists(legacyPath);
  const durableExists = await fileExists(durablePath);
  let promoted = false;

  try {
    if (durableExists) {
      try {
        await verifyDatabaseFile(durableDirectory, DB_NAME, ownerScope);
        if (legacyExists) await removeLegacyDatabaseFiles(legacyDirectory);
        return;
      } catch {
        // A prior process may have stopped after promotion but before validation.
        // Only discard that durable candidate when the verified source copy still
        // exists; otherwise fail closed and preserve the only database.
        if (!legacyExists) throw new Error("memory_database_migration_failed");
        await removeDatabaseFiles(durableDirectory);
      }
    }
    if (!legacyExists) return;

    await checkpointLegacyDatabase(legacyDirectory);
    await removeDatabaseFiles(durableDirectory, MIGRATION_DB_NAME);
    await FileSystem.copyAsync({ from: legacyPath, to: temporaryPath });
    await verifyDatabaseFile(durableDirectory, MIGRATION_DB_NAME, ownerScope);
    await FileSystem.moveAsync({ from: temporaryPath, to: durablePath });
    promoted = true;
    await verifyDatabaseFile(durableDirectory, DB_NAME, ownerScope);
    await removeLegacyDatabaseFiles(legacyDirectory);
    recordMobileFlow("memory.sqlite_migration", Date.now() - startedAt, "success");
  } catch {
    await removeDatabaseFiles(durableDirectory, MIGRATION_DB_NAME).catch(() => {});
    // The old cache database is still intact until validation succeeds, so a
    // failed promoted copy can be safely removed and retried on the next open.
    if (promoted) await removeDatabaseFiles(durableDirectory).catch(() => {});
    captureMobileError(
      "memory.sqlite_migration_failed",
      new Error("memory_database_migration_failed")
    );
    recordMobileFlow("memory.sqlite_migration", Date.now() - startedAt, "failure");
    throw new Error("memory_database_migration_failed");
  }
}

export async function setMemoryOfflineOwnerScope(ownerScope: string | null) {
  if (ownerScope && !isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_memory_cache_owner");
  if (dbState?.ownerScope === ownerScope) return;
  await closeActiveDb();
  if (!ownerScope) return;
  const directory = await ensureMemoryDatabaseDirectory(ownerScope);
  await migrateLegacyCacheDatabase(ownerScope, directory);
  const promise = SQLite.openDatabaseAsync(DB_NAME, {}, directory).then(async (db) => {
    await db.execAsync(`
      create table if not exists local_cache_meta (
        singleton integer primary key not null check (singleton = 1),
        owner_scope text not null,
        schema_version integer not null
      );
      create table if not exists memory_room_summaries (
        room_id text primary key not null,
        latest_activity_at text,
        payload text not null,
        updated_at integer not null
      );
      create table if not exists memory_room_snapshots (
        room_id text primary key not null,
        latest_activity_at text,
        payload text not null,
        updated_at integer not null
      );
      create table if not exists memory_messages (
        message_id text primary key not null,
        room_id text not null,
        created_at text not null,
        payload text not null,
        updated_at integer not null
      );
      create index if not exists memory_messages_room_created_id_desc_idx
        on memory_messages(room_id, created_at desc, message_id desc);
      create table if not exists memory_photos (
        photo_id text primary key not null,
        room_id text not null,
        message_id text,
        created_at text not null,
        payload text not null,
        updated_at integer not null
      );
      create index if not exists memory_photos_room_created_id_desc_idx
        on memory_photos(room_id, created_at desc, photo_id desc);
      create index if not exists memory_photos_message_idx
        on memory_photos(room_id, message_id);
      create table if not exists memory_room_sync_state (
        room_id text primary key not null,
        sync_cursor text not null,
        updated_at integer not null
      );
      create table if not exists memory_message_outbox (
        message_id text primary key not null,
        client_id text not null,
        room_id text not null,
        created_at text not null,
        payload text not null,
        updated_at integer not null
      );
      create unique index if not exists memory_message_outbox_client_idx
        on memory_message_outbox(client_id);
      create index if not exists memory_message_outbox_room_created_idx
        on memory_message_outbox(room_id, created_at, message_id);
    `);
    const meta = await db.getFirstAsync<{ owner_scope: string; schema_version: number }>(
      "select owner_scope, schema_version from local_cache_meta where singleton = 1"
    );
    if (meta && (meta.owner_scope !== ownerScope || meta.schema_version !== LOCAL_DATA_SCHEMA_VERSION)) {
      await db.closeAsync();
      throw new Error("memory_cache_owner_mismatch");
    }
    await db.runAsync(
      `insert into local_cache_meta(singleton, owner_scope, schema_version) values (1, ?, ?)
       on conflict(singleton) do update set owner_scope = excluded.owner_scope, schema_version = excluded.schema_version`,
      ownerScope,
      LOCAL_DATA_SCHEMA_VERSION
    );
    return db;
  });
  dbState = { ownerScope, promise };
}

export async function clearMemoryOfflineOwnerScope(ownerScope: string) {
  if (!isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_memory_cache_owner");
  if (dbState?.ownerScope === ownerScope) await closeActiveDb();
  const directory = memoryDatabaseDirectoryForScope(ownerScope);
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME, directory);
  } catch {
    const info = await FileSystem.getInfoAsync(`${directory}/${DB_NAME}`);
    if (info.exists) throw new Error("memory_database_delete_failed");
  }
  await clearMemoryDatabaseDirectory(ownerScope);
  await removeLegacyDatabaseFiles(accountFileDirectoryForScope(ownerScope));
}

export async function clearLegacyGlobalMemoryDatabase() {
  try {
    await SQLite.deleteDatabaseAsync(LEGACY_DB_NAME);
  } catch {
    const possibleLegacyPaths = [
      `${FileSystem.documentDirectory ?? ""}SQLite/${LEGACY_DB_NAME}`,
      `${FileSystem.documentDirectory ?? ""}${LEGACY_DB_NAME}`
    ];
    const checks = await Promise.all(possibleLegacyPaths.map((path) => FileSystem.getInfoAsync(path)));
    if (checks.some((info) => info.exists)) throw new Error("legacy_memory_cache_delete_failed");
  }
}

export async function legacyGlobalMemoryDatabasePresent() {
  const possibleLegacyPaths = [
    `${FileSystem.documentDirectory ?? ""}SQLite/${LEGACY_DB_NAME}`,
    `${FileSystem.documentDirectory ?? ""}${LEGACY_DB_NAME}`
  ];
  try {
    const checks = await Promise.all(possibleLegacyPaths.map((path) => FileSystem.getInfoAsync(path)));
    return checks.some((info) => info.exists);
  } catch {
    return true;
  }
}

export async function memoryOfflineDiagnostics() {
  if (!dbState) return { namespaceCount: 0, signedUrlRecordCount: 0 };
  try {
    const db = await offlineDb();
    const row = await db.getFirstAsync<{ count: number }>(
      `select count(*) as count from memory_photos where payload like '%"signedUrlExpiresAt":%'`
    );
    return { namespaceCount: 1, signedUrlRecordCount: Number(row?.count ?? 0) };
  } catch {
    return { namespaceCount: 0, signedUrlRecordCount: 0 };
  }
}

function encodeMemoryPageCursor(createdAt: string | null | undefined, id: string | null | undefined) {
  if (!createdAt || !id) return null;
  return `${createdAt}${MEMORY_PAGE_CURSOR_SEPARATOR}${id}`;
}

function parseMemoryPageCursor(cursor?: string | null) {
  if (!cursor) return null;
  const separatorIndex = cursor.lastIndexOf(MEMORY_PAGE_CURSOR_SEPARATOR);
  if (separatorIndex <= 0) return { createdAt: cursor, id: null };
  return {
    createdAt: cursor.slice(0, separatorIndex),
    id: cursor.slice(separatorIndex + 1) || null
  };
}

function safeParse<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

async function offlineDb() {
  if (!dbState) throw new Error("memory_cache_owner_unresolved");
  const state = dbState;
  const db = await state.promise;
  if (dbState !== state) {
    await db.closeAsync().catch(() => {});
    throw new Error("memory_cache_owner_changed");
  }
  return db;
}

export class MemoryOfflinePersistenceError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`memory_database_${operation}_failed`);
    this.name = "MemoryOfflinePersistenceError";
    this.operation = operation;
  }
}

export function isOfflineMemoryPersistenceError(error: unknown) {
  return error instanceof MemoryOfflinePersistenceError;
}

async function criticalOfflineWrite<T>(operation: string, action: () => Promise<T>) {
  const startedAt = Date.now();
  try {
    const result = await action();
    recordMobileFlow("memory.sqlite_write", Date.now() - startedAt, "success", { operation });
    return result;
  } catch {
    captureMobileError(
      "memory.sqlite_write_failed",
      new Error("memory_database_write_failed"),
      { operation }
    );
    recordMobileFlow("memory.sqlite_write", Date.now() - startedAt, "failure", { operation });
    throw new MemoryOfflinePersistenceError(operation);
  }
}

function photosFromMessages(messages: MemoryMessage[]) {
  return messages.flatMap((message) => message.attachments);
}

async function saveMessages(db: SQLite.SQLiteDatabase, roomId: string, messages: MemoryMessage[], now: number) {
  for (const message of messages) {
    if (message.deliveryStatus === "pending" || message.deliveryStatus === "failed") continue;
    await db.runAsync(
      `insert into memory_messages (message_id, room_id, created_at, payload, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(message_id) do update set
         room_id = excluded.room_id,
         created_at = excluded.created_at,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      message.id,
      roomId,
      message.createdAt,
      JSON.stringify(message),
      now
    );
  }
}

async function savePhotos(db: SQLite.SQLiteDatabase, roomId: string, photos: MemoryPhoto[], now: number) {
  for (const photo of photos) {
    await db.runAsync(
      `insert into memory_photos (photo_id, room_id, message_id, created_at, payload, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(photo_id) do update set
         room_id = excluded.room_id,
         message_id = excluded.message_id,
         created_at = excluded.created_at,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      photo.id,
      roomId,
      photo.messageId,
      photo.createdAt,
      JSON.stringify(photo),
      now
    );
  }
}

export async function saveOfflineMemorySummaries(summaries: MemoryRoomSummary[]) {
  if (summaries.length === 0) return;

  return criticalOfflineWrite("summaries", async () => {
    const db = await offlineDb();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      for (const summary of summaries) {
        await db.runAsync(
          `insert into memory_room_summaries (room_id, latest_activity_at, payload, updated_at)
           values (?, ?, ?, ?)
           on conflict(room_id) do update set
             latest_activity_at = excluded.latest_activity_at,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
          summary.id,
          summary.latestActivityAt,
          JSON.stringify(summary),
          now
        );
      }
    });
  });
}

export async function readOfflineMemorySummaries() {
  try {
    const db = await offlineDb();
    const rows = await db.getAllAsync<StoredPayloadRow>(
      `select payload
       from memory_room_summaries
       order by latest_activity_at desc, room_id desc`
    );
    const summaries = rows
      .map((row) => safeParse<MemoryRoomSummary>(row.payload))
      .filter((summary): summary is MemoryRoomSummary => Boolean(summary));
    return summaries.length > 0 ? summaries : null;
  } catch {
    return null;
  }
}

export async function saveOfflineMemoryRoom(
  room: MemoryRoom,
  syncCursor?: string | null,
  options: { replaceChat?: boolean } = {}
) {
  return criticalOfflineWrite("room", async () => {
    const db = await offlineDb();
    const now = Date.now();
    const persistedMessages = room.messages.filter(
      (message) => message.deliveryStatus !== "pending" && message.deliveryStatus !== "failed"
    );
    const photos = [...room.photos, ...photosFromMessages(persistedMessages)];
    const latestMessageAt = persistedMessages[persistedMessages.length - 1]?.createdAt ?? null;
    const latestPhotoAt = photos[photos.length - 1]?.createdAt ?? null;
    const latestActivityAt = [latestMessageAt, latestPhotoAt, room.createdAt]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? room.createdAt;

    await db.withTransactionAsync(async () => {
      if (options.replaceChat) {
        await db.runAsync("delete from memory_photos where room_id = ?", room.id);
        await db.runAsync("delete from memory_messages where room_id = ?", room.id);
      }
      await db.runAsync(
        `insert into memory_room_snapshots (room_id, latest_activity_at, payload, updated_at)
         values (?, ?, ?, ?)
         on conflict(room_id) do update set
           latest_activity_at = excluded.latest_activity_at,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        room.id,
        latestActivityAt,
        // Chat rows are normalized below. Keeping them out of the snapshot makes a
        // realtime message/photo write O(1) instead of rewriting the entire room.
        JSON.stringify({ ...room, messages: [], photos: [] }),
        now
      );
      await saveMessages(db, room.id, persistedMessages, now);
      await savePhotos(db, room.id, photos, now);
      if (syncCursor) {
        await db.runAsync(
          `insert into memory_room_sync_state (room_id, sync_cursor, updated_at)
           values (?, ?, ?)
           on conflict(room_id) do update set
             sync_cursor = excluded.sync_cursor,
             updated_at = excluded.updated_at`,
          room.id,
          syncCursor,
          now
        );
      } else if (options.replaceChat) {
        await db.runAsync("delete from memory_room_sync_state where room_id = ?", room.id);
      }
    });
  });
}

export async function readOfflineMemoryRoom(roomId: string) {
  try {
    const db = await offlineDb();
    const [snapshotRows, messageRows, outboxRows] = await Promise.all([
      db.getAllAsync<StoredPayloadRow>(
        "select payload from memory_room_snapshots where room_id = ? limit 1",
        roomId
      ),
      db.getAllAsync<StoredPayloadRow>(
        `select payload
         from memory_messages
         where room_id = ?
         order by created_at desc, message_id desc`,
        roomId
      ),
      db.getAllAsync<StoredPayloadRow>(
        `select payload
         from memory_message_outbox
         where room_id = ?
         order by created_at asc, message_id asc`,
        roomId
      )
    ]);
    const snapshot = snapshotRows[0] ? safeParse<MemoryRoom>(snapshotRows[0].payload) : null;
    if (!snapshot || snapshot.id !== roomId) return null;

    const persistedMessages = messageRows
      .map((row) => safeParse<MemoryMessage>(row.payload))
      .filter((message): message is MemoryMessage => message !== null && message.roomId === roomId)
      .map((message) => sanitizeOfflineMemoryMessage(message))
      .reverse();
    const outboxMessages = outboxRows
      .map((row) => safeParse<MemoryMessage>(row.payload))
      .filter((message): message is MemoryMessage => message !== null && message.roomId === roomId)
      .map((message) => sanitizeOfflineMemoryMessage(message));
    const messages = [...persistedMessages];
    for (const message of outboxMessages) {
      if (!messages.some((current) => current.id === message.id)) messages.push(message);
    }
    messages.sort((first, second) => (
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime() ||
      first.id.localeCompare(second.id)
    ));

    // Keep the complete downloaded metadata projection. Standalone room,
    // stop/gallery and chat-associated media are all durable; only the binary
    // files behind their signed URLs are disposable.
    const photos = (await db.getAllAsync<StoredPayloadRow>(
      `select payload
       from memory_photos
       where room_id = ?
       order by created_at asc, photo_id asc`,
      roomId
    ))
      .map((row) => safeParse<MemoryPhoto>(row.payload))
      .filter((photo): photo is MemoryPhoto => photo !== null && photo.roomId === roomId)
      .map((photo) => sanitizeOfflineMemoryPhoto(photo));
    const photosByMessageId = new Map<string, MemoryPhoto[]>();
    for (const photo of photos) {
      if (!photo.messageId) continue;
      photosByMessageId.set(photo.messageId, [...(photosByMessageId.get(photo.messageId) ?? []), photo]);
    }
    const hydratedMessages = messages.map((message) => ({
      ...message,
      attachments: photosByMessageId.get(message.id) ?? []
    }));

    return sanitizeOfflineMemoryRoom({
      ...snapshot,
      messages: hydratedMessages,
      photos
    });
  } catch {
    return null;
  }
}

export async function readOfflineMemoryRoomSyncCursor(roomId: string) {
  try {
    const db = await offlineDb();
    const row = await db.getFirstAsync<StoredSyncCursorRow>(
      "select sync_cursor from memory_room_sync_state where room_id = ? limit 1",
      roomId
    );
    return row?.sync_cursor ?? null;
  } catch {
    return null;
  }
}

export async function saveOfflineMemoryMessage(roomId: string, message: MemoryMessage) {
  return criticalOfflineWrite("message", async () => {
    const db = await offlineDb();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      await saveMessages(db, roomId, [message], now);
      await savePhotos(db, roomId, message.attachments, now);
    });
  });
}

export async function saveOfflineMemoryPhoto(roomId: string, photo: MemoryPhoto) {
  return criticalOfflineWrite("photo", async () => {
    const db = await offlineDb();
    await savePhotos(db, roomId, [photo], Date.now());
  });
}

export async function applyOfflineMemoryChatDelta(
  roomId: string,
  input: {
    deletedMessageIds: string[];
    deletedPhotoIds: string[];
    messages: MemoryMessage[];
    photos: MemoryPhoto[];
    syncCursor: string;
  }
) {
  return criticalOfflineWrite("sync_delta", async () => {
    const db = await offlineDb();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      for (const messageId of input.deletedMessageIds) {
        await db.runAsync("delete from memory_photos where room_id = ? and message_id = ?", roomId, messageId);
        await db.runAsync("delete from memory_messages where room_id = ? and message_id = ?", roomId, messageId);
      }
      for (const photoId of input.deletedPhotoIds) {
        await db.runAsync("delete from memory_photos where room_id = ? and photo_id = ?", roomId, photoId);
      }
      await saveMessages(db, roomId, input.messages, now);
      await savePhotos(db, roomId, input.photos, now);
      await db.runAsync(
        `insert into memory_room_sync_state (room_id, sync_cursor, updated_at)
         values (?, ?, ?)
         on conflict(room_id) do update set
           sync_cursor = excluded.sync_cursor,
           updated_at = excluded.updated_at`,
        roomId,
        input.syncCursor,
        now
      );
    });
  });
}

export async function saveOfflineMemoryOutboxMessage(clientId: string, message: MemoryMessage) {
  return criticalOfflineWrite("outbox_insert", async () => {
    const db = await offlineDb();
    await db.runAsync(
      `insert into memory_message_outbox (message_id, client_id, room_id, created_at, payload, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(message_id) do update set
         client_id = excluded.client_id,
         room_id = excluded.room_id,
         created_at = excluded.created_at,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      message.id,
      clientId,
      message.roomId,
      message.createdAt,
      JSON.stringify(message),
      Date.now()
    );
  });
}

export async function deleteOfflineMemoryOutboxMessage(messageId: string) {
  return criticalOfflineWrite("outbox_delete", async () => {
    const db = await offlineDb();
    await db.runAsync("delete from memory_message_outbox where message_id = ?", messageId);
  });
}

export async function commitOfflineMemoryOutboxMessage(
  optimisticMessageId: string,
  message: MemoryMessage
) {
  return criticalOfflineWrite("outbox_commit", async () => {
    const db = await offlineDb();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      await saveMessages(db, message.roomId, [message], now);
      await savePhotos(db, message.roomId, message.attachments, now);
      await db.runAsync("delete from memory_message_outbox where message_id = ?", optimisticMessageId);
    });
  });
}

export async function saveOfflineMemoryMessagePage(roomId: string, page: MemoryMessagesPage) {
  if (page.messages.length === 0) return;

  return criticalOfflineWrite("message_page", async () => {
    const db = await offlineDb();
    await db.withTransactionAsync(async () => {
      await saveMessages(db, roomId, page.messages, Date.now());
      await savePhotos(db, roomId, photosFromMessages(page.messages), Date.now());
    });
  });
}

export async function readOfflineMemoryMessagesPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMessagesPage | null> {
  try {
    const db = await offlineDb();
    const cursor = parseMemoryPageCursor(input.before);
    const limit = input.limit ?? DEFAULT_CHAT_PAGE_LIMIT;
    const pageLimit = limit + 1;
    const params: Array<string | number> = [roomId];
    let cursorWhere = "";

    if (cursor?.id) {
      cursorWhere = "and (created_at < ? or (created_at = ? and message_id < ?))";
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    } else if (cursor?.createdAt) {
      cursorWhere = "and created_at < ?";
      params.push(cursor.createdAt);
    }

    params.push(pageLimit);
    const rows = await db.getAllAsync<StoredCursorRow>(
      `select message_id as id, created_at, payload
       from memory_messages
       where room_id = ?
       ${cursorWhere}
       order by created_at desc, message_id desc
       limit ?`,
      params
    );
    const selectedRows = rows.slice(0, limit);
    const messages = selectedRows
      .map((row) => safeParse<MemoryMessage>(row.payload))
      .filter((message): message is MemoryMessage => Boolean(message))
      .map((message) => sanitizeOfflineMemoryMessage(message))
      .reverse();

    if (messages.length === 0) return null;

    return {
      messages,
      // SQLite only knows how far this device has cached. Even a short local
      // page must hand off at its oldest row so the next request can ask the
      // server whether earlier history exists.
      nextCursor: encodeMemoryPageCursor(messages[0]?.createdAt, messages[0]?.id)
    };
  } catch {
    return null;
  }
}

export async function saveOfflineMemoryMediaPage(roomId: string, page: MemoryMediaPage) {
  if (page.photos.length === 0) return;

  return criticalOfflineWrite("media_page", async () => {
    const db = await offlineDb();
    await db.withTransactionAsync(async () => {
      await savePhotos(db, roomId, page.photos, Date.now());
    });
  });
}

export async function deleteOfflineMemoryRoom(roomId: string) {
  return criticalOfflineWrite("room_delete", async () => {
    const db = await offlineDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("delete from memory_photos where room_id = ?", roomId);
      await db.runAsync("delete from memory_messages where room_id = ?", roomId);
      await db.runAsync("delete from memory_message_outbox where room_id = ?", roomId);
      await db.runAsync("delete from memory_room_sync_state where room_id = ?", roomId);
      await db.runAsync("delete from memory_room_snapshots where room_id = ?", roomId);
      await db.runAsync("delete from memory_room_summaries where room_id = ?", roomId);
    });
  });
}

export async function saveOfflineMemoryReadState(roomId: string, lastReadAt: string) {
  return criticalOfflineWrite("read_state", async () => {
    const db = await offlineDb();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      const snapshot = await db.getFirstAsync<StoredPayloadRow>(
        "select payload from memory_room_snapshots where room_id = ? limit 1",
        roomId
      );
      const room = snapshot ? safeParse<MemoryRoom>(snapshot.payload) : null;
      if (room) {
        await db.runAsync(
          "update memory_room_snapshots set payload = ?, updated_at = ? where room_id = ?",
          JSON.stringify({ ...room, lastReadAt }),
          now,
          roomId
        );
      }
      const summaryRow = await db.getFirstAsync<StoredPayloadRow>(
        "select payload from memory_room_summaries where room_id = ? limit 1",
        roomId
      );
      const summary = summaryRow ? safeParse<MemoryRoomSummary>(summaryRow.payload) : null;
      if (summary) {
        await db.runAsync(
          "update memory_room_summaries set payload = ?, updated_at = ? where room_id = ?",
          JSON.stringify({ ...summary, unreadCount: 0 }),
          now,
          roomId
        );
      }
    });
  });
}

export async function readOfflineMemoryMediaPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMediaPage | null> {
  try {
    const db = await offlineDb();
    const cursor = parseMemoryPageCursor(input.before);
    const limit = input.limit ?? DEFAULT_MEDIA_PAGE_LIMIT;
    const pageLimit = limit + 1;
    const params: Array<string | number> = [roomId];
    let cursorWhere = "";

    if (cursor?.id) {
      cursorWhere = "and (created_at < ? or (created_at = ? and photo_id < ?))";
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    } else if (cursor?.createdAt) {
      cursorWhere = "and created_at < ?";
      params.push(cursor.createdAt);
    }

    params.push(pageLimit);
    const rows = await db.getAllAsync<StoredCursorRow>(
      `select photo_id as id, created_at, payload
       from memory_photos
       where room_id = ?
       ${cursorWhere}
       order by created_at desc, photo_id desc
       limit ?`,
      params
    );
    const selectedRows = rows.slice(0, limit);
    const photos = selectedRows
      .map((row) => safeParse<MemoryPhoto>(row.payload))
      .filter((photo): photo is MemoryPhoto => Boolean(photo))
      .map((photo) => sanitizeOfflineMemoryPhoto(photo));

    if (photos.length === 0) return null;

    return {
      nextCursor: rows.length > limit ? encodeMemoryPageCursor(photos[photos.length - 1]?.createdAt, photos[photos.length - 1]?.id) : null,
      photos
    };
  } catch {
    return null;
  }
}

export async function deleteOfflineMemoryMessage(messageId: string) {
  return criticalOfflineWrite("message_delete", async () => {
    const db = await offlineDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("delete from memory_photos where message_id = ?", messageId);
      await db.runAsync("delete from memory_messages where message_id = ?", messageId);
    });
  });
}

export async function deleteOfflineMemoryPhoto(photoId: string) {
  return criticalOfflineWrite("photo_delete", async () => {
    const db = await offlineDb();
    await db.runAsync("delete from memory_photos where photo_id = ?", photoId);
  });
}
