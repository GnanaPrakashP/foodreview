import { after, NextRequest, NextResponse } from "next/server";
import { createPostCommentNotifications } from "@/lib/notifications";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { canActorReadPost } from "@/lib/server/review-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Comment, Review } from "@/lib/types";
import { getPostEngagementState } from "@/lib/server/post-engagement-state";
import { profileDisplayName } from "@/lib/profile-names";
import { boundedJsonError, enforceRateLimit, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";
import { decodeStableTimestampCursor, encodeStableTimestampCursor } from "@/lib/server/stable-cursor";

const METHODS = ["POST"];
const DEFAULT_COMMENT_PAGE_SIZE = 30;
const MAX_COMMENT_PAGE_SIZE = 50;

const ENGAGEMENT_REVIEW_SELECT = "id, reviewer_name, restaurant_name, photo_url, photo_urls, visibility";

type CommentListRow = Pick<Comment, "id" | "post_id" | "user_name" | "content" | "created_at">;

type ProfileNameRow = {
  first_name: string | null;
  last_name: string | null;
  username: string;
};

async function fetchPostForEngagement(db: ReturnType<typeof createAdminClient>, postId: string): Promise<Review | null> {
  const { data } = await db
    .from("reviews")
    .select(ENGAGEMENT_REVIEW_SELECT)
    .eq("id", postId)
    .maybeSingle();
  return data as Review | null;
}

function scheduleCommentSideEffects(input: {
  actorDisplayName: string;
  actorName: string;
  comment: Pick<Comment, "id" | "content">;
  postId: string;
  review: Review | null;
}) {
  after(async () => {
    const writeDb = createAdminClient();
    const review = input.review ?? await fetchPostForEngagement(writeDb, input.postId);
    if (!review) return;

    try {
      const { data: priorComments } = await writeDb
        .from("comments")
        .select("user_name")
        .eq("post_id", input.postId)
        .order("created_at", { ascending: false })
        .limit(100);

      await createPostCommentNotifications(
        writeDb,
        review,
        input.actorName,
        input.comment,
        ((priorComments ?? []) as { user_name: string }[]).map((row) => row.user_name),
        input.actorDisplayName
      );
    } catch (notificationError) {
      console.error("[comments] Failed to create notification:", notificationError);
    }

    const names = [input.actorName];
    if (review.reviewer_name && review.reviewer_name !== input.actorName) names.push(review.reviewer_name);
    invalidateSocialCachesForNames(names);
  });
}

async function blockedUsernamesForViewer(db: ReturnType<typeof createAdminClient>, actorName: string): Promise<Set<string>> {
  const { data, error } = await db
    .from("blocked_users")
    .select("blocker_name, blocked_name")
    .or(`blocker_name.eq.${actorName},blocked_name.eq.${actorName}`)
    .returns<Array<{ blocker_name: string | null; blocked_name: string | null }>>();

  if (error) {
    console.warn("[comments] blocked-user lookup failed:", error.message);
    return new Set();
  }

  return new Set((data ?? []).flatMap((row) => {
    if (row.blocker_name === actorName && row.blocked_name) return [row.blocked_name];
    if (row.blocked_name === actorName && row.blocker_name) return [row.blocker_name];
    return [];
  }));
}

async function displayNamesForCommentAuthors(
  db: ReturnType<typeof createAdminClient>,
  authorNames: string[]
): Promise<Record<string, string>> {
  const uniqueNames = Array.from(new Set(authorNames.map((name) => name.trim()).filter(Boolean)));
  if (uniqueNames.length === 0) return {};

  const { data, error } = await db
    .from("profiles")
    .select("first_name, last_name, username")
    .in("username", uniqueNames)
    .returns<ProfileNameRow[]>();

  if (error) {
    console.warn("[comments] profile lookup failed:", error.message);
    return {};
  }

  return Object.fromEntries((data ?? []).map((row) => [row.username, profileDisplayName(row, row.username)]));
}

export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId")?.trim();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const readDb = createAdminClient();
  const access = await canActorReadPost(readDb, postId, actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = decodeStableTimestampCursor(rawCursor);
  if (rawCursor && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_COMMENT_PAGE_SIZE);
  const limit = Math.min(MAX_COMMENT_PAGE_SIZE, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_COMMENT_PAGE_SIZE));

  let commentsQuery = readDb
      .from("comments")
      .select("id, post_id, user_name, content, created_at", { count: "exact" })
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  if (cursor) {
    commentsQuery = commentsQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const [{ data, error, count }, blockedNames] = await Promise.all([
    commentsQuery.limit(limit + 1).returns<CommentListRow[]>(),
    blockedUsernamesForViewer(readDb, actor.actorName),
  ]);

  if (error) {
    console.error("[comments] list failed:", error.message);
    return NextResponse.json({ error: "Unable to load comments" }, { status: 500 });
  }

  const visibleRows = (data ?? []).filter((row) => !blockedNames.has(row.user_name));
  const selectedDesc = visibleRows.slice(0, limit);
  const comments = [...selectedDesc].reverse();
  const profileMap = await displayNamesForCommentAuthors(readDb, comments.map((row) => row.user_name));
  const oldest = selectedDesc[selectedDesc.length - 1];
  return NextResponse.json({
    comments,
    nextCursor: (data ?? []).length > limit && oldest
      ? encodeStableTimestampCursor({ createdAt: oldest.created_at, id: oldest.id })
      : null,
    profileMap,
    totalCount: count ?? comments.length,
  });
}

export async function POST(req: NextRequest) {
  const parsed = await readBoundedJson<{ content?: unknown; postId?: unknown }>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const postId = parsed.value?.postId;
  const content = parsed.value?.content;

  if (typeof postId !== "string" || !/^[0-9a-f-]{36}$/i.test(postId)) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.trim().length > 500) {
    return NextResponse.json({ error: "Comment is too long (max 500 characters)" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const rate = await enforceRateLimit(req, "mutation.social", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const writeDb = createAdminClient();
  const access = await canActorReadPost(writeDb, postId, actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const review = await fetchPostForEngagement(writeDb, postId);
  const { data, error } = await writeDb
    .from("comments")
    .insert({ post_id: postId, user_name: actor.actorName, content: content.trim() })
    .select("id, post_id, user_name, content, created_at")
    .single<Comment>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const engagement = await getPostEngagementState(writeDb, postId, actor);
  scheduleCommentSideEffects({
    actorDisplayName: actor.displayName || actor.actorName,
    actorName: actor.actorName,
    comment: { id: data.id, content: data.content },
    postId,
    review,
  });
  return NextResponse.json({
    ...data,
    commentCount: engagement.commentCount,
    engagement,
    profileMap: { [actor.actorName]: actor.displayName || actor.actorName }
  });
}
