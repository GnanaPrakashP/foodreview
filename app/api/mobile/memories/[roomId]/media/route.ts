import { NextRequest } from "next/server";
import { MEMORY_MEDIA_BUCKET } from "@/lib/memory-media-policy";
import { apiLogger } from "@/lib/observability/server";
import { recordAccountMediaCleanupJob } from "@/lib/server/account-media-cleanup";
import { signMemoryPhotoPayload } from "@/lib/server/memory-media-delivery";
import {
  assertMemoryRoomMutationAllowed,
  memoryRoomSecurityErrorStatus
} from "@/lib/server/memory-room-security";
import { getRouteActor } from "@/lib/server/route-supabase";
import {
  abandonIdempotency,
  boundedJsonError,
  claimIdempotency,
  completeIdempotency,
  enforceRateLimit,
  idempotencyFailure,
  mobileApiError,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson,
  requestCorrelation,
  requireIdempotencyKey,
  type IdempotencyClaim
} from "@/lib/server/api-security";
import { createAdminClient } from "@/lib/supabase/admin";

const METHODS = ["POST", "DELETE"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_TEXT_MAX_LENGTH = 1000;
const MAX_MEDIA_ITEMS = 10;
const MAX_DELETE_ITEMS = 100;

type JsonRecord = Record<string, unknown>;

const SAFE_MEDIA_FAILURE_LABEL = /^(?:memory_media|shared_memory)_[a-z0-9_]+$/;
const SAFE_DATABASE_ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;

function logRoomMediaFailure(req: NextRequest, error: unknown) {
  const record = error && typeof error === "object" ? error as JsonRecord : {};
  const message = typeof record.message === "string" ? record.message : error instanceof Error ? error.message : "";
  const code = typeof record.code === "string" && SAFE_DATABASE_ERROR_CODE.test(record.code)
    ? record.code
    : "unknown";
  const failureReason = SAFE_MEDIA_FAILURE_LABEL.test(message) ? message : "unknown";
  apiLogger.error("memory_media_attach_failed", new Error(failureReason), {
    correlation_id: requestCorrelation(req).requestId,
    database_error_code: code,
    failure_reason: failureReason
  });
}

function parseClientMetadata(body: JsonRecord, idempotencyKey: string) {
  const clientCreatedAt = typeof body.clientCreatedAt === "string" ? body.clientCreatedAt : "";
  const clientCreatedTime = Date.parse(clientCreatedAt);
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const clientOrderKey = typeof body.clientOrderKey === "string" ? body.clientOrderKey : "";
  const clientSequence = body.clientSequence;
  if (
    clientId !== idempotencyKey ||
    !Number.isFinite(clientCreatedTime) ||
    clientCreatedTime > Date.now() + 5 * 60_000 ||
    !Number.isSafeInteger(clientSequence) ||
    (clientSequence as number) < 0 ||
    clientOrderKey.length < 16 ||
    clientOrderKey.length > 200 ||
    !/^[\x20-\x7E]+$/.test(clientOrderKey) ||
    !clientOrderKey.endsWith(`:${clientId}`)
  ) return null;
  return { clientCreatedAt, clientId, clientOrderKey, clientSequence: clientSequence as number };
}

function uuidArray(value: unknown, limit: number) {
  if (!Array.isArray(value) || value.length > limit) return null;
  const ids = Array.from(new Set(
    value.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item))
  ));
  return ids.length === value.length ? ids : null;
}

function roomMediaError(req: NextRequest, status: number) {
  if (status === 403) return mobileApiError(req, METHODS, "permanent_denial", "Room media is unavailable", status);
  if (status === 404) return mobileApiError(req, METHODS, "permanent_denial", "Memory room not found", status);
  return mobileApiError(req, METHODS, "temporary_failure", "Unable to update room media", status);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;
  try {
    const { roomId } = await context.params;
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileApiError(req, METHODS, "authentication_required", "Authentication required", 401);
    if (!UUID_PATTERN.test(roomId)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid room", 400);
    }

    const rate = await enforceRateLimit(req, "memory.message", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
    const parsed = await readBoundedJson<JsonRecord>(req, 16 * 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);

    const requestBody = parsed.value ?? {};
    const assetIds = uuidArray(requestBody.assetIds, MAX_MEDIA_ITEMS);
    const body = typeof requestBody.body === "string" ? requestBody.body.trim() : "";
    const rawReplyId = requestBody.replyToMessageId;
    const replyToMessageId = rawReplyId == null || rawReplyId === ""
      ? null
      : typeof rawReplyId === "string" && UUID_PATTERN.test(rawReplyId)
        ? rawReplyId
        : undefined;
    const clientId = requireIdempotencyKey(req);
    const clientMetadata = clientId ? parseClientMetadata(requestBody, clientId) : null;
    if (
      !assetIds ||
      assetIds.length < 1 ||
      body.length > MEMORY_TEXT_MAX_LENGTH ||
      replyToMessageId === undefined ||
      !clientId ||
      !clientMetadata
    ) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid room media", 400);
    }

    const admin = createAdminClient();
    await assertMemoryRoomMutationAllowed({
      actorName: actor.actorName,
      admin,
      roomId,
      supabase
    });

    const normalizedRequest = { assetIds, body, ...clientMetadata, replyToMessageId, roomId };
    const idempotency = await claimIdempotency(req, "memory.media.attach", actor.userId, normalizedRequest);
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data, error } = await admin.rpc("attach_shared_memory_media_assets_v2", {
      p_asset_ids: assetIds,
      p_body: body,
      p_client_created_at: clientMetadata.clientCreatedAt,
      p_client_id: clientId,
      p_client_order_key: clientMetadata.clientOrderKey,
      p_client_sequence: clientMetadata.clientSequence,
      p_owner_id: actor.userId,
      p_owner_name: actor.actorName,
      p_reply_to_message_id: replyToMessageId,
      p_room_id: roomId
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw error ?? new Error("memory_media_attach_failed");

    const responseBody = await signMemoryPhotoPayload(data as JsonRecord, roomId);
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    logRoomMediaFailure(req, error);
    return roomMediaError(req, memoryRoomSecurityErrorStatus(error));
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;
  try {
    const { roomId } = await context.params;
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileApiError(req, METHODS, "authentication_required", "Authentication required", 401);
    if (!UUID_PATTERN.test(roomId)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid room", 400);
    }

    const rate = await enforceRateLimit(req, "memory.message", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
    const parsed = await readBoundedJson<JsonRecord>(req, 16 * 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);

    const requestBody = parsed.value ?? {};
    const messageIds = uuidArray(requestBody.messageIds ?? [], MAX_DELETE_ITEMS);
    const photoIds = uuidArray(requestBody.photoIds ?? [], MAX_DELETE_ITEMS);
    if (!messageIds || !photoIds || messageIds.length + photoIds.length < 1 || messageIds.length + photoIds.length > MAX_DELETE_ITEMS) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid delete selection", 400);
    }

    const admin = createAdminClient();
    await assertMemoryRoomMutationAllowed({
      actorName: actor.actorName,
      admin,
      roomId,
      supabase
    });

    const normalizedRequest = {
      messageIds: [...messageIds].sort(),
      photoIds: [...photoIds].sort(),
      roomId
    };
    const idempotency = await claimIdempotency(req, "memory.media.delete", actor.userId, normalizedRequest);
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data, error } = await admin.rpc("delete_shared_memory_media_items_v1", {
      p_message_ids: messageIds,
      p_owner_id: actor.userId,
      p_owner_name: actor.actorName,
      p_photo_ids: photoIds,
      p_room_id: roomId
    });
    if (error) throw error;

    const legacyPaths = data && typeof data === "object" && !Array.isArray(data) && Array.isArray((data as JsonRecord).legacyPaths)
      ? (data as JsonRecord).legacyPaths as unknown[]
      : [];
    const safeLegacyPaths = legacyPaths.filter((path): path is string => (
      typeof path === "string" &&
      path.startsWith(`memories/${roomId}/`) &&
      !path.includes("..") &&
      !path.includes("?") &&
      !path.includes("#")
    ));
    if (safeLegacyPaths.length > 0) {
      const { error: removeError } = await admin.storage.from(MEMORY_MEDIA_BUCKET).remove(safeLegacyPaths);
      if (removeError) {
        await recordAccountMediaCleanupJob(admin, {
          bucketId: MEMORY_MEDIA_BUCKET,
          error: removeError,
          ownerNames: [actor.actorName],
          paths: safeLegacyPaths,
          userId: actor.userId
        }).catch(() => undefined);
      }
    }

    const responseBody = { ok: true };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    return roomMediaError(req, memoryRoomSecurityErrorStatus(error));
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
