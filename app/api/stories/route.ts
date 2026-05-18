import { NextRequest, NextResponse } from "next/server";
import { createStory, getStoriesPage } from "@/lib/stories";
import { createRouteSupabase } from "@/lib/server/route-supabase";

export async function GET() {
  const supabase = await createRouteSupabase();

  try {
    const page = await getStoriesPage(supabase);
    if (!page.myName) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(page);
  } catch (error) {
    console.error("[stories] failed to load stories:", error);
    return NextResponse.json({ error: "Unable to load stories" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createRouteSupabase();
  const body = await req.json().catch(() => ({}));

  try {
    const story = await createStory(supabase, body);
    return NextResponse.json(story);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create story";
    const status = message === "Authentication required" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
