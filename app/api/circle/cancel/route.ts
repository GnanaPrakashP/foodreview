import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { senderName, receiverName } = await req.json();
  if (!senderName || !receiverName) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  // Delete the pending request
  const { error } = await supabase
    .from("circle_requests")
    .delete()
    .eq("sender_name", senderName)
    .eq("receiver_name", receiverName)
    .eq("status", "pending");

  if (error) {
    console.error("[circle/cancel] delete failed:", error.message, error.code);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Delete the corresponding circle_request notification (clean up receiver's inbox)
  await supabase
    .from("notifications")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("actor_name", senderName)
    .eq("recipient_name", receiverName)
    .in("type", ["circle_request", "CIRCLE_REQUEST_RECEIVED"]);

  return NextResponse.json({ ok: true });
}
