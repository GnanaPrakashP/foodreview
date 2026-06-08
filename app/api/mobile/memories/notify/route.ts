import { NextRequest, NextResponse } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

type MemoryNotificationKind = "message" | "media" | "dish";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
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

function normalizeKind(value: unknown): MemoryNotificationKind {
  return value === "media" || value === "dish" ? value : "message";
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function notificationBody(kind: MemoryNotificationKind, preview: string) {
  if (kind === "media") return preview || "Added photos to the table memory.";
  if (kind === "dish") return preview ? `Added ${preview}` : "Added a dish to the table memory.";
  return preview || "Sent a message.";
}

async function sendExpoPush(messages: Array<Record<string, unknown>>) {
  if (messages.length === 0) return;

  const response = await fetch(EXPO_PUSH_URL, {
    body: JSON.stringify(messages),
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) throw new Error(`Expo push send failed with ${response.status}`);
}

export async function POST(req: NextRequest) {
  try {
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const roomId = normalizeText(body?.roomId, 80);
    if (!roomId) return mobileJson({ error: "roomId is required" }, { status: 400 });

    const kind = normalizeKind(body?.kind);
    const preview = normalizeText(body?.preview, 140);

    const { data: readableMembers, error: membersError } = await supabase
      .from("shared_memory_members")
      .select("user_name")
      .eq("room_id", roomId);

    if (membersError) throw membersError;
    if (!readableMembers?.some((member: { user_name: string }) => member.user_name === actor.actorName)) {
      return mobileJson({ error: "Room not found" }, { status: 404 });
    }

    const recipients = Array.from(new Set(
      readableMembers
        .map((member: { user_name: string }) => member.user_name)
        .filter((username: string) => username && username !== actor.actorName)
    ));

    if (recipients.length === 0) return mobileJson({ sent: 0 });

    const admin = createAdminClient();
    const [{ data: room }, { data: tokens, error: tokensError }] = await Promise.all([
      admin
        .from("shared_memory_rooms")
        .select("restaurant_name")
        .eq("id", roomId)
        .maybeSingle<{ restaurant_name: string | null }>(),
      admin
        .from("push_tokens")
        .select("expo_push_token, user_name")
        .in("user_name", recipients)
    ]);

    if (tokensError) throw tokensError;

    const restaurantName = room?.restaurant_name?.trim();
    const title = restaurantName
      ? `${actor.displayName} at ${restaurantName}`
      : `${actor.displayName} shared a table memory`;

    const pushMessages = (tokens ?? [])
      .map((token: { expo_push_token: string; user_name: string }) => token.expo_push_token)
      .filter(Boolean)
      .map((to: string) => ({
        body: notificationBody(kind, preview),
        data: {
          kind,
          roomId,
          type: "table-memory"
        },
        sound: "default",
        title,
        to
      }));

    await sendExpoPush(pushMessages);
    return mobileJson({ sent: pushMessages.length });
  } catch (error) {
    console.error("[mobile memories notify] failed:", error);
    return mobileJson({ error: "Unable to send memory notification" }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
