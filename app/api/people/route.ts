import { NextRequest, NextResponse } from "next/server";
import { getPeoplePageData } from "@/lib/people-page-data";
import { createRouteSupabase } from "@/lib/server/route-supabase";

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createRouteSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
    const limit = parseNumber(req.nextUrl.searchParams.get("limit"), 48);

    const data = await getPeoplePageData(supabase, myName, { limit });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[people] failed to load:", error);
    return NextResponse.json({ error: "Unable to load people" }, { status: 500 });
  }
}
