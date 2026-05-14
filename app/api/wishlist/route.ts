import { NextRequest, NextResponse } from "next/server";
import { invalidateCircleFeedCacheForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function POST(req: NextRequest) {
  const { restaurantName, postId } = await req.json();
  if (typeof restaurantName !== "string" || !restaurantName.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const { supabase, actor } = await getRouteActor();
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

  const { supabase, actor } = await getRouteActor();
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
