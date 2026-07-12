import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabase } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabase(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ status: "unauthenticated" }, { status: 401 });

  const { data: profile, error: profileError } = await createAdminClient()
    .from("profiles")
    .select("account_status, deletion_started_at")
    .eq("id", user.id)
    .maybeSingle<{ account_status: string | null; deletion_started_at: string | null }>();
  if (profileError) return NextResponse.json({ status: "unavailable" }, { status: 503 });

  const status = !profile
    ? "missing"
    : profile.account_status === "deleting" || profile.deletion_started_at
      ? "deleting"
      : "active";
  return NextResponse.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
}
