import { NextResponse } from "next/server";
import { getTrendingPageData } from "@/lib/trending-page-data";
import { createRouteSupabase } from "@/lib/server/route-supabase";

export async function GET() {
  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
    const data = await getTrendingPageData(supabase, myName);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[trending] failed to load:", error);
    return NextResponse.json({ error: "Unable to load trending" }, { status: 500 });
  }
}
