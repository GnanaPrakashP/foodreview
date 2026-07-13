import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";
import { unauthorized } from "@/app/api/notifications/_utils";
import { enforceRateLimit, rateLimitResponse } from "@/lib/server/api-security";

const METHODS = ["POST"];

type CircleRequestRow = {
  id: string;
  sender_name: string;
  receiver_name: string;
  status: "pending" | "accepted" | "rejected";
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { actor } = await getRouteActor(req);
  if (!actor) return unauthorized();
  const rate = await enforceRateLimit(req, "mutation.circle", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  const viewer = { id: actor.userId, name: actor.actorName };

  const admin = createAdminClient();
  const { requestId } = await params;
  const { data: request, error: requestError } = await admin
    .from("circle_requests")
    .select("id, sender_name, receiver_name, status")
    .eq("id", requestId)
    .maybeSingle<CircleRequestRow>();

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 });
  if (!request || request.receiver_name !== viewer.name) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  // Idempotent: already rejected is a success
  if (request.status === "rejected") {
    return NextResponse.json({ ok: true, state: "NONE" });
  }
  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request is no longer pending" }, { status: 409 });
  }

  const { error } = await admin.from("circle_requests").update({ status: "rejected" }).eq("id", requestId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin
    .from("notifications")
    .update({ is_read: true, read: true, updated_at: new Date().toISOString(), metadata: { requestId: request.id, senderName: request.sender_name, receiverName: request.receiver_name, status: "rejected" } })
    .eq("recipient_name", request.receiver_name)
    .eq("actor_name", request.sender_name)
    .in("type", ["circle_request", "CIRCLE_REQUEST_RECEIVED"]);

  return NextResponse.json({ ok: true, state: "NONE" });
}
