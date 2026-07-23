import { NextRequest } from "next/server";
import { createNotificationForNames } from "@/lib/notifications";
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
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const OCCASION_TYPES = new Set([
  "date_night",
  "friends_hangout",
  "birthday",
  "family_time",
  "work_meal",
  "celebration",
  "solo",
  "casual",
  "unknown"
]);

type CreateMemoryBody = {
  area?: unknown;
  occasion?: unknown;
  occasionConfidence?: unknown;
  occasionConfirmedByUser?: unknown;
  occasionType?: unknown;
  participantUsernames?: unknown;
  restaurantId?: unknown;
  restaurantName?: unknown;
  sourcePostId?: unknown;
  themeKey?: unknown;
  visitDate?: unknown;
};

type InviteRow = {
  id: string;
  receiver_name: string;
};

type MemberRow = {
  user_name: string;
};

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximum);
}

function normalizedUsernames(value: unknown, actorName: string) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const normalized = value.map((item) => boundedText(item, 24).replace(/^@+/, "").toLowerCase());
  if (normalized.some((item) => !USERNAME_PATTERN.test(item))) return null;
  return Array.from(new Set(normalized.filter((item) => item !== actorName))).slice(0, 20);
}

function isMissingCreationContract(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST202" || message.includes("create_shared_memory_room_with_invites");
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let activeIdempotency: Extract<IdempotencyClaim, { state: "claimed" }> | null = null;

  try {
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileApiError(req, METHODS, "authentication_required", "Authentication required", 401);

    const rate = await enforceRateLimit(req, "memory.participant", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

    const parsed = await readBoundedJson<CreateMemoryBody>(req, 4096);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const body = parsed.value ?? {};

    const restaurantName = boundedText(body.restaurantName, 160);
    const restaurantId = boundedText(body.restaurantId, 256) || null;
    const area = boundedText(body.area, 160) || null;
    const occasion = boundedText(body.occasion, 80) || null;
    const occasionType = boundedText(body.occasionType, 32) || "unknown";
    const themeKey = boundedText(body.themeKey, 80) || "default-memory-v1";
    const visitDate = boundedText(body.visitDate, 10) || null;
    const sourcePostId = boundedText(body.sourcePostId, 36) || null;
    const participantUsernames = normalizedUsernames(body.participantUsernames, actor.actorName);
    const rawConfidence = Number(body.occasionConfidence ?? 0);
    const occasionConfidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(rawConfidence, 1)) : 0;

    if (!restaurantName || !OCCASION_TYPES.has(occasionType) || !participantUsernames) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid memory details", 400);
    }
    if (visitDate && !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid visit date", 400);
    }
    if (sourcePostId && !UUID_PATTERN.test(sourcePostId)) {
      return mobileApiError(req, METHODS, "invalid_input", "Invalid source post", 400);
    }

    const admin = createAdminClient();
    if (participantUsernames.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("username")
        .in("username", participantUsernames);
      if (profilesError) throw profilesError;
      const foundNames = new Set((profiles ?? []).map((profile: { username: string }) => profile.username));
      const notFound = participantUsernames.filter((username) => !foundNames.has(username));
      if (notFound.length > 0) {
        return mobileApiError(req, METHODS, "invalid_input", `No user found for @${notFound[0]}`, 400);
      }
    }

    const normalizedRequest = {
      area,
      occasion,
      occasionConfidence,
      occasionConfirmedByUser: body.occasionConfirmedByUser === true,
      occasionType,
      participantUsernames,
      restaurantId,
      restaurantName,
      sourcePostId,
      themeKey,
      visitDate
    };
    const idempotency = await claimIdempotency(req, "memory.room.create", actor.userId, normalizedRequest);
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const { data: room, error: roomError } = await supabase
      .rpc("create_shared_memory_room_with_invites", {
        p_area: area,
        p_occasion_confidence: occasionConfidence,
        p_occasion_confirmed_by_user: body.occasionConfirmedByUser === true,
        p_occasion_type: occasionType,
        p_participant_usernames: participantUsernames,
        p_restaurant_id: restaurantId,
        p_restaurant_name: restaurantName,
        p_source_post_id: sourcePostId,
        p_theme_key: themeKey,
        p_title: occasion,
        p_visit_date: visitDate
      })
      .select("id")
      .single<{ id: string }>();

    if (roomError) {
      if (isMissingCreationContract(roomError)) {
        const contractError = new Error("memory_creation_contract_unavailable");
        contractError.name = "MemoryCreationContractUnavailable";
        throw contractError;
      }
      throw roomError;
    }

    const roomId = room.id;
    let memberRows: MemberRow[] = [];
    let inviteRows: InviteRow[] = [];
    if (participantUsernames.length > 0) {
      const [membersResult, invitesResult] = await Promise.all([
        admin
          .from("shared_memory_members")
          .select("user_name")
          .eq("room_id", roomId)
          .in("user_name", participantUsernames)
          .returns<MemberRow[]>(),
        admin
          .from("shared_memory_invites")
          .select("id, receiver_name")
          .eq("room_id", roomId)
          .eq("status", "pending")
          .in("receiver_name", participantUsernames)
          .returns<InviteRow[]>()
      ]);
      if (membersResult.error) throw membersResult.error;
      if (invitesResult.error) throw invitesResult.error;
      memberRows = membersResult.data ?? [];
      inviteRows = invitesResult.data ?? [];
    }

    const added = memberRows.map((member) => member.user_name);
    const invited = inviteRows.map((invite) => invite.receiver_name);
    const handledNames = new Set([...added, ...invited]);
    const blocked = participantUsernames.filter((username) => !handledNames.has(username));

    await Promise.all([
      ...added.map((recipientName) => createNotificationForNames(admin, {
        recipientName,
        actorName: actor.actorName,
        type: "TABLE_MEMORY_ADDED",
        title: "Table Memory",
        message: "You were added to a Table Memory.",
        entityType: "TABLE_MEMORY",
        entityId: roomId,
        metadata: { status: "added" },
        dedupe: true,
        push: true
      })),
      ...inviteRows.map((invite) => createNotificationForNames(admin, {
        recipientName: invite.receiver_name,
        actorName: actor.actorName,
        type: "TABLE_MEMORY_INVITE",
        title: "Table Memory",
        message: "You have a new memory room invite.",
        entityType: "TABLE_MEMORY",
        entityId: roomId,
        metadata: { inviteId: invite.id, status: "pending" },
        dedupe: true,
        push: true
      }))
    ]);

    const responseBody = { added, alreadyMembers: [] as string[], blocked, id: roomId, invited, notFound: [] as string[] };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    recordMemoryOperation("memory_room.create", {
      durationMs: memoryOperationDurationMs(startedAt),
      status: "success",
      statusCode: 200
    });
    return mobileApiJson(req, METHODS, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    const contractUnavailable = error instanceof Error && error.name === "MemoryCreationContractUnavailable";
    const statusCode = contractUnavailable ? 503 : 500;
    recordMemoryOperation("memory_room.create", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode
    });
    return mobileApiError(
      req,
      METHODS,
      "temporary_failure",
      contractUnavailable ? "Memory invitations are not available yet" : "Unable to create Table Memory",
      statusCode
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
