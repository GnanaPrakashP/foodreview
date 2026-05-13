import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCircleEdge } from "@/lib/circle-db";
import { createNotificationForNames } from "@/lib/notifications";

function invalidateCircleFeedCacheForNames(names: string[]) {
  const cacheHooks = globalThis as typeof globalThis & {
    __foodReviewInvalidateCircleFeedCacheForNames?: (names: string[]) => void;
    __foodReviewInvalidateMePageCacheForNames?: (names: string[]) => void;
    __foodReviewInvalidatePeoplePageCacheForNames?: (names: string[]) => void;
    __foodReviewInvalidateTrendingPageCacheForNames?: (names: string[]) => void;
  };
  cacheHooks.__foodReviewInvalidateCircleFeedCacheForNames?.(names);
  cacheHooks.__foodReviewInvalidateMePageCacheForNames?.(names);
  cacheHooks.__foodReviewInvalidatePeoplePageCacheForNames?.(names);
  cacheHooks.__foodReviewInvalidateTrendingPageCacheForNames?.(names);
}

export async function POST(req: NextRequest) {
  const { senderName, action } = await req.json();
  if (!senderName || !["accept", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const actor = await getAuthenticatedCircleActor(supabase);
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

  invalidateCircleFeedCacheForNames([me, sender]);
  return NextResponse.json({
    ok: true,
    state: action === "accept" ? "CIRCLE_ONE_WAY" : "NONE",
  });
}
