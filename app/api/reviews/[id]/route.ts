import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

const VALID_VISIBILITIES = new Set(["public", "circle", "me"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

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

async function getSupabaseAndActor(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const actor = await getAuthenticatedCircleActor(supabase);
  return { supabase, actor };
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const { supabase, actor } = await getSupabaseAndActor(req);

  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: review, error: fetchError } = await supabase
    .from("reviews")
    .select("reviewer_name")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.reviewer_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your review" }, { status: 403 });
  }

  const { error } = await supabase
    .from("reviews")
    .delete()
    .eq("id", id)
    .eq("reviewer_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const { supabase, actor } = await getSupabaseAndActor(req);

  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: review, error: fetchError } = await supabase
    .from("reviews")
    .select("reviewer_name")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.reviewer_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your review" }, { status: 403 });
  }

  const body = await req.json();
  const { visibility, body: reviewBody, items } = body;
  const updates: Record<string, unknown> = {};

  if (visibility !== undefined) {
    if (!VALID_VISIBILITIES.has(visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    updates.visibility = visibility;
  }

  if (reviewBody !== undefined) {
    if (reviewBody.trim() && reviewBody.trim().length < 5) {
      return NextResponse.json({ error: "Body must be at least 5 characters" }, { status: 400 });
    }
    updates.body = reviewBody.trim() || null;
  }

  if (items !== undefined) {
    const normalizedItems = normalizeItems(items);
    if (normalizedItems.error) {
      return NextResponse.json({ error: normalizedItems.error }, { status: 400 });
    }
    updates.items = normalizedItems.items;
  }

  const { error } = await supabase
    .from("reviews")
    .update(updates)
    .eq("id", id)
    .eq("reviewer_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
