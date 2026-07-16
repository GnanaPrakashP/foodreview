import { NextRequest } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { boundedJsonError, enforceRateLimit, mobileApiJson, mobileOptions, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

const METHODS = ["GET", "POST"];

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function mobileJson(req: NextRequest, body: unknown, init?: ResponseInit) {
  return mobileApiJson(req, METHODS, body, init);
}

function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function suggestionCandidates(username: string) {
  const stem = username
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "foodie";
  let fingerprint = 0;
  for (const character of username) fingerprint = (fingerprint * 31 + character.charCodeAt(0)) % 997;
  const suffixes = [
    "_bites",
    "_eats",
    "_food",
    "_reviews",
    ...Array.from({ length: 12 }, (_, index) => String(100 + ((fingerprint + index * 37) % 900)))
  ];
  return Array.from(new Set(suffixes.map((suffix) => {
    const base = stem.slice(0, Math.max(1, 20 - suffix.length));
    return `${base}${suffix}`;
  }))).filter((candidate) => USERNAME_REGEX.test(candidate) && candidate !== username);
}

function usernameErrorResponse(req: NextRequest, error: unknown) {
  const record = error as { code?: unknown; message?: unknown } | null;
  const message = typeof record?.message === "string" ? record.message : "";
  const code = typeof record?.code === "string" ? record.code : "";

  if (code === "28000" || message.includes("username_not_authenticated")) {
    return mobileJson(req, { error: "Unauthorized" }, { status: 401 });
  }
  if (code === "22023" || message.includes("username_invalid")) {
    return mobileJson(req, { error: "Username must be 3-20 chars: lowercase letters, numbers, or underscore" }, { status: 400 });
  }
  if (code === "23505" || message.includes("username_taken")) {
    return mobileJson(req, { error: "Username is already taken" }, { status: 409 });
  }
  if (message.includes("profile_not_found")) {
    return mobileJson(req, { error: "Profile not found" }, { status: 404 });
  }
  return mobileJson(req, { error: "Could not update username" }, { status: 500 });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}

export async function GET(req: NextRequest) {
  const { actorResolution, authenticatedUserId } = await getRouteActor(req);
  if (
    actorResolution.status === "unauthenticated" ||
    actorResolution.status === "invalid" ||
    !authenticatedUserId
  ) {
    return mobileJson(req, { error: "Unauthorized" }, { status: 401 });
  }
  if (actorResolution.status === "frozen") {
    return mobileJson(req, { error: "Account unavailable" }, { status: 403 });
  }
  if (actorResolution.status === "unavailable") {
    return mobileJson(req, { error: "Could not check username" }, { status: 503 });
  }

  const rate = await enforceRateLimit(req, "profile.username-availability", {
    actorUserId: authenticatedUserId
  });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const username = normalizeUsername(req.nextUrl.searchParams.get("username"));
  if (!USERNAME_REGEX.test(username)) {
    return mobileJson(req, {
      error: "Username must be 3-20 chars: lowercase letters, numbers, or underscore"
    }, { status: 400 });
  }

  const candidates = suggestionCandidates(username);
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, username")
    .in("username", [username, ...candidates]);
  if (error) return mobileJson(req, { error: "Could not check username" }, { status: 503 });

  const occupied = new Set((data ?? [])
    .filter((row) => row.id !== authenticatedUserId)
    .map((row) => row.username));
  const available = !occupied.has(username);
  return mobileJson(req, {
    available,
    suggestions: available
      ? []
      : candidates.filter((candidate) => !occupied.has(candidate)).slice(0, 3)
  });
}

export async function POST(req: NextRequest) {
  const { actor, supabase } = await getRouteActor(req);
  if (!actor) return mobileJson(req, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "profile.username", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const parsed = await readBoundedJson<{ username?: unknown }>(req, 2048);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const body = parsed.value;
  const nextUsername = normalizeUsername(body?.username);

  if (!USERNAME_REGEX.test(nextUsername)) {
    return mobileJson(req, { error: "Username must be 3-20 chars: lowercase letters, numbers, or underscore" }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("update_current_username", { p_username: nextUsername })
    .single<{ username: string }>();

  if (error) return usernameErrorResponse(req, error);
  const username = data?.username ?? nextUsername;

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(actor.userId).catch(() => ({ data: { user: null } }));
  await admin.auth.admin.updateUserById(actor.userId, {
    user_metadata: {
      ...(authUser.user?.user_metadata ?? {}),
      username
    }
  }).catch(() => undefined);

  return mobileJson(req, { username });
}
