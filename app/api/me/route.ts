import { NextResponse } from "next/server";
import { getMePageData } from "@/lib/me-page-data";
import { createRouteSupabase } from "@/app/api/notifications/_utils";

export async function GET() {
  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myName = (user.user_metadata?.username as string) || user.email?.split("@")[0] || "";
    const displayName =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      myName;

    if (!myName) return NextResponse.json({ reviews: [], circleMembers: [] });

    const data = await getMePageData(supabase, myName);
    return NextResponse.json({ ...data, myName, displayName });
  } catch (error) {
    console.error("[me] failed to load:", error);
    return NextResponse.json({ error: "Unable to load profile" }, { status: 500 });
  }
}
