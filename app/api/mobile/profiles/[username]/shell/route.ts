import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mobileApiJson, mobileOptions } from "@/lib/server/api-security";
import { getRouteActor } from "@/lib/server/route-supabase";

const METHODS = ["GET"];
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ username: string }> }
) {
  const username = (await context.params).username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return mobileApiJson(req, METHODS, { error: "Invalid username" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return mobileApiJson(req, METHODS, { error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await createAdminClient().rpc("mobile_other_profile_shell_v1", {
    p_target_name: username,
    p_viewer_user_id: actor.userId
  });
  if (error) {
    console.error("[mobile/profiles/shell] canonical RPC failed");
    return mobileApiJson(req, METHODS, { error: "Profile deployment contract unavailable" }, { status: 503 });
  }
  if (!data) {
    return mobileApiJson(req, METHODS, { error: "Profile not found" }, { status: 404 });
  }

  return mobileApiJson(req, METHODS, data);
}
