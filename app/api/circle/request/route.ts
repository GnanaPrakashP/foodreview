import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { addCircleEdge, addMutualCircleEdges, getAccountTypeForName, hasCircleEdge } from "@/lib/circle-db";

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
    type: "circle_request" | "circle_accepted" | "circle_added";
  }
) {
  const { error } = await supabase.from("notifications").insert({
    ...notification,
    post_id: null,
  });

  if (error) {
    // Circle membership is the source of truth. Notification schema drift should
    // not make the Add button fail.
    console.error("[circle/request] notification insert failed:", error.message, error.code, error.details);
  }
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
        type: "circle_accepted",
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
      type: "circle_accepted",
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
      type: "circle_added",
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

  if (existing) {
    if (existing.status === "accepted") {
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return circleError("failed to restore accepted circle request", error);
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
    if (existing.status === "pending") {
      return NextResponse.json({ status: "pending", state: "PENDING" });
    }

    const { error } = await supabase
      .from("circle_requests")
      .update({ status: "pending" })
      .eq("id", existing.id);

    if (error) return circleError("failed to reopen circle request", error);
  } else {
    const { error } = await supabase
      .from("circle_requests")
      .insert({ sender_name: sender, receiver_name: receiver, status: "pending" });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ status: "pending", state: "PENDING" });
      }
      return circleError("failed to create circle request", error);
    }
  }

  // Notify the receiver
  await createCircleNotification(supabase, {
    recipient_name: receiver,
    actor_name: sender,
    type: "circle_request",
  });

  return NextResponse.json({ status: "pending", state: "PENDING" });
}
