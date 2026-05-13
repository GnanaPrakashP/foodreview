import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

function invalidateCircleFeedCacheForNames(names: string[]) {
  (globalThis as typeof globalThis & {
    __foodReviewInvalidateCircleFeedCacheForNames?: (names: string[]) => void;
  }).__foodReviewInvalidateCircleFeedCacheForNames?.(names);
}

async function getActorAndDb() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const actor = await getAuthenticatedCircleActor(supabase);
  return { supabase, actor };
}

export async function POST(req: NextRequest) {
  const { restaurantName, postId } = await req.json();
  if (typeof restaurantName !== "string" || !restaurantName.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const { supabase, actor } = await getActorAndDb();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { error } = await supabase
    .from("wishlist")
    .insert({
      user_name: actor.actorName,
      restaurant_name: restaurantName.trim(),
      post_id: typeof postId === "string" ? postId : null,
    });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateCircleFeedCacheForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { restaurantName } = await req.json();
  if (typeof restaurantName !== "string" || !restaurantName.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const { supabase, actor } = await getActorAndDb();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { error } = await supabase
    .from("wishlist")
    .delete()
    .eq("user_name", actor.actorName)
    .eq("restaurant_name", restaurantName.trim());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateCircleFeedCacheForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}
