import { NextRequest, NextResponse } from "next/server";
import { signMemoryPhotoPayload } from "@/lib/server/memory-media-delivery";
import { decodeStableTimestampCursor, encodeStableTimestampCursor } from "@/lib/server/stable-cursor";
import { getRouteActor } from "@/lib/server/route-supabase";

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function boundedLimit(value: string | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.floor(parsed) : fallback, 1), 50);
}

function boundedSyncLimit(value: string | null) {
  const parsed = Number(value ?? 200);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.floor(parsed) : 200, 1), 500);
}

function changeCursor(value: string | null) {
  if (!value || !/^\d{1,19}$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized.length < 19 || normalized <= "9223372036854775807" ? normalized : null;
}

function memoryCursorParts(value: string | null | undefined) {
  if (!value) return null;
  const delimiter = value.lastIndexOf("|");
  if (delimiter <= 0) return null;
  const createdAt = value.slice(0, delimiter);
  const id = value.slice(delimiter + 1);
  return UUID_PATTERN.test(id) && Number.isFinite(Date.parse(createdAt)) ? { createdAt, id } : null;
}

function opaqueMemoryCursor(value: unknown) {
  const cursor = typeof value === "string" ? memoryCursorParts(value) : null;
  return cursor ? encodeStableTimestampCursor(cursor) : null;
}

function photosFromPayload(payload: JsonRecord) {
  return Array.isArray(payload.photos)
    ? payload.photos.filter((value): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
}

function withoutTimelineCursor(room: JsonRecord) {
  const safeRoom = { ...room };
  delete safeRoom.timeline_date;
  return safeRoom;
}

async function signNestedChat(payload: JsonRecord, roomId: string) {
  if (!payload.chat || typeof payload.chat !== "object" || Array.isArray(payload.chat)) return payload;
  return { ...payload, chat: await signMemoryPhotoPayload(payload.chat as JsonRecord, roomId) };
}

async function signNestedChanges(payload: JsonRecord, roomId: string) {
  if (!payload.changes || typeof payload.changes !== "object" || Array.isArray(payload.changes)) return payload;
  return { ...payload, changes: await signMemoryPhotoPayload(payload.changes as JsonRecord, roomId) };
}

export async function GET(req: NextRequest) {
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action") ?? "";
  const limit = action === "sync"
    ? boundedSyncLimit(req.nextUrl.searchParams.get("limit"))
    : boundedLimit(req.nextUrl.searchParams.get("limit"), action === "rooms" ? 50 : 30);
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = decodeStableTimestampCursor(rawCursor);
  if (rawCursor && !cursor) return privateJson({ error: "Invalid cursor" }, { status: 400 });

  try {
    if (action === "rooms") {
      const { data, error } = await supabase.rpc("shared_memory_room_summaries_v3", {
        p_before_timeline_date: cursor?.createdAt.slice(0, 10) ?? null,
        p_before_room_id: cursor?.id ?? null,
        p_limit: limit + 1,
      });
      if (error) throw error;
      const roomsWithCursorSentinel = Array.isArray(data) ? data as JsonRecord[] : [];
      const hasMore = roomsWithCursorSentinel.length > limit;
      const selectedRooms = roomsWithCursorSentinel.slice(0, limit);
      const last = hasMore ? selectedRooms.at(-1) : null;
      const createdAt = typeof last?.timeline_date === "string" ? last.timeline_date : null;
      const id = typeof last?.id === "string" ? last.id : null;
      return privateJson({
        nextCursor: createdAt && id ? encodeStableTimestampCursor({ createdAt, id }) : null,
        rooms: selectedRooms.map(withoutTimelineCursor),
      });
    }

    const roomId = req.nextUrl.searchParams.get("roomId") ?? "";
    if (!UUID_PATTERN.test(roomId)) return privateJson({ error: "Invalid room id" }, { status: 400 });

    if (action === "renewMedia") {
      const mediaId = req.nextUrl.searchParams.get("mediaId") ?? "";
      if (!UUID_PATTERN.test(mediaId)) return privateJson({ error: "Invalid media id" }, { status: 400 });
      // The actor-scoped client performs the authorization read. The delivery
      // helper signs only this already-authorized photo id and never expands
      // the caller's visible row set.
      const { data: photo, error } = await supabase
        .from("shared_memory_photos")
        .select("id, room_id, stop_id, message_id, uploader_name, uploader_id, media_type, image_width, image_height, position, upload_intent_id, moderation_status, moderation_reason, file_size_bytes, mime_type, duration_ms, created_at")
        .eq("id", mediaId)
        .eq("room_id", roomId)
        .maybeSingle();
      if (error) throw error;
      if (!photo) return privateJson({ error: "Memory media not found" }, { status: 404 });
      const signed = await signMemoryPhotoPayload({ photos: [photo] }, roomId);
      return privateJson({ photo: photosFromPayload(signed)[0] ?? null });
    }

    if (action === "detail") {
      const { data, error } = await supabase.rpc("shared_memory_room_bootstrap_v1", {
        p_message_limit: limit,
        p_room_id: roomId,
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return privateJson({ error: "Memory room not found" }, { status: 404 });
      }
      return privateJson({
        ...await signNestedChat(data as JsonRecord, roomId),
        viewerName: actor.actorName,
      });
    }

    if (action === "sync") {
      const rawChangeCursor = req.nextUrl.searchParams.get("changeCursor");
      const afterCursor = changeCursor(rawChangeCursor);
      if (!afterCursor) return privateJson({ error: "Invalid change cursor" }, { status: 400 });
      const { data, error } = await supabase.rpc("shared_memory_room_sync_v1", {
        p_after_cursor: afterCursor,
        p_limit: limit,
        p_room_id: roomId,
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return privateJson({ error: "Memory room not found" }, { status: 404 });
      }
      return privateJson({
        ...await signNestedChanges(data as JsonRecord, roomId),
        viewerName: actor.actorName,
      });
    }

    if (action === "chat") {
      const { data, error } = await supabase.rpc("shared_memory_chat_page", {
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_message_id: cursor?.id ?? null,
        p_limit: limit,
        p_room_id: roomId,
      });
      if (error) throw error;
      const payload = data && typeof data === "object" && !Array.isArray(data) ? data as JsonRecord : {};
      return privateJson({
        ...await signMemoryPhotoPayload(payload, roomId),
        nextCursor: opaqueMemoryCursor(payload.nextCursor),
      });
    }

    if (action === "media") {
      const { data, error } = await supabase.rpc("shared_memory_media_page_v1", {
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_photo_id: cursor?.id ?? null,
        p_limit: limit,
        p_room_id: roomId,
      });
      if (error) throw error;
      const payload = data && typeof data === "object" && !Array.isArray(data) ? data as JsonRecord : {};
      return privateJson({
        ...await signMemoryPhotoPayload(payload, roomId),
        nextCursor: opaqueMemoryCursor(payload.nextCursor),
      });
    }

    return privateJson({ error: "Invalid action" }, { status: 400 });
  } catch {
    console.error("[mobile/memories/read] bounded read failed", { action });
    return privateJson({ error: "Memory deployment contract unavailable" }, { status: 503 });
  }
}
