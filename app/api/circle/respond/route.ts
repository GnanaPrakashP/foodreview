import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCircleEdge } from "@/lib/circle-db";
import { createNotificationForNames } from "@/lib/notifications";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function POST(req: NextRequest) {
  const { senderName, action } = await req.json();
  if (!senderName || !["accept", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const admin = createAdminClient();
  const me = actor.actorName;
  const meDisplay = actor.displayName;
  const sender = senderName.trim();
  if (!sender || sender === me) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: requestRow } = await admin
    .from("circle_requests")
    .select("id, status")
    .eq("sender_name", sender)
    .eq("receiver_name", me)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Idempotent: already in desired state
  if (requestRow?.status === "accepted" && action === "accept") {
    return NextResponse.json({ ok: true, state: "CIRCLE_ONE_WAY" });
  }
  if (requestRow?.status === "rejected" && action === "reject") {
    return NextResponse.json({ ok: true, state: "NONE" });
  }
  if (requestRow && requestRow.status !== "pending") {
    return NextResponse.json({ error: "Request is no longer pending" }, { status: 409 });
  }
  if (!requestRow) {
    return NextResponse.json({ error: "No pending request found" }, { status: 404 });
  }

  const newStatus = action === "accept" ? "accepted" : "rejected";
  const { error } = await admin
    .from("circle_requests")
    .update({ status: newStatus })
    .eq("sender_name", sender)
    .eq("receiver_name", me)
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (action === "accept") {
    const { error: edgeError } = await addCircleEdge(admin, me, sender);
    if (edgeError) return NextResponse.json({ error: edgeError.message }, { status: 500 });
    await createNotificationForNames(admin, {
      recipientName: sender,
      actorName: me,
      actorDisplayName: meDisplay,
      type: "CIRCLE_REQUEST_ACCEPTED",
      title: "Circle request accepted",
      message: `${meDisplay} accepted your circle request`,
      entityType: "CIRCLE_REQUEST",
      entityId: requestRow?.id ?? `${sender}:${me}`,
      metadata: {
        senderName: sender,
        receiverName: me,
        requestId: requestRow?.id ?? null,
        status: "accepted",
      },
      dedupe: true,
      push: true,
    });
  }

  const now = new Date().toISOString();
  await admin
    .from("notifications")
    .update({
      is_read: true,
      read: true,
      updated_at: now,
      metadata: {
        senderName: sender,
        receiverName: me,
        requestId: requestRow?.id ?? null,
        status: newStatus,
      },
    })
    .eq("recipient_name", me)
    .eq("actor_name", sender)
    .in("type", ["circle_request", "CIRCLE_REQUEST_RECEIVED"]);

  invalidateSocialCachesForNames([me, sender]);
  return NextResponse.json({
    ok: true,
    state: action === "accept" ? "CIRCLE_ONE_WAY" : "NONE",
  });
}
