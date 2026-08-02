import { memoryMessageServerId } from "@/services/memoryMessageReconciliation.mjs";
import type { MemoryMessage } from "@/types/models";

const MEMORY_PAGE_CURSOR_SEPARATOR = "|";

// One definition, because a page cursor is not private to whoever produced it.
// React Query hands a page's nextCursor straight back as the next pageParam,
// and that request may be answered by the mobile API even when the page it came
// from was served out of SQLite. Two independent copies of this codec — one
// here in the network layer, one in the offline store — is precisely how chat
// history came to strand at the cache boundary: the offline reader emitted
// `createdAt|id`, the next page missed the cache, and the route rejected it with
// 400 "Invalid cursor".
//
// WRITE the API's opaque form only. READ every shape this app has ever written,
// because old cursors are already sitting in users' SQLite.

// The route base64url-decodes and JSON.parses whatever arrives, so this has to
// match exactly. btoa is safe: the payload is only an ISO timestamp and a UUID,
// both ASCII.
export function encodeMemoryPageCursor(
  createdAt: string | null | undefined,
  id: string | null | undefined
) {
  if (!createdAt || !id) return null;
  return btoa(JSON.stringify({ createdAt, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeOpaqueCursor(cursor: string) {
  // A base64url payload never contains "|", so the legacy pair can never be
  // mistaken for one.
  if (cursor.includes(MEMORY_PAGE_CURSOR_SEPARATOR)) return null;
  try {
    const parsed = JSON.parse(
      atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { createdAt?: unknown; id?: unknown };
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
    const id = typeof parsed.id === "string" ? parsed.id : "";
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function parseMemoryPageCursor(cursor?: string | null) {
  if (!cursor) return null;
  const opaque = decodeOpaqueCursor(cursor);
  if (opaque) return opaque;
  const separatorIndex = cursor.lastIndexOf(MEMORY_PAGE_CURSOR_SEPARATOR);
  if (separatorIndex <= 0) return { createdAt: cursor, id: null };
  return {
    createdAt: cursor.slice(0, separatorIndex),
    id: cursor.slice(separatorIndex + 1) || null
  };
}

// Anchor for "load older", built from the oldest message the SERVER knows
// about. Two things make that different from simply taking messages[0]: the
// cursor id must be a UUID, so an optimistic row cannot anchor it, and the
// server paginates on its own created_at rather than the client timestamp the
// list is ordered by.
export function memoryPageCursorFromMessage(message: MemoryMessage | null | undefined) {
  if (!message) return null;
  const id = memoryMessageServerId(message);
  const createdAt = message.serverCreatedAt ?? null;
  return id && createdAt ? encodeMemoryPageCursor(createdAt, id) : null;
}

export function memoryHistoryCursorFromMessages(
  messages: MemoryMessage[] | null | undefined
) {
  if (!messages?.length) return null;
  for (const message of messages) {
    const cursor = memoryPageCursorFromMessage(message);
    if (cursor) return cursor;
  }
  return null;
}
