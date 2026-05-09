import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

const VALID_VISIBILITIES = new Set(["public", "circle", "me"]);

function normalizeItems(items: unknown): { items?: { name: string; rating: number }[]; error?: string } {
  if (!Array.isArray(items)) {
    return { error: "At least one dish is required" };
  }

  const normalized = [];
  for (const item of items as { name?: string; rating?: unknown }[]) {
    const name = item?.name?.trim();
    if (!name) continue;

    if (
      item.rating !== undefined
      && (typeof item.rating !== "number" || item.rating < 1 || item.rating > 5)
    ) {
      return { error: "Invalid rating" };
    }

    normalized.push({
      name,
      rating: item.rating ?? 0,
    });
  }

  if (normalized.length === 0) {
    return { error: "At least one dish is required" };
  }

  return { items: normalized };
}

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
    restaurantAddress,
    restaurantLat,
    restaurantLng,
  } = body;

  if (!restaurantName?.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const normalizedItems = normalizeItems(items);
  if (normalizedItems.error) {
    return NextResponse.json({ error: normalizedItems.error }, { status: 400 });
  }

  if (!VALID_VISIBILITIES.has(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  if (reviewBody?.trim() && reviewBody.trim().length < 5) {
    return NextResponse.json({ error: "Body must be at least 5 characters" }, { status: 400 });
  }

  // reviewer_name is always derived from the authenticated session — never from the request body
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      reviewer_name: actor.actorName,
      restaurant_name: restaurantName.trim(),
      items: normalizedItems.items,
      body: reviewBody?.trim() || null,
      visibility,
      photo_url: photoUrl ?? null,
      area: area?.trim() || null,
      restaurant_id: restaurantId ?? null,
      restaurant_address: restaurantAddress?.trim() || null,
      restaurant_lat: typeof restaurantLat === "number" ? restaurantLat : null,
      restaurant_lng: typeof restaurantLng === "number" ? restaurantLng : null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
