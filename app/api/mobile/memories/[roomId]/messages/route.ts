import { NextRequest } from "next/server";
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

const METHODS = ["POST"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_TEXT_MAX_LENGTH = 1000;

type CreateMessageBody = {
  body?: unknown;
  replyToMessageId?: unknown;
};

type MessageRow = {
  id: string;
  room_id: string;
  author_name: string;
  body: string;
  reply_to_message_id: string | null;
  created_at: string;
  edited_at: string | null;
};

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

    const parsed = await readBoundedJson<CreateMessageBody>(req, 4096);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const messageBody = typeof parsed.value?.body === "string" ? parsed.value.body.trim() : "";
    const rawReplyId = parsed.value?.replyToMessageId;
    const replyToMessageId = rawReplyId == null || rawReplyId === ""
      ? null
      : typeof rawReplyId === "string" && UUID_PATTERN.test(rawReplyId)
        ? rawReplyId
        : undefined;

    if (!messageBody || messageBody.length > MEMORY_TEXT_MAX_LENGTH || replyToMessageId === undefined) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid message", 400);
    }
    const clientId = requireIdempotencyKey(req);
    if (!clientId) {
      return mobileApiError(req, METHODS, "invalid_input", "A valid idempotency key is required", 400);
    }

    if (replyToMessageId) {
      const { data: reply, error: replyError } = await supabase
        .from("shared_memory_messages")
        .select("id")
        .eq("id", replyToMessageId)
        .eq("room_id", roomId)
        .maybeSingle<{ id: string }>();
      if (replyError) throw replyError;
      if (!reply) return mobileApiError(req, METHODS, "invalid_input", "Invalid reply", 400);
    }

    const normalizedRequest = { body: messageBody, replyToMessageId, roomId };
    const idempotency = await claimIdempotency(req, "memory.message.create", actor.userId, normalizedRequest);
    if (idempotency.state === "in_progress") {
      const { data: existing, error: existingError } = await supabase
        .from("shared_memory_messages")
        .select("id, room_id, author_name, body, reply_to_message_id, created_at, edited_at")
        .eq("author_name", actor.actorName)
        .eq("client_id", clientId)
        .eq("room_id", roomId)
        .maybeSingle<MessageRow>();
      if (existingError) throw existingError;
      if (existing) return mobileApiJson(req, METHODS, { message: existing });
      return idempotencyFailure(req, METHODS, idempotency);
    }
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data: existing, error: existingError } = await supabase
      .from("shared_memory_messages")
      .select("id, room_id, author_name, body, reply_to_message_id, created_at, edited_at")
      .eq("author_name", actor.actorName)
      .eq("client_id", clientId)
      .eq("room_id", roomId)
      .maybeSingle<MessageRow>();
    if (existingError) throw existingError;
    if (existing) {
      if (existing.body !== messageBody || existing.reply_to_message_id !== replyToMessageId) {
        await abandonIdempotency(idempotency);
        activeIdempotency = null;
        return mobileApiError(
          req,
          METHODS,
          "permanent_denial",
          "Idempotency key was reused for a different request",
          409
        );
      }
      const responseBody = { message: existing };
      await completeIdempotency(idempotency, 200, responseBody);
      activeIdempotency = null;
      return mobileApiJson(req, METHODS, responseBody);
    }

    const { data: message, error } = await supabase
      .from("shared_memory_messages")
      .insert({
        author_name: actor.actorName,
        body: messageBody,
        client_id: clientId,
        reply_to_message_id: replyToMessageId,
        room_id: roomId
      })
      .select("id, room_id, author_name, body, reply_to_message_id, created_at, edited_at")
      .single<MessageRow>();
    if (error) throw error;

    const responseBody = { message };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileApiJson(req, METHODS, responseBody);
  } catch {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    return mobileApiError(req, METHODS, "temporary_failure", "Unable to send message", 500);
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
