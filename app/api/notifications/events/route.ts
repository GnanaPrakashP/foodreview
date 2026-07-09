import { NextRequest, NextResponse } from "next/server";
import type { Review } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayName } from "@/lib/profile-names";
import { REVIEW_SELECT } from "@/lib/selects";
import {
  createCirclePostNotifications,
  getAuthenticatedProfileName,
} from "@/lib/notifications";
import { createRouteSupabase, getNotificationViewer, unauthorized } from "../_utils";

type NotificationEvent =
  | { event: "POST_LIKED"; reviewId: string; actorName?: string }
  | { event: "POST_UNLIKED"; reviewId: string; actorName?: string }
  | { event: "POST_COMMENTED"; reviewId: string; commentId: string; actorName?: string }
  | { event: "POST_COMMENT_DELETED"; commentId: string; actorName?: string }
  | { event: "CIRCLE_POST_CREATED"; reviewId: string; actorName?: string };

const SERVER_OWNED_ENGAGEMENT_EVENTS = new Set([
  "POST_LIKED",
  "POST_UNLIKED",
  "POST_COMMENTED",
  "POST_COMMENT_DELETED",
]);

export async function POST(req: NextRequest) {
  const supabase = await createRouteSupabase(req);
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const admin = createAdminClient();
  let payload: NotificationEvent;
  try {
    payload = await req.json() as NotificationEvent;
  } catch {
    return NextResponse.json({ error: "Invalid notification event payload" }, { status: 400 });
  }
  const actorName = (payload.actorName?.trim() || viewer.name || await getAuthenticatedProfileName(admin, viewer.id) || "").trim();
  if (!actorName || (viewer.name && actorName !== viewer.name)) {
    return NextResponse.json({ error: "Invalid actor" }, { status: 400 });
  }

  if (SERVER_OWNED_ENGAGEMENT_EVENTS.has(payload.event)) {
    return NextResponse.json({ error: "Engagement notifications are handled by mutation routes" }, { status: 410 });
  }

  if (payload.event !== "CIRCLE_POST_CREATED") {
    return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
  }

  const { data: actorProfile } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("username", actorName)
    .maybeSingle();
  profileDisplayName(
    actorProfile as { first_name: string | null; last_name: string | null } | null,
    actorName
  );

  const { data: review, error: reviewError } = await admin
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("id", payload.reviewId)
    .maybeSingle();

  if (reviewError) return NextResponse.json({ error: reviewError.message }, { status: 500 });
  if (!review) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  if ((review as unknown as Review).reviewer_name !== actorName) {
    return NextResponse.json({ error: "Invalid actor" }, { status: 400 });
  }
  await createCirclePostNotifications(admin, review as unknown as Review);
  return NextResponse.json({ ok: true });
}
