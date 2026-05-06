import { createClient } from "@/lib/supabase/server";
import type { Review, Comment } from "@/lib/types";
import CircleFeedClient from "@/components/circle/CircleFeedClient";
import NotificationBell from "@/components/reviews/NotificationBell";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { filterCircleTrendingReviews } from "@/lib/visibility";

export const dynamic = "force-dynamic";

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

export default async function CirclePage() {
  const supabase = await createClient();

  const [{ data: { user } }, { data: reviews }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }).limit(200).returns<Review[]>(),
  ]);

  const myName = user?.user_metadata?.full_name ?? "";
  let joinedCircles = new Set<string>();
  if (myName) {
    joinedCircles = (await getCircleRelationshipsForName(supabase, myName)).joinedCircles;
  }

  const allReviews = filterCircleTrendingReviews(reviews ?? [], {
    viewerName: myName,
    circleOwnerNames: joinedCircles,
  });
  const postIds = allReviews.map((review) => review.id);

  const [{ data: rawLikes }, { data: rawComments }] = postIds.length > 0
    ? await Promise.all([
        supabase.from("likes").select("post_id").in("post_id", postIds),
        supabase
          .from("comments")
          .select("id, post_id, user_name, content, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: false })
          .returns<Comment[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  const likeCountMap: Record<string, number> = {};
  for (const like of (rawLikes ?? []) as { post_id: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of rawComments ?? []) {
    const ex = commentMap[comment.post_id];
    if (!ex) {
      commentMap[comment.post_id] = { count: 1, top: comment };
    } else {
      ex.count++;
    }
  }

  const visitCounts = new Map<string, number>();
  for (const r of allReviews) {
    const k = `${r.reviewer_name}\x00${r.restaurant_name}`;
    visitCounts.set(k, (visitCounts.get(k) ?? 0) + 1);
  }

  const byReviewer = new Map<string, Review[]>();
  for (const r of allReviews) {
    const g = byReviewer.get(r.reviewer_name) ?? [];
    g.push(r);
    byReviewer.set(r.reviewer_name, g);
  }
  const rankMap: Record<string, { rank: number; total: number; visitCount: number }> = {};
  for (const [, group] of byReviewer) {
    const sorted = [...group].sort((a, b) => avgRating(b) - avgRating(a));
    sorted.forEach((r, i) => {
      rankMap[r.id] = {
        rank: i + 1,
        total: group.length,
        visitCount: visitCounts.get(`${r.reviewer_name}\x00${r.restaurant_name}`) ?? 1,
      };
    });
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px", fontFamily: "'DM Sans', sans-serif" }}>
            Your circle
          </p>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "26px", color: "var(--cream)", lineHeight: "1.2" }}>
            What they&apos;re <em style={{ fontStyle: "italic", color: "var(--orange)" }}>eating</em>
          </h1>
        </div>
        <div style={{ paddingTop: "4px" }}>
          <NotificationBell />
        </div>
      </div>

      <CircleFeedClient
        allReviews={allReviews}
        likeCountMap={likeCountMap}
        commentMap={commentMap}
        rankMap={rankMap}
      />
    </div>
  );
}
