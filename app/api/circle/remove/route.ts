import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { myName, otherName } = await req.json();
  if (!myName || !otherName) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const { error } = await supabase
    .from("circle_memberships")
    .delete()
    .eq("user_name", otherName)
    .eq("member_name", myName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Accepted request rows are historical now, but remove them so old data
  // cannot recreate a mutual edge after both people leave the relationship.
  await supabase
    .from("circle_requests")
    .delete()
    .or(
      `and(sender_name.eq.${myName},receiver_name.eq.${otherName}),and(sender_name.eq.${otherName},receiver_name.eq.${myName})`
    )
    .eq("status", "accepted");

  return NextResponse.json({ ok: true });
}
