import { NextResponse } from "next/server";
import { getPeoplePageData } from "@/lib/people-page-data";
import { createRouteSupabase } from "@/app/api/notifications/_utils";

export async function GET() {
  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";

    const data = await getPeoplePageData(supabase, myName);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[people] failed to load:", error);
    return NextResponse.json({ error: "Unable to load people" }, { status: 500 });
  }
}
