import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

const VALID_VISIBILITIES = new Set(["public", "circle", "me"]);

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const actor = await getAuthenticatedCircleActor(supabase);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const {
    restaurantName,
    items,
    body: reviewBody,
    visibility = "public",
    photoUrl,
    area,
    restaurantId,
  } = body;

  if (!restaurantName?.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  if (!Array.isArray(items) || items.filter((it: { name?: string }) => it?.name?.trim()).length === 0) {
    return NextResponse.json({ error: "At least one dish is required" }, { status: 400 });
  }

  if (!VALID_VISIBILITIES.has(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  if (reviewBody?.trim() && reviewBody.trim().length < 5) {
    return NextResponse.json({ error: "Body must be at least 5 characters" }, { status: 400 });
  }

  const validItems = items
    .filter((it: { name?: string; rating?: number }) => it?.name?.trim())
    .map((it: { name: string; rating?: number }) => ({
      name: it.name.trim(),
      rating:
        typeof it.rating === "number" && it.rating >= 1 && it.rating <= 5
          ? it.rating
          : 0,
    }));

  // reviewer_name is always derived from the authenticated session — never from the request body
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      reviewer_name: actor.actorName,
      restaurant_name: restaurantName.trim(),
      items: validItems,
      body: reviewBody?.trim() || null,
      visibility,
      photo_url: photoUrl ?? null,
      area: area?.trim() || null,
      restaurant_id: restaurantId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
