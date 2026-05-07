import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountTypeForName } from "@/lib/circle-db";

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

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const actor = await getAuthenticatedCircleActor(supabase);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const admin = createAdminClient();
  const me = actor.actorName;
  const other = otherName.trim();
  if (!other || me === other) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Decide whether to dissolve both edges:
  //   - Both private → full mutual dissolution (friendship model)
  //   - Either private + mutual → still dissolve both, otherwise the orphaned edge
  //     on the private account allows the other party to bypass the private request
  //     flow and instantly recreate mutual on the next "Add" click.
  //   - Both public → one-way leave only (independent open-follow circles)
  const [meAccountType, otherAccountType, reverseEdgeResult] = await Promise.all([
    getAccountTypeForName(admin, me),
    getAccountTypeForName(admin, other),
    admin
      .from("circle_memberships")
      .select("id")
      .eq("user_name", me)
      .eq("member_name", other)
      .limit(1),
  ]);

  const isMutual = (reverseEdgeResult.data ?? []).length > 0;
  const shouldDissolveBoth =
    isMutual && (meAccountType === "private" || otherAccountType === "private");

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

  // Dissolve the reverse edge to prevent orphaned memberships and request-flow bypasses.
  if (shouldDissolveBoth && !membershipsTableMissing) {
    const { error: reverseError } = await admin
      .from("circle_memberships")
      .delete()
      .eq("user_name", me)
      .eq("member_name", other);

    if (reverseError && !isMissingCircleMembershipsTable(reverseError)) {
      console.error("[circle/remove] reverse membership delete failed:", reverseError.message, reverseError.code, reverseError.details);
    }
  }

  // Accepted request rows are historical now, but remove them so old data
  // cannot recreate a mutual edge after both people leave the relationship.
  // Use updates rather than deletes because older deployed schemas may not
  // include a delete policy for circle_requests.
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

  return NextResponse.json({ ok: true });
}
