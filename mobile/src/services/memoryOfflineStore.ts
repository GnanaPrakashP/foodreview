import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { accountFileDirectoryForScope, ensureAccountFileDirectory } from "@/services/accountFileStore";
import { isValidCacheOwnerScope, LOCAL_DATA_SCHEMA_VERSION } from "@/security/cacheOwnership";
import type { MemoryMediaPage, MemoryMessagesPage } from "@/services/memories";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";
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
// Evict cached rows not refreshed within this window so the offline DB can't grow
// unbounded. Kept <= the signed-URL TTL (MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS) so the
// store never serves media URLs that have already expired.
const OFFLINE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

type StoredPayloadRow = {
  payload: string;
};

type StoredCursorRow = StoredPayloadRow & {
  created_at: string;
  id: string;
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

export async function setMemoryOfflineOwnerScope(ownerScope: string | null) {
  if (ownerScope && !isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_memory_cache_owner");
  if (dbState?.ownerScope === ownerScope) return;
  await closeActiveDb();
  if (!ownerScope) return;
  const directory = await ensureAccountFileDirectory(ownerScope);
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
    void pruneOfflineMemoryStore(db);
    return db;
  });
  dbState = { ownerScope, promise };
}

export async function clearMemoryOfflineOwnerScope(ownerScope: string) {
  if (!isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_memory_cache_owner");
  if (dbState?.ownerScope === ownerScope) await closeActiveDb();
  const directory = accountFileDirectoryForScope(ownerScope);
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME, directory);
  } catch {
    const info = await FileSystem.getInfoAsync(`${directory}/${DB_NAME}`);
    if (info.exists) throw new Error("memory_cache_delete_failed");
  }
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

async function pruneOfflineMemoryStore(db: SQLite.SQLiteDatabase) {
  const cutoff = Date.now() - OFFLINE_CACHE_MAX_AGE_MS;
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync("delete from memory_messages where updated_at < ?", cutoff);
      await db.runAsync("delete from memory_photos where updated_at < ?", cutoff);
      await db.runAsync("delete from memory_room_snapshots where updated_at < ?", cutoff);
      await db.runAsync("delete from memory_room_summaries where updated_at < ?", cutoff);
    });
  } catch {
    // Best-effort: pruning must never block or fail the store.
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

function photosFromMessages(messages: MemoryMessage[]) {
  return messages.flatMap((message) => message.attachments);
}

async function saveMessages(db: SQLite.SQLiteDatabase, roomId: string, messages: MemoryMessage[], now: number) {
  for (const message of messages) {
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

  try {
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
  } catch {
    // Offline storage should never block the online path.
  }
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

export async function saveOfflineMemoryRoom(room: MemoryRoom) {
  try {
    const db = await offlineDb();
    const now = Date.now();
    const photos = [...room.photos, ...photosFromMessages(room.messages)];
    const latestMessageAt = room.messages[room.messages.length - 1]?.createdAt ?? null;
    const latestPhotoAt = photos[photos.length - 1]?.createdAt ?? null;
    const latestActivityAt = [latestMessageAt, latestPhotoAt, room.createdAt]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? room.createdAt;

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `insert into memory_room_snapshots (room_id, latest_activity_at, payload, updated_at)
         values (?, ?, ?, ?)
         on conflict(room_id) do update set
           latest_activity_at = excluded.latest_activity_at,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        room.id,
        latestActivityAt,
        JSON.stringify(room),
        now
      );
      await saveMessages(db, room.id, room.messages, now);
      await savePhotos(db, room.id, photos, now);
    });
  } catch {
    // Offline storage should never block the online path.
  }
}

export async function readOfflineMemoryRoom(roomId: string) {
  try {
    const db = await offlineDb();
    const rows = await db.getAllAsync<StoredPayloadRow>(
      "select payload from memory_room_snapshots where room_id = ? limit 1",
      roomId
    );
    const room = rows[0] ? safeParse<MemoryRoom>(rows[0].payload) : null;
    return room?.id === roomId ? sanitizeOfflineMemoryRoom(room) : null;
  } catch {
    return null;
  }
}

export async function saveOfflineMemoryMessagePage(roomId: string, page: MemoryMessagesPage) {
  if (page.messages.length === 0) return;

  try {
    const db = await offlineDb();
    await db.withTransactionAsync(async () => {
      await saveMessages(db, roomId, page.messages, Date.now());
      await savePhotos(db, roomId, photosFromMessages(page.messages), Date.now());
    });
  } catch {
    // Offline storage should never block the online path.
  }
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
      nextCursor: rows.length > limit ? encodeMemoryPageCursor(messages[0]?.createdAt, messages[0]?.id) : null
    };
  } catch {
    return null;
  }
}

export async function saveOfflineMemoryMediaPage(roomId: string, page: MemoryMediaPage) {
  if (page.photos.length === 0) return;

  try {
    const db = await offlineDb();
    await db.withTransactionAsync(async () => {
      await savePhotos(db, roomId, page.photos, Date.now());
    });
  } catch {
    // Offline storage should never block the online path.
  }
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
  try {
    const db = await offlineDb();
    await db.runAsync("delete from memory_messages where message_id = ?", messageId);
  } catch {
    // Offline storage should never block realtime.
  }
}

export async function deleteOfflineMemoryPhoto(photoId: string) {
  try {
    const db = await offlineDb();
    await db.runAsync("delete from memory_photos where photo_id = ?", photoId);
  } catch {
    // Offline storage should never block realtime.
  }
}
