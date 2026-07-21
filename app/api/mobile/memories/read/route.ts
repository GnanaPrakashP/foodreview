import { NextRequest, NextResponse } from "next/server";
import { MEMORY_MEDIA_BUCKET, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS } from "@/lib/memory-media-policy";
import { decodeStableTimestampCursor, encodeStableTimestampCursor } from "@/lib/server/stable-cursor";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

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

function withoutStoredMediaLocation(photo: JsonRecord) {
  const safePhoto = { ...photo };
  delete safePhoto.storage_path;
  delete safePhoto.public_url;
  return safePhoto;
}

function withoutTimelineCursor(room: JsonRecord) {
  const safeRoom = { ...room };
  delete safeRoom.timeline_date;
  return safeRoom;
}

async function signPhotoPayload(payload: JsonRecord, roomId: string) {
  const photos = photosFromPayload(payload);
  const photoIds = Array.from(new Set(
    photos.map((photo) => typeof photo.id === "string" ? photo.id : "").filter((id) => UUID_PATTERN.test(id))
  ));
  if (photoIds.length === 0) {
    return { ...payload, photos: photos.map(withoutStoredMediaLocation) };
  }

  const admin = createAdminClient();
  const { data: storageRows, error: storageError } = await admin
    .from("shared_memory_photos")
    .select("id, storage_path")
    .eq("room_id", roomId)
    .in("id", photoIds)
    .returns<Array<{ id: string; storage_path: string | null }>>();
  if (storageError) throw storageError;

  const paths = Array.from(new Set(
    (storageRows ?? []).map((row) => row.storage_path?.trim() ?? "").filter(Boolean)
  ));
  const { data: signedRows, error: signingError } = paths.length > 0
    ? await admin.storage.from(MEMORY_MEDIA_BUCKET).createSignedUrls(paths, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS)
    : { data: [], error: null };
  if (signingError) throw signingError;

  const pathById = new Map((storageRows ?? []).map((row) => [row.id, row.storage_path]));
  const urlByPath = new Map(
    (signedRows ?? [])
      .filter((row) => row.signedUrl)
      .map((row) => [row.path, row.signedUrl] as const)
  );
  const signedUrlExpiresAt = new Date(Date.now() + MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return {
    ...payload,
    photos: photos.map((photo) => {
      const path = typeof photo.id === "string" ? pathById.get(photo.id) : null;
      const publicUrl = path ? urlByPath.get(path) ?? null : null;
      return {
        ...withoutStoredMediaLocation(photo),
        public_url: publicUrl,
        signed_url_expires_at: publicUrl ? signedUrlExpiresAt : null,
      };
    }),
  };
}

async function signNestedChat(payload: JsonRecord, roomId: string) {
  if (!payload.chat || typeof payload.chat !== "object" || Array.isArray(payload.chat)) return payload;
  return { ...payload, chat: await signPhotoPayload(payload.chat as JsonRecord, roomId) };
}

export async function GET(req: NextRequest) {
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action") ?? "";
  const limit = boundedLimit(req.nextUrl.searchParams.get("limit"), action === "rooms" ? 50 : 30);
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
        ...await signPhotoPayload(payload, roomId),
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
        ...await signPhotoPayload(payload, roomId),
        nextCursor: opaqueMemoryCursor(payload.nextCursor),
      });
    }

    return privateJson({ error: "Invalid action" }, { status: 400 });
  } catch {
    console.error("[mobile/memories/read] bounded read failed", { action });
    return privateJson({ error: "Memory deployment contract unavailable" }, { status: 503 });
  }
}
