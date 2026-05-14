import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function POST(req: NextRequest) {
  try {
    return await removeFromCircle(req);
  } catch (error) {
    console.error("[circle/remove] unhandled failure:", error);
    return NextResponse.json({ error: "Unable to remove from circle" }, { status: 500 });
  }
}

function isMissingCircleMembershipsTable(error: { message?: string; code?: string } | null) {
  return error?.code === "PGRST205" || Boolean(error?.message?.includes("Could not find the table"));
}

async function removeFromCircle(req: NextRequest) {
  const { otherName } = await req.json();
  if (typeof otherName !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const admin = createAdminClient();
  const me = actor.actorName;
  const other = otherName.trim();
  if (!other || me === other) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error } = await admin
    .from("circle_memberships")
    .delete()
    .eq("user_name", other)
    .eq("member_name", me);

  const membershipsTableMissing = isMissingCircleMembershipsTable(error);
  if (error && !membershipsTableMissing) {
    console.error("[circle/remove] membership delete failed:", error.message, error.code, error.details);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Guard against stale accepted requests auto-restoring membership.
  // Use updates rather than deletes because older schemas may not include
  // a delete policy for circle_requests.
  const cleanupResults = await Promise.all([
    admin
      .from("circle_requests")
      .update({ status: "rejected" })
      .eq("sender_name", me)
      .eq("receiver_name", other)
      .eq("status", "accepted"),
    admin
      .from("circle_requests")
      .update({ status: "rejected" })
      .eq("sender_name", other)
      .eq("receiver_name", me)
      .eq("status", "accepted"),
  ]);

  const cleanupError = cleanupResults.find((result) => result.error)?.error ?? null;
  if (cleanupError) {
    console.error("[circle/remove] accepted request cleanup failed:", cleanupError.message, cleanupError.code, cleanupError.details);
    if (membershipsTableMissing) {
      return NextResponse.json({ error: cleanupError.message }, { status: 500 });
    }
  }

  invalidateSocialCachesForNames([me, other]);
  return NextResponse.json({ ok: true });
}
