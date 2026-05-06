import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { addCircleEdge, addMutualCircleEdges, getAccountTypeForName, hasCircleEdge } from "@/lib/circle-db";
import { createNotificationForNames, upsertCircleRequestNotification } from "@/lib/notifications";

type CircleSupabaseClient = ReturnType<typeof createServerClient>;

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
    type: "CIRCLE_REQUEST_RECEIVED" | "CIRCLE_REQUEST_ACCEPTED" | "ADDED_TO_CIRCLE" | "MUTUAL_CIRCLE_CREATED";
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
  const { senderName, receiverName } = await req.json();
  if (!senderName?.trim() || !receiverName?.trim() || senderName === receiverName) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sender = senderName.trim();
  const receiver = receiverName.trim();

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const senderAlreadyInReceiverCircle = await hasCircleEdge(supabase, receiver, sender);
  const receiverAlreadyInSenderCircle = await hasCircleEdge(supabase, sender, receiver);

  if (senderAlreadyInReceiverCircle) {
    return NextResponse.json({
      status: receiverAlreadyInSenderCircle ? "accepted" : "one_way",
      state: receiverAlreadyInSenderCircle ? "CIRCLE_MUTUAL" : "CIRCLE_ONE_WAY",
    });
  }

  // If the other person already sent a request to me, auto-accept it
  const { data: reverseRows, error: reverseError } = await supabase
    .from("circle_requests")
    .select("id, status")
    .eq("sender_name", receiver)
    .eq("receiver_name", sender)
    .order("created_at", { ascending: false })
    .limit(1);

  if (reverseError) return circleError("failed to read reverse circle request", reverseError);
  const reverse = reverseRows?.[0];

  if (reverse) {
    if (reverse.status === "accepted") {
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return circleError("failed to restore accepted reverse circle request", error);
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
    if (reverse.status === "pending") {
      const { error: requestError } = await supabase.from("circle_requests").update({ status: "accepted" }).eq("id", reverse.id);
      if (requestError) return circleError("failed to accept reverse circle request", requestError);
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return circleError("failed to create mutual circle edges", error);
      await createCircleNotification(supabase, {
        recipient_name: receiver,
        actor_name: sender,
        type: "CIRCLE_REQUEST_ACCEPTED",
        message: `${sender} accepted your circle request`,
        requestId: reverse.id,
      });
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
  }

  if (receiverAlreadyInSenderCircle) {
    const { error } = await addCircleEdge(supabase, receiver, sender);
    if (error) return circleError("failed to complete existing one-way circle", error);
    await createCircleNotification(supabase, {
      recipient_name: receiver,
      actor_name: sender,
      type: "MUTUAL_CIRCLE_CREATED",
      message: `You and ${sender} are now in each other's circles`,
    });
    return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
  }

  const receiverAccountType = await getAccountTypeForName(supabase, receiver);
  if (receiverAccountType === "public") {
    const { error } = await addCircleEdge(supabase, receiver, sender);
    if (error) return circleError("failed to add sender to public account circle", error);
    await createCircleNotification(supabase, {
      recipient_name: receiver,
      actor_name: sender,
      type: "ADDED_TO_CIRCLE",
      message: `${sender} joined your circle`,
    });
    await createCircleNotification(supabase, {
      recipient_name: sender,
      actor_name: receiver,
      type: "CIRCLE_REQUEST_ACCEPTED",
      message: `You joined ${receiver}'s circle`,
    });
    return NextResponse.json({ status: "one_way", state: "CIRCLE_ONE_WAY" });
  }

  // Check if I already sent one
  const { data: existingRows, error: existingError } = await supabase
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
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return circleError("failed to restore accepted circle request", error);
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
    if (existing.status === "pending") {
      await createCircleNotification(supabase, {
        recipient_name: receiver,
        actor_name: sender,
        type: "CIRCLE_REQUEST_RECEIVED",
        message: `${sender} requested to join your circle`,
        requestId,
      });
      return NextResponse.json({ status: "pending", state: "PENDING" });
    }

    const { error } = await supabase
      .from("circle_requests")
      .update({ status: "pending" })
      .eq("id", existing.id);

    if (error) return circleError("failed to reopen circle request", error);
  } else {
    const { data: createdRequest, error } = await supabase
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
  await createCircleNotification(supabase, {
    recipient_name: receiver,
    actor_name: sender,
    type: "CIRCLE_REQUEST_RECEIVED",
    message: `${sender} requested to join your circle`,
    requestId,
  });

  return NextResponse.json({ status: "pending", state: "PENDING" });
}
