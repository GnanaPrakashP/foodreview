import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertSafeMemoryStoragePath,
  buildMemoryUploadPath,
  intentExpiresAt,
  mediaLimitResponse,
  normalizeMemoryMediaIntentInput
} from "@/lib/server/memory-media";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import { assertMemoryRoomMutationAllowed, memoryRoomSecurityErrorStatus } from "@/lib/server/memory-room-security";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

function mobileJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...init?.headers
    }
  });
}

function validationMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "room_id_invalid":
      return "Memory room is invalid.";
    case "memory_media_kind_invalid":
      return "Media type is not supported.";
    case "memory_media_mime_type_not_allowed":
      return "Media MIME type is not supported.";
    case "memory_media_extension_not_allowed":
      return "Media file extension is not supported.";
    case "memory_media_file_too_large":
      return "Media file is too large.";
    case "memory_media_resolution_too_large":
      return "Photo resolution is too large.";
    case "memory_media_duration_required":
      return "Media duration is required.";
    case "memory_media_duration_too_long":
      return "Media must be 60 seconds or less.";
    default:
      return "Media upload is not allowed.";
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    let media;
    try {
      media = normalizeMemoryMediaIntentInput({
        durationMs: body?.durationMs ?? body?.duration,
        fileName: body?.fileName,
        fileSizeBytes: body?.fileSizeBytes ?? body?.fileSize,
        height: body?.height ?? body?.imageHeight,
        mediaKind: body?.mediaKind ?? body?.mediaType,
        mimeType: body?.mimeType,
        roomId: body?.roomId,
        width: body?.width ?? body?.imageWidth
      });
    } catch (error) {
      recordMemoryOperation("upload_intent.create", {
        durationMs: memoryOperationDurationMs(startedAt),
        errorKind: memoryErrorKind(error),
        status: "validation_error",
        statusCode: 400
      });
      return mobileJson({ error: validationMessage(error) }, { status: 400 });
    }

    const admin = createAdminClient();
    await assertMemoryRoomMutationAllowed({
      actorName: actor.actorName,
      admin,
      roomId: media.roomId,
      supabase
    });

    const intentId = randomUUID();
    const storagePath = buildMemoryUploadPath({
      extension: media.extension,
      intentId,
      roomId: media.roomId,
      userId: actor.userId
    });
    assertSafeMemoryStoragePath({
      intentId,
      ownerSegment: actor.userId,
      roomId: media.roomId,
      storagePath
    });

    const expiresAt = intentExpiresAt();
    const { error } = await admin
      .from("shared_memory_upload_intents")
      .insert({
        duration_ms: media.durationMs,
        expires_at: expiresAt,
        extension: media.extension,
        file_size_bytes: media.fileSizeBytes,
        id: intentId,
        image_height: media.height,
        image_width: media.width,
        max_file_size_bytes: media.maxBytes,
        media_type: media.kind,
        mime_type: media.mimeType,
        room_id: media.roomId,
        storage_path: storagePath,
        uploader_id: actor.userId,
        uploader_name: actor.actorName
      });

    if (error) throw error;

    recordMemoryOperation("upload_intent.create", {
      durationMs: memoryOperationDurationMs(startedAt),
      mediaKind: media.kind,
      status: "success",
      statusCode: 200
    });
    return mobileJson({
      ...mediaLimitResponse(media.kind),
      expiresAt,
      intentId,
      mediaKind: media.kind,
      mimeType: media.mimeType,
      storagePath
    });
  } catch (error) {
    recordMemoryOperation("upload_intent.create", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: memoryRoomSecurityErrorStatus(error)
    });
    return mobileJson(
      { error: "Unable to create memory media upload intent" },
      { status: memoryRoomSecurityErrorStatus(error) }
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
