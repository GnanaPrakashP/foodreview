import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCircleEdge, getAccountTypeForName, hasCircleEdge } from "@/lib/circle-db";
import { createNotificationForNames, upsertCircleRequestNotification } from "@/lib/notifications";

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

type CircleSupabaseClient = { from: (table: string) => any };

function circleError(message: string, error: { message?: string; code?: string; details?: string | null } | null) {
  console.error("[circle/request]", message, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
  });
  return NextResponse.json({ error: error?.message ?? message }, { status: 500 });
}

async function createCircleNotification(
  supabase: CircleSupabaseClient,
  notification: {
    recipient_name: string;
    actor_name: string;
    type: "CIRCLE_REQUEST_RECEIVED" | "ADDED_TO_CIRCLE";
    message: string;
    requestId?: string | null;
  }
) {
  if (notification.type === "CIRCLE_REQUEST_RECEIVED") {
    // Upsert: reuse any existing row (including soft-deleted) for this pair
    // so cancel/resend cycles never accumulate duplicate notification rows.
    await upsertCircleRequestNotification(supabase, {
      recipientName: notification.recipient_name,
      actorName: notification.actor_name,
      message: notification.message,
      requestId: notification.requestId ?? null,
    });
    return;
  }
  await createNotificationForNames(supabase, {
    recipientName: notification.recipient_name,
    actorName: notification.actor_name,
    type: notification.type,
    title: "Circle",
    message: notification.message,
    entityType: "CIRCLE_REQUEST",
    entityId: notification.requestId ?? `${notification.actor_name}:${notification.recipient_name}`,
    metadata: {
      senderName: notification.actor_name,
      receiverName: notification.recipient_name,
      requestId: notification.requestId ?? null,
      status: "accepted",
    },
    dedupe: true,
  });
}

export async function POST(req: NextRequest) {
  try {
    return await handleCircleRequest(req);
  } catch (error) {
    console.error("[circle/request] unhandled failure:", error);
    return NextResponse.json({ error: "Unable to update circle request" }, { status: 500 });
  }
}

async function handleCircleRequest(req: NextRequest) {
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

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const actor = await getAuthenticatedCircleActor(supabase);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const admin = createAdminClient();
  const sender = actor.actorName;
  const senderDisplay = actor.displayName;
  const receiver = receiverName.trim();
  if (sender === receiver) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const senderAlreadyInReceiverCircle = await hasCircleEdge(admin, receiver, sender);

  if (senderAlreadyInReceiverCircle) {
    return NextResponse.json({
      status: "one_way",
      state: "CIRCLE_ONE_WAY",
    });
  }

  const receiverAccountType = await getAccountTypeForName(admin, receiver);
  if (receiverAccountType === "public") {
    const { error } = await addCircleEdge(admin, receiver, sender);
    if (error) return circleError("failed to add sender to public account circle", error);

    // Keep request history coherent if the receiver switched account type.
    await admin
      .from("circle_requests")
      .update({ status: "accepted" })
      .eq("sender_name", sender)
      .eq("receiver_name", receiver)
      .eq("status", "pending");

    await createCircleNotification(admin, {
      recipient_name: receiver,
      actor_name: sender,
      type: "ADDED_TO_CIRCLE",
      message: `${senderDisplay} joined your circle`,
    });
    invalidateCircleFeedCacheForNames([sender, receiver]);
    return NextResponse.json({ status: "one_way", state: "CIRCLE_ONE_WAY" });
  }

  // Check if I already sent one
  const { data: existingRows, error: existingError } = await admin
    .from("circle_requests")
    .select("id, status")
    .eq("sender_name", sender)
    .eq("receiver_name", receiver)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) return circleError("failed to read existing circle request", existingError);
  const existing = existingRows?.[0];
  let requestId = existing?.id ?? null;

  if (existing) {
    if (existing.status === "accepted") {
      const { error } = await addCircleEdge(admin, receiver, sender);
      if (error) return circleError("failed to restore accepted circle membership", error);
      invalidateCircleFeedCacheForNames([sender, receiver]);
      return NextResponse.json({ status: "one_way", state: "CIRCLE_ONE_WAY" });
    }
    if (existing.status === "pending") {
      await createCircleNotification(admin, {
        recipient_name: receiver,
        actor_name: sender,
        type: "CIRCLE_REQUEST_RECEIVED",
        message: `${senderDisplay} requested to join your circle`,
        requestId,
      });
      return NextResponse.json({ status: "pending", state: "PENDING" });
    }

    const { error } = await admin
      .from("circle_requests")
      .update({ status: "pending" })
      .eq("id", existing.id);

    if (error) return circleError("failed to reopen circle request", error);
  } else {
    const { data: createdRequest, error } = await admin
      .from("circle_requests")
      .insert({ sender_name: sender, receiver_name: receiver, status: "pending" })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ status: "pending", state: "PENDING" });
      }
      return circleError("failed to create circle request", error);
    }
    requestId = createdRequest?.id ?? null;
  }

  // Notify the receiver
  await createCircleNotification(admin, {
    recipient_name: receiver,
    actor_name: sender,
    type: "CIRCLE_REQUEST_RECEIVED",
    message: `${senderDisplay} requested to join your circle`,
    requestId,
  });

  invalidateCircleFeedCacheForNames([sender, receiver]);
  return NextResponse.json({ status: "pending", state: "PENDING" });
}
