import { NextRequest } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiJson, boundedJsonError, enforceRateLimit, mobileOptions, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

const METHODS = ["POST"];

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function mobileJson(body: unknown, init?: ResponseInit) {
  return apiJson(body, init);
}

function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function usernameErrorResponse(error: unknown) {
  const record = error as { code?: unknown; message?: unknown } | null;
  const message = typeof record?.message === "string" ? record.message : "";
  const code = typeof record?.code === "string" ? record.code : "";

  if (code === "28000" || message.includes("username_not_authenticated")) {
    return mobileJson({ error: "Unauthorized" }, { status: 401 });
  }
  if (code === "22023" || message.includes("username_invalid")) {
    return mobileJson({ error: "Username must be 3-20 chars: lowercase letters, numbers, or underscore" }, { status: 400 });
  }
  if (code === "23505" || message.includes("username_taken")) {
    return mobileJson({ error: "Username is already taken" }, { status: 409 });
  }
  if (message.includes("profile_not_found")) {
    return mobileJson({ error: "Profile not found" }, { status: 404 });
  }
  return mobileJson({ error: "Could not update username" }, { status: 500 });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}

export async function POST(req: NextRequest) {
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "profile.username", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const parsed = await readBoundedJson<{ username?: unknown }>(req, 2048);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const body = parsed.value;
  const nextUsername = normalizeUsername(body?.username);

  if (!USERNAME_REGEX.test(nextUsername)) {
    return mobileJson({ error: "Username must be 3-20 chars: lowercase letters, numbers, or underscore" }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("update_current_username", { p_username: nextUsername })
    .single<{ username: string }>();

  if (error) return usernameErrorResponse(error);
  const username = data?.username ?? nextUsername;

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(actor.userId).catch(() => ({ data: { user: null } }));
  await admin.auth.admin.updateUserById(actor.userId, {
    user_metadata: {
      ...(authUser.user?.user_metadata ?? {}),
      username
    }
  }).catch(() => undefined);

  return mobileJson({ username });
}
