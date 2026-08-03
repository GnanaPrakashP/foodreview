import { NextRequest } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import {
  boundedJsonError,
  enforceRateLimit,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson
} from "@/lib/server/api-security";

const METHODS = ["POST"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Compatibility sink for installed clients that still call the former direct
 * Expo push endpoint. Notification creation now happens atomically from the
 * committed database activity trigger, so this route must never send again.
 */
export async function POST(req: NextRequest) {
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "notification.memory", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const roomId = typeof parsed.value?.roomId === "string" ? parsed.value.roomId.trim() : "";
  if (!UUID_PATTERN.test(roomId)) {
    return mobileApiJson(req, METHODS, { error: "Invalid room" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shared_memory_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_name", actor.actorName)
    .maybeSingle<{ id: string }>();
  if (error) return mobileApiJson(req, METHODS, { error: "Unable to verify room" }, { status: 500 });
  if (!data) return mobileApiJson(req, METHODS, { error: "Room not found" }, { status: 404 });

  return mobileApiJson(req, METHODS, { delegated: true, sent: 0 });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
