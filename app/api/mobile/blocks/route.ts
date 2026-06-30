import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@+/, "").toLowerCase() : "";
}

async function validateTarget(db: ReturnType<typeof createAdminClient>, actorName: string, rawUsername: unknown) {
  const username = normalizeUsername(rawUsername);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return { error: "Invalid username", status: 400, username: "" };
  }
  if (username === actorName) {
    return { error: "You can't block yourself", status: 400, username: "" };
  }

  const { data, error } = await db
    .from("profiles")
    .select("username")
    .eq("username", username)
    .maybeSingle();

  if (error) return { error: "Could not verify profile", status: 500, username: "" };
  if (!data) return { error: "Profile not found", status: 404, username: "" };
  return { error: "", status: 200, username };
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = createAdminClient();
  const target = await validateTarget(db, actor.actorName, body?.username);
  if (target.error) return NextResponse.json({ error: target.error }, { status: target.status });

  const { error } = await db
    .from("blocked_users")
    .upsert(
      { blocker_name: actor.actorName, blocked_name: target.username },
      { onConflict: "blocker_name,blocked_name" }
    );

  if (error) return NextResponse.json({ error: "Could not block user" }, { status: 500 });

  invalidateSocialCachesForNames([actor.actorName, target.username]);
  return NextResponse.json({ blocked: true, ok: true, username: target.username });
}

export async function DELETE(req: NextRequest) {
  const { actor } = await getRouteActor();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const db = createAdminClient();
  const target = await validateTarget(db, actor.actorName, body?.username);
  if (target.error) return NextResponse.json({ error: target.error }, { status: target.status });

  const { error } = await db
    .from("blocked_users")
    .delete()
    .eq("blocker_name", actor.actorName)
    .eq("blocked_name", target.username);

  if (error) return NextResponse.json({ error: "Could not unblock user" }, { status: 500 });

  invalidateSocialCachesForNames([actor.actorName, target.username]);
  return NextResponse.json({ blocked: false, ok: true, username: target.username });
}
