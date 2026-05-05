import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { addMutualCircleEdges } from "@/lib/circle-db";

export async function POST(req: NextRequest) {
  const { myName, senderName, action } = await req.json();
  if (!myName || !senderName || !["accept", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const me = myName.trim();
  const sender = senderName.trim();

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const newStatus = action === "accept" ? "accepted" : "rejected";
  const { error } = await supabase
    .from("circle_requests")
    .update({ status: newStatus })
    .eq("sender_name", sender)
    .eq("receiver_name", me)
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (action === "accept") {
    const { error: edgeError } = await addMutualCircleEdges(supabase, me, sender);
    if (edgeError) return NextResponse.json({ error: edgeError.message }, { status: 500 });
    await supabase.from("notifications").insert({
      recipient_name: sender,
      actor_name: me,
      type: "circle_accepted",
      post_id: null,
    });
  }

  return NextResponse.json({
    ok: true,
    state: action === "accept" ? "CIRCLE_MUTUAL" : "NONE",
  });
}
