import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use the same explicit viewer-aware contract as other Profile screens.
  // Passing the owner as both viewer and target includes all of their public,
  // Circle and private posts without relying on auth.uid() inside a service-role
  // RPC call.
  const { data, error } = await createAdminClient().rpc("mobile_other_profile_shell_v1", {
    p_target_name: actor.actorName,
    p_viewer_user_id: actor.userId
  });
  if (error) {
    console.error("[mobile/profile/shell] canonical RPC failed");
    return NextResponse.json({ error: "Profile deployment contract unavailable" }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const shell = data as {
    circleCount: number;
    displayName: string;
    profile: unknown;
    stats: unknown;
  };
  return NextResponse.json({
    circleCount: shell.circleCount,
    displayName: shell.displayName,
    profile: shell.profile,
    stats: shell.stats
  });
}
