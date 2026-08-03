import { NextRequest } from "next/server";
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
  requireIdempotencyKey,
  type IdempotencyClaim
} from "@/lib/server/api-security";
import { createAdminClient } from "@/lib/supabase/admin";

const METHODS = ["PATCH", "DELETE", "PUT"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACE_NAME_MAX_LENGTH = 240;
const PLACE_NOTE_MAX_LENGTH = 500;
const PLACE_ID_MAX_LENGTH = 300;
const STOP_TYPES = new Set(["restaurant", "cafe", "bar", "bowling", "movie", "activity", "other"]);

type JsonRecord = Record<string, unknown>;

function entityError(req: NextRequest, status: number) {
  if (status === 403) return mobileApiError(req, METHODS, "permanent_denial", "This room action is unavailable", status);
  if (status === 404) return mobileApiError(req, METHODS, "permanent_denial", "Memory room not found", status);
  return mobileApiError(req, METHODS, "temporary_failure", "Unable to update the memory room", status);
}

async function authorizeRoom(req: NextRequest, roomId: string) {
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) return { response: mobileApiError(req, METHODS, "authentication_required", "Authentication required", 401) } as const;
  if (!UUID_PATTERN.test(roomId)) {
    return { response: mobileApiError(req, METHODS, "invalid_input", "Invalid room", 400) } as const;
  }

  const rate = await enforceRateLimit(req, "memory.message", { actorUserId: actor.userId });
  if (!rate.allowed) return { response: rateLimitResponse(req, METHODS, rate) } as const;

  const admin = createAdminClient();
  await assertMemoryRoomMutationAllowed({
    actorName: actor.actorName,
    admin,
    roomId,
    supabase
  });
  return { actor, admin } as const;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;
  try {
    const { roomId } = await context.params;
    const authorization = await authorizeRoom(req, roomId);
    if ("response" in authorization) return authorization.response;

    const parsed = await readBoundedJson<JsonRecord>(req, 8 * 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const body = parsed.value ?? {};
    const stopId = typeof body.stopId === "string" ? body.stopId : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    const stopType = typeof body.stopType === "string" ? body.stopType : "other";
    if (
      body.kind !== "place" ||
      !UUID_PATTERN.test(stopId) ||
      name.length < 1 || name.length > PLACE_NAME_MAX_LENGTH ||
      note.length > PLACE_NOTE_MAX_LENGTH ||
      placeId.length > PLACE_ID_MAX_LENGTH ||
      !STOP_TYPES.has(stopType)
    ) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid place update", 400);
    }

    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) return mobileApiError(req, METHODS, "invalid_input", "A valid idempotency key is required", 400);
    const normalizedRequest = { kind: "place", name, note, placeId, roomId, stopId, stopType };
    const idempotency = await claimIdempotency(req, "memory.place.update", authorization.actor.userId, normalizedRequest);
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data: stop, error } = await authorization.admin
      .from("shared_memory_stops")
      .update({
        name,
        note: note || null,
        place_id: placeId || null,
        stop_type: stopType
      })
      .eq("id", stopId)
      .eq("room_id", roomId)
      .select("id, room_id, stop_type, name, note, place_id, position, created_by, created_at")
      .maybeSingle();
    if (error) throw error;
    if (!stop) {
      await abandonIdempotency(idempotency).catch(() => undefined);
      activeIdempotency = null;
      return mobileApiError(req, METHODS, "permanent_denial", "Place not found", 404);
    }

    const responseBody = { stop };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    return entityError(req, memoryRoomSecurityErrorStatus(error));
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;
  try {
    const { roomId } = await context.params;
    const authorization = await authorizeRoom(req, roomId);
    if ("response" in authorization) return authorization.response;
    const parsed = await readBoundedJson<JsonRecord>(req, 4 * 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const body = parsed.value ?? {};
    const kind = body.kind === "place" || body.kind === "dish" ? body.kind : null;
    const entityId = typeof body.entityId === "string" ? body.entityId : "";
    if (!kind || !UUID_PATTERN.test(entityId)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid delete request", 400);
    }

    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) return mobileApiError(req, METHODS, "invalid_input", "A valid idempotency key is required", 400);
    const normalizedRequest = { entityId, kind, roomId };
    const idempotency = await claimIdempotency(req, `memory.${kind}.delete`, authorization.actor.userId, normalizedRequest);
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const table = kind === "place" ? "shared_memory_stops" : "shared_memory_dishes";
    if (kind === "dish") {
      const { data: dish, error: dishError } = await authorization.admin
        .from("shared_memory_dishes")
        .select("added_by")
        .eq("id", entityId)
        .eq("room_id", roomId)
        .maybeSingle<{ added_by: string }>();
      if (dishError) throw dishError;
      if (!dish) {
        await abandonIdempotency(idempotency).catch(() => undefined);
        activeIdempotency = null;
        return mobileApiError(req, METHODS, "permanent_denial", "Dish not found", 404);
      }
      if (dish.added_by.trim().toLowerCase() !== authorization.actor.actorName.trim().toLowerCase()) {
        await abandonIdempotency(idempotency).catch(() => undefined);
        activeIdempotency = null;
        return mobileApiError(req, METHODS, "permanent_denial", "Only the person who added this dish can delete it", 403);
      }
    }
    const { error } = await authorization.admin
      .from(table)
      .delete()
      .eq("id", entityId)
      .eq("room_id", roomId);
    if (error) throw error;

    const responseBody = { ok: true };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    return entityError(req, memoryRoomSecurityErrorStatus(error));
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;
  try {
    const { roomId } = await context.params;
    const authorization = await authorizeRoom(req, roomId);
    if ("response" in authorization) return authorization.response;
    const parsed = await readBoundedJson<JsonRecord>(req, 4 * 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const body = parsed.value ?? {};
    const dishId = typeof body.dishId === "string" ? body.dishId : "";
    const clientMutationId = typeof body.clientMutationId === "string" ? body.clientMutationId : "";
    const clientSequence = body.clientSequence;
    const rating = body.rating === null ? null : body.rating;
    if (
      body.kind !== "rating" ||
      !UUID_PATTERN.test(dishId) ||
      !UUID_PATTERN.test(clientMutationId) ||
      !Number.isSafeInteger(clientSequence) || (clientSequence as number) < 1 ||
      (rating !== null && (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5))
    ) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid dish rating", 400);
    }
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey || idempotencyKey !== clientMutationId) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid rating identity", 400);
    }

    const normalizedRequest = { clientMutationId, clientSequence, dishId, kind: "rating", rating, roomId };
    const idempotency = await claimIdempotency(req, "memory.dish.rating", authorization.actor.userId, normalizedRequest);
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data, error } = await authorization.admin.rpc("set_shared_memory_dish_rating_v2", {
      p_actor_name: authorization.actor.actorName,
      p_client_mutation_id: clientMutationId,
      p_client_sequence: clientSequence,
      p_dish_id: dishId,
      p_rating: rating,
      p_room_id: roomId
    });
    if (error) throw error;

    const responseBody = { ok: true, rating: data };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    return entityError(req, memoryRoomSecurityErrorStatus(error));
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
