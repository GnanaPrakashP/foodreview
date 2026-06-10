import { NextRequest, NextResponse } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

type UpdateTarget = {
  column: string;
  table: string;
};

const USERNAME_TARGETS: UpdateTarget[] = [
  { table: "reviews", column: "reviewer_name" },
  { table: "stories", column: "author_name" },
  { table: "likes", column: "user_name" },
  { table: "comments", column: "user_name" },
  { table: "wishlist", column: "user_name" },
  { table: "hungry_picks", column: "user_name" },
  { table: "circle_requests", column: "sender_name" },
  { table: "circle_requests", column: "receiver_name" },
  { table: "circle_memberships", column: "user_name" },
  { table: "circle_memberships", column: "member_name" },
  { table: "notifications", column: "recipient_name" },
  { table: "notifications", column: "actor_name" },
  { table: "push_tokens", column: "user_name" },
  { table: "shared_memory_rooms", column: "created_by" },
  { table: "shared_memory_members", column: "user_name" },
  { table: "shared_memory_messages", column: "author_name" },
  { table: "shared_memory_photos", column: "uploader_name" },
  { table: "shared_memory_dishes", column: "added_by" },
  { table: "shared_memory_reads", column: "user_name" }
];

function mobileJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...init?.headers
    }
  });
}

function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /schema cache|relation .* does not exist/i.test(message);
}

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const nextUsername = normalizeUsername(body?.username);

  if (!USERNAME_REGEX.test(nextUsername)) {
    return mobileJson({ error: "Username must be 3-20 chars: lowercase letters, numbers, or underscore" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("id, username")
    .eq("id", actor.userId)
    .maybeSingle<{ id: string; username: string }>();

  if (profileError) return mobileJson({ error: profileError.message }, { status: 500 });
  if (!currentProfile?.username) return mobileJson({ error: "Profile not found" }, { status: 404 });

  const previousUsername = currentProfile.username.trim().toLowerCase();
  if (previousUsername === nextUsername) {
    return mobileJson({ username: nextUsername });
  }

  const { data: existingProfile, error: existingError } = await admin
    .from("profiles")
    .select("id")
    .eq("username", nextUsername)
    .maybeSingle<{ id: string }>();

  if (existingError) return mobileJson({ error: existingError.message }, { status: 500 });
  if (existingProfile && existingProfile.id !== actor.userId) {
    return mobileJson({ error: "Username is already taken" }, { status: 409 });
  }

  for (const target of USERNAME_TARGETS) {
    const { error } = await admin
      .from(target.table)
      .update({ [target.column]: nextUsername })
      .eq(target.column, previousUsername);

    if (error && !isMissingTable(error)) {
      return mobileJson({ error: error.message }, { status: 500 });
    }
  }

  const { data: updatedProfile, error: updateError } = await admin
    .from("profiles")
    .update({ username: nextUsername })
    .eq("id", actor.userId)
    .select("username")
    .single<{ username: string }>();

  if (updateError) return mobileJson({ error: updateError.message }, { status: 500 });

  const { data: authUser } = await admin.auth.admin.getUserById(actor.userId);
  await admin.auth.admin.updateUserById(actor.userId, {
    user_metadata: {
      ...(authUser.user?.user_metadata ?? {}),
      username: nextUsername
    }
  });

  return mobileJson({ username: updatedProfile.username });
}
