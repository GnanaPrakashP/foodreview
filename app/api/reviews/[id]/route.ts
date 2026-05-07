import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

const VALID_VISIBILITIES = new Set(["public", "circle", "me"]);

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
    if (!Array.isArray(items) || items.filter((it: { name?: string }) => it?.name?.trim()).length === 0) {
      return NextResponse.json({ error: "At least one dish is required" }, { status: 400 });
    }
    updates.items = items.filter((it: { name?: string }) => it?.name?.trim());
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
