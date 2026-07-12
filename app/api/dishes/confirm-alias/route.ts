import { NextRequest, NextResponse } from "next/server";
import { normalizeDishIdentityName } from "@/lib/server/dish-identity";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// A user-confirmed alias goes live after this many confirmations, so a single
// tap (or a single confused user) cannot rewrite the alias dictionary.
const ALIAS_ACTIVATION_CONFIRMATIONS = 3;
const MAX_DISH_NAME_LENGTH = 80;

type AliasRow = {
  canonical_dish_id: string;
  confirmation_count: number;
  id: string;
  status: string;
};

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null) as { canonicalDishId?: unknown; rawName?: unknown } | null;
  const rawName = typeof body?.rawName === "string" ? body.rawName.trim() : "";
  const canonicalDishId = typeof body?.canonicalDishId === "string" ? body.canonicalDishId.trim() : "";
  if (!rawName || rawName.length > MAX_DISH_NAME_LENGTH || !canonicalDishId) {
    return NextResponse.json({ error: "rawName and canonicalDishId are required" }, { status: 400 });
  }

  const normalizedAlias = normalizeDishIdentityName(rawName);
  if (!normalizedAlias || normalizedAlias.length < 2) {
    return NextResponse.json({ error: "Dish name is too short" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: dish, error: dishError } = await admin
    .from("canonical_dishes")
    .select("id, normalized_name, status, merged_into_dish_id")
    .eq("id", canonicalDishId)
    .in("status", ["verified", "generated"])
    .is("merged_into_dish_id", null)
    .maybeSingle();
  if (dishError) {
    console.error("[confirm-alias] dish lookup failed:", dishError.message);
    return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
  }
  if (!dish) return NextResponse.json({ error: "Dish not found" }, { status: 404 });

  // Typing the canonical name itself is not an alias.
  if (dish.normalized_name === normalizedAlias) {
    return NextResponse.json({ ok: true, status: "exact" });
  }

  // Never shadow another live canonical dish's name with an alias.
  const { data: conflictDish, error: conflictError } = await admin
    .from("canonical_dishes")
    .select("id")
    .eq("normalized_name", normalizedAlias)
    .in("status", ["verified", "generated"])
    .is("merged_into_dish_id", null)
    .maybeSingle();
  if (conflictError) {
    console.error("[confirm-alias] conflict lookup failed:", conflictError.message);
    return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
  }
  if (conflictDish) return NextResponse.json({ ok: true, status: "conflict" });

  const { data: activeAlias, error: activeError } = await admin
    .from("dish_aliases")
    .select("id, canonical_dish_id, confirmation_count, status")
    .eq("normalized_alias", normalizedAlias)
    .eq("status", "active")
    .maybeSingle<AliasRow>();
  if (activeError) {
    console.error("[confirm-alias] active alias lookup failed:", activeError.message);
    return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
  }
  if (activeAlias) {
    if (activeAlias.canonical_dish_id !== dish.id) {
      return NextResponse.json({ ok: true, status: "conflict" });
    }
    const { error } = await admin
      .from("dish_aliases")
      .update({
        confirmation_count: activeAlias.confirmation_count + 1,
        updated_at: new Date().toISOString()
      })
      .eq("id", activeAlias.id);
    if (error) {
      console.error("[confirm-alias] confirmation bump failed:", error.message);
      return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, confirmations: activeAlias.confirmation_count + 1, status: "already_active" });
  }

  const { data: candidateAliases, error: candidateError } = await admin
    .from("dish_aliases")
    .select("id, canonical_dish_id, confirmation_count, status")
    .eq("normalized_alias", normalizedAlias)
    .eq("canonical_dish_id", dish.id)
    .eq("status", "candidate")
    .limit(1);
  if (candidateError) {
    console.error("[confirm-alias] candidate alias lookup failed:", candidateError.message);
    return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
  }

  const candidateAlias = (candidateAliases as AliasRow[] | null)?.[0] ?? null;
  if (candidateAlias) {
    const confirmations = candidateAlias.confirmation_count + 1;
    const activated = confirmations >= ALIAS_ACTIVATION_CONFIRMATIONS;
    const { error } = await admin
      .from("dish_aliases")
      .update({
        confirmation_count: confirmations,
        status: activated ? "active" : "candidate",
        updated_at: new Date().toISOString()
      })
      .eq("id", candidateAlias.id);
    if (error) {
      console.error("[confirm-alias] confirmation update failed:", error.message);
      return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, confirmations, status: activated ? "activated" : "recorded" });
  }

  const { error: insertError } = await admin
    .from("dish_aliases")
    .insert({
      alias_text: rawName,
      alias_type: "user_confirmed",
      canonical_dish_id: dish.id,
      confidence: null,
      confirmation_count: 1,
      normalized_alias: normalizedAlias,
      status: "candidate"
    });
  if (insertError) {
    console.error("[confirm-alias] insert failed:", insertError.message);
    return NextResponse.json({ error: "Could not confirm dish name" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, confirmations: 1, status: "recorded" });
}
