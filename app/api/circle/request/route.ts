import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { addCircleEdge, addMutualCircleEdges, getAccountTypeForName, hasCircleEdge } from "@/lib/circle-db";

export async function POST(req: NextRequest) {
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
  const { data: reverse } = await supabase
    .from("circle_requests")
    .select("id, status")
    .eq("sender_name", receiver)
    .eq("receiver_name", sender)
    .maybeSingle();

  if (reverse) {
    if (reverse.status === "accepted") {
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
    if (reverse.status === "pending") {
      await supabase.from("circle_requests").update({ status: "accepted" }).eq("id", reverse.id);
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await supabase.from("notifications").insert({
        recipient_name: receiver,
        actor_name: sender,
        type: "circle_accepted",
        post_id: null,
      });
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
  }

  if (receiverAlreadyInSenderCircle) {
    const { error } = await addCircleEdge(supabase, receiver, sender);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabase.from("notifications").insert({
      recipient_name: receiver,
      actor_name: sender,
      type: "circle_accepted",
      post_id: null,
    });
    return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
  }

  const receiverAccountType = await getAccountTypeForName(supabase, receiver);
  if (receiverAccountType === "public") {
    const { error } = await addCircleEdge(supabase, receiver, sender);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabase.from("notifications").insert({
      recipient_name: receiver,
      actor_name: sender,
      type: "circle_added",
      post_id: null,
    });
    return NextResponse.json({ status: "one_way", state: "CIRCLE_ONE_WAY" });
  }

  // Check if I already sent one
  const { data: existing } = await supabase
    .from("circle_requests")
    .select("id, status")
    .eq("sender_name", sender)
    .eq("receiver_name", receiver)
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") {
      const { error } = await addMutualCircleEdges(supabase, sender, receiver);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ status: "accepted", state: "CIRCLE_MUTUAL" });
    }
    if (existing.status === "pending") {
      return NextResponse.json({ status: "pending", state: "PENDING" });
    }

    const { error } = await supabase
      .from("circle_requests")
      .update({ status: "pending" })
      .eq("id", existing.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("circle_requests")
      .insert({ sender_name: sender, receiver_name: receiver });

    if (error) {
      console.error("[circle/request] insert failed:", error.message, error.code, error.details);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Notify the receiver
  await supabase.from("notifications").insert({
    recipient_name: receiver,
    actor_name: sender,
    type: "circle_request",
    post_id: null,
  });

  return NextResponse.json({ status: "pending", state: "PENDING" });
}
