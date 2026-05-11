import { NextRequest, NextResponse } from "next/server";
import { addCircleEdge } from "@/lib/circle-db";
import { createNotificationForNames } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteSupabase, getNotificationViewer, unauthorized } from "@/app/api/notifications/_utils";

type CircleRequestRow = {
  id: string;
  sender_name: string;
  receiver_name: string;
  status: "pending" | "accepted" | "rejected";
};

export async function POST(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const supabase = await createRouteSupabase();
  const viewer = await getNotificationViewer(supabase);
  if (!viewer?.name) return unauthorized();

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
  // Idempotent: already accepted is a success
  if (request.status === "accepted") {
    return NextResponse.json({ ok: true, state: "CIRCLE_ONE_WAY" });
  }
  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request is no longer pending" }, { status: 409 });
  }

  const { error } = await admin.from("circle_requests").update({ status: "accepted" }).eq("id", requestId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: edgeError } = await addCircleEdge(admin, request.receiver_name, request.sender_name);
  if (edgeError) return NextResponse.json({ error: edgeError.message }, { status: 500 });

  await createNotificationForNames(admin, {
    recipientName: request.sender_name,
    actorName: request.receiver_name,
    type: "CIRCLE_REQUEST_ACCEPTED",
    title: "Circle request accepted",
    message: `${request.receiver_name} accepted your circle request`,
    entityType: "CIRCLE_REQUEST",
    entityId: request.id,
    metadata: { requestId: request.id, senderName: request.sender_name, receiverName: request.receiver_name, status: "accepted" },
    dedupe: true,
  });

  await admin
    .from("notifications")
    .update({ is_read: true, read: true, updated_at: new Date().toISOString(), metadata: { requestId: request.id, senderName: request.sender_name, receiverName: request.receiver_name, status: "accepted" } })
    .eq("recipient_name", request.receiver_name)
    .eq("actor_name", request.sender_name)
    .in("type", ["circle_request", "CIRCLE_REQUEST_RECEIVED"]);

  return NextResponse.json({ ok: true, state: "CIRCLE_ONE_WAY" });
}
