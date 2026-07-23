import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
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
  type IdempotencyClaim
} from "@/lib/server/api-security";

const METHODS = ["POST"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InviteResponseBody = {
  action?: unknown;
};

type InviteResponseRow = {
  room_id: string;
  status: "accepted" | "declined";
};

function responseError(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  if (error?.code === "PGRST202" || message.includes("respond_to_shared_memory_invite")) {
    return { code: "temporary_failure" as const, message: "Memory invitations are not available yet", status: 503 };
  }
  if (error?.code === "P0002" || message.includes("memory_invite_not_found")) {
    return { code: "permanent_denial" as const, message: "Invitation not found", status: 404 };
  }
  if (error?.code === "42501" || message.includes("memory_invite_blocked_relationship")) {
    return { code: "permanent_denial" as const, message: "This invitation can no longer be accepted", status: 403 };
  }
  if (message.includes("memory_invite_no_longer_pending")) {
    return { code: "operation_in_progress" as const, message: "Invitation is no longer pending", status: 409 };
  }
  return { code: "temporary_failure" as const, message: "Unable to update invitation", status: 500 };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ inviteId: string }> }
) {
  const startedAt = Date.now();
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;

  try {
    const { inviteId } = await context.params;
    if (!UUID_PATTERN.test(inviteId)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid invitation", 400);
    }

    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileApiError(req, METHODS, "authentication_required", "Authentication required", 401);

    const rate = await enforceRateLimit(req, "memory.participant", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

    const parsed = await readBoundedJson<InviteResponseBody>(req, 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const action = typeof parsed.value?.action === "string" ? parsed.value.action.trim().toLowerCase() : "";
    if (action !== "join" && action !== "decline") {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid invitation response", 400);
    }

    const idempotency = await claimIdempotency(req, "memory.invite.respond", actor.userId, { action, inviteId });
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data, error } = await supabase
      .rpc("respond_to_shared_memory_invite", {
        p_action: action,
        p_invite_id: inviteId
      })
      .single<InviteResponseRow>();

    if (error || !data) {
      const mapped = responseError(error);
      await abandonIdempotency(idempotency).catch(() => undefined);
      activeIdempotency = null;
      recordMemoryOperation("memory_invite.respond", {
        durationMs: memoryOperationDurationMs(startedAt),
        errorKind: memoryErrorKind(error),
        status: "rejected",
        statusCode: mapped.status
      });
      return mobileApiError(req, METHODS, mapped.code, mapped.message, mapped.status);
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { error: notificationError } = await admin
      .from("notifications")
      .update({
        is_read: true,
        read: true,
        updated_at: now,
        metadata: {
          inviteId,
          status: data.status
        }
      })
      .eq("recipient_name", actor.actorName)
      .eq("type", "TABLE_MEMORY_INVITE")
      .eq("entity_type", "TABLE_MEMORY")
      .eq("entity_id", data.room_id);

    if (notificationError) throw notificationError;

    const responseBody = {
      ok: true as const,
      roomId: data.room_id,
      status: data.status
    };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    recordMemoryOperation("memory_invite.respond", {
      durationMs: memoryOperationDurationMs(startedAt),
      status: "success",
      statusCode: 200
    });
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    recordMemoryOperation("memory_invite.respond", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: 500
    });
    return mobileApiError(req, METHODS, "temporary_failure", "Unable to update invitation", 500);
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
