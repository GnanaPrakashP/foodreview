import { NextRequest } from "next/server";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  abandonIdempotency,
  boundedJsonError,
  claimIdempotency,
  completeIdempotency,
  enforceRateLimit,
  fetchWithDeadline,
  idempotencyFailure,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson,
} from "@/lib/server/api-security";

type MemoryNotificationKind = "message" | "media" | "dish";
type MemoryBlockRow = {
  blocked_name: string;
  blocker_name: string;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MEMORY_NOTIFICATION_BODY = "You have a new memory update.";
const MEMORY_NOTIFICATION_TITLE = "Table Memory";
const METHODS = ["POST"];

function mobileJson(req: NextRequest, body: unknown, init?: ResponseInit) {
  return mobileApiJson(req, METHODS, body, init);
}

function normalizeKind(value: unknown): MemoryNotificationKind {
  return value === "media" || value === "dish" ? value : "message";
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function blockedCounterpart(row: MemoryBlockRow, actorName: string) {
  if (row.blocker_name === actorName) return row.blocked_name;
  if (row.blocked_name === actorName) return row.blocker_name;
  return "";
}

async function sendExpoPush(messages: Array<Record<string, unknown>>) {
  if (messages.length === 0) return;

  const response = await fetchWithDeadline(EXPO_PUSH_URL, {
    body: JSON.stringify(messages),
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  }, 5_000);

  if (!response.ok) throw new Error(`Expo push send failed with ${response.status}`);
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let activeIdempotency: Extract<Awaited<ReturnType<typeof claimIdempotency>>, { state: "claimed" }> | null = null;
  try {
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileJson(req, { error: "Unauthorized" }, { status: 401 });
    const rate = await enforceRateLimit(req, "notification.memory", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

    const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const body = parsed.value;
    const roomId = normalizeText(body?.roomId, 80);
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return mobileJson(req, { error: "Invalid room" }, { status: 400 });

    const kind = normalizeKind(body?.kind);
    // Ignore preview text/captions; memory notifications stay generic by default.

    const { data: readableMembers, error: membersError } = await supabase
      .from("shared_memory_members")
      .select("user_name")
      .eq("room_id", roomId);

    if (membersError) throw membersError;
    if (!readableMembers?.some((member: { user_name: string }) => member.user_name === actor.actorName)) {
      return mobileJson(req, { error: "Room not found" }, { status: 404 });
    }

    const roomMemberNames = Array.from(new Set(
      readableMembers.map((member: { user_name: string }) => member.user_name).filter(Boolean)
    ));
    const roomMemberSet = new Set(roomMemberNames);
    const recipients = roomMemberNames.filter((username) => username !== actor.actorName);

    if (recipients.length === 0) {
      recordMemoryOperation("memory_notification.send", {
        durationMs: memoryOperationDurationMs(startedAt),
        sent: 0,
        status: "no_recipients",
        statusCode: 200
      });
      return mobileJson(req, { sent: 0 });
    }

    const admin = createAdminClient();
    const { data: blockRows, error: blockError } = await admin
      .from("blocked_users")
      .select("blocker_name, blocked_name")
      .or(`blocker_name.eq.${actor.actorName},blocked_name.eq.${actor.actorName}`)
      .returns<MemoryBlockRow[]>();

    if (blockError) throw blockError;

    const hasBlockedRoomRelationship = (blockRows ?? []).some((row) => {
      const counterpart = blockedCounterpart(row, actor.actorName);
      return counterpart ? roomMemberSet.has(counterpart) : false;
    });

    if (hasBlockedRoomRelationship) {
      recordMemoryOperation("memory_notification.send", {
        durationMs: memoryOperationDurationMs(startedAt),
        sent: 0,
        status: "blocked_relationship",
        statusCode: 200
      });
      return mobileJson(req, { sent: 0 });
    }

    const idempotency = await claimIdempotency(req, "notification.memory", actor.userId, { kind, roomId });
    if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);
    activeIdempotency = idempotency;

    const [
      { data: tokens, error: tokensError },
      { data: prefs, error: prefsError },
      { data: recipientProfiles, error: recipientProfilesError }
    ] = await Promise.all([
      admin
        .from("push_tokens")
        .select("expo_push_token, user_name")
        .in("user_name", recipients),
      admin
        .from("notification_settings")
        .select("user_name, push_enabled, memory_activity")
        .in("user_name", recipients),
      admin
        .from("profiles")
        .select("id, username")
        .in("username", recipients)
    ]);

    if (tokensError) throw tokensError;
    if (prefsError) throw prefsError;
    if (recipientProfilesError) throw recipientProfilesError;
    const recipientUserIds = new Map(
      (recipientProfiles ?? []).map((profile: { id: string; username: string }) => [profile.username, profile.id])
    );

    // Respect each recipient's notification preferences. Missing rows default to
    // enabled, so users who never opened settings still receive notifications.
    const mutedRecipients = new Set(
      ((prefs ?? []) as Array<{ user_name: string; push_enabled: boolean; memory_activity: boolean }>)
        .filter((pref) => !pref.push_enabled || !pref.memory_activity)
        .map((pref) => pref.user_name)
    );

    const pushMessages = (tokens ?? []).slice(0, 100)
      .filter((token: { expo_push_token: string; user_name: string }) => !mutedRecipients.has(token.user_name))
      .filter((token: { expo_push_token: string; user_name: string }) => Boolean(token.expo_push_token))
      .map((token: { expo_push_token: string; user_name: string }) => ({
        body: MEMORY_NOTIFICATION_BODY,
        data: {
          kind,
          recipientName: token.user_name,
          recipientUserId: recipientUserIds.get(token.user_name),
          roomId,
          type: "table-memory"
        },
        sound: "default",
        title: MEMORY_NOTIFICATION_TITLE,
        to: token.expo_push_token
      }));

    await sendExpoPush(pushMessages);
    recordMemoryOperation("memory_notification.send", {
      durationMs: memoryOperationDurationMs(startedAt),
      sent: pushMessages.length,
      status: "success",
      statusCode: 200
    });
    const responseBody = { sent: pushMessages.length };
    await completeIdempotency(idempotency, 200, responseBody);
    activeIdempotency = null;
    return mobileJson(req, responseBody);
  } catch (error) {
    if (activeIdempotency) await abandonIdempotency(activeIdempotency).catch(() => undefined);
    recordMemoryOperation("memory_notification.send", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: 500
    });
    return mobileJson(req, { error: "Unable to send memory notification" }, { status: 500 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
