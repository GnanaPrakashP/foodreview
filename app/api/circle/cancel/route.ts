import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { enforceRateLimit, rateLimitResponse } from "@/lib/server/api-security";

const METHODS = ["POST"];

export async function POST(req: NextRequest) {
  let body: { receiverName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { receiverName } = body;
  if (typeof receiverName !== "string" || !receiverName.trim()) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const rate = await enforceRateLimit(req, "mutation.circle", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const admin = createAdminClient();
  const senderName = actor.actorName;
  const receiver = receiverName.trim();
  if (!receiver || receiver === senderName) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Guard: do not silently no-op when the request is already accepted.
  // The caller should use the remove route instead.
  const { data: existing } = await admin
    .from("circle_requests")
    .select("status")
    .eq("sender_name", senderName)
    .eq("receiver_name", receiver)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.status === "accepted") {
    return NextResponse.json(
      { error: "Request already accepted. Use the remove route to leave the circle." },
      { status: 409 }
    );
  }

  // Delete the pending request
  const { error } = await admin
    .from("circle_requests")
    .delete()
    .eq("sender_name", senderName)
    .eq("receiver_name", receiver)
    .eq("status", "pending");

  if (error) {
    console.error("[circle/cancel] delete failed:", error.message, error.code);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Delete the corresponding circle_request notification (clean up receiver's inbox)
  await admin
    .from("notifications")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("actor_name", senderName)
    .eq("recipient_name", receiver)
    .in("type", ["circle_request", "CIRCLE_REQUEST_RECEIVED"]);

  invalidateSocialCachesForNames([senderName, receiver]);
  return NextResponse.json({ ok: true });
}
