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

  const myName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "";
  let joinedCircles: string[] = [];
  let mutualMembers: string[] = [];
  if (myName) {
    const relationships = await getCircleRelationshipsForName(supabase, myName);
    joinedCircles = [...relationships.joinedCircles];
    mutualMembers = [...relationships.mutualMembers];
  }

  const allReviews = filterCircleTrendingReviews(reviews ?? [], {
    viewerName: myName,
    circleOwnerNames: joinedCircles,
  });
  const postIds = allReviews.map((review) => review.id);
  const restaurantNames = [...new Set(allReviews.map((review) => review.restaurant_name))];

  const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }] = postIds.length > 0
    ? await Promise.all([
        supabase.from("likes").select("post_id, user_name").in("post_id", postIds),
        supabase
          .from("comments")
          .select("id, post_id, user_name, content, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: false })
          .returns<Comment[]>(),
        myName && restaurantNames.length > 0
          ? supabase
              .from("wishlist")
              .select("restaurant_name")
              .eq("user_name", myName)
              .in("restaurant_name", restaurantNames)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  // Like count per post
  const likeCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (rawLikes ?? []) as { post_id: string; user_name: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (like.user_name === myName) likedByMeMap[like.post_id] = true;
  }

  const bookmarkedRestaurantMap: Record<string, boolean> = {};
  for (const item of (rawWishlist ?? []) as { restaurant_name: string }[]) {
    bookmarkedRestaurantMap[item.restaurant_name] = true;
  }

  // Comment count + most recent comment per post
  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of rawComments ?? []) {
    const ex = commentMap[comment.post_id];
    if (!ex) {
      commentMap[comment.post_id] = { count: 1, top: comment };
    } else {
      ex.count++;
    }
  }

  // Visit count per (reviewer, restaurant)
  const visitCounts = new Map<string, number>();
  for (const r of allReviews) {
    const k = `${r.reviewer_name}\x00${r.restaurant_name}`;
    visitCounts.set(k, (visitCounts.get(k) ?? 0) + 1);
  }

  // Rank per review (within each reviewer's own posts)
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
      <div className="px-5 pt-6 pb-3" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ color: "var(--muted)", fontSize: "13px", fontFamily: "'DM Sans', sans-serif" }}>Your circle</p>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", color: "var(--cream)", lineHeight: "1.2", marginTop: "4px" }}>
            What they&rsquo;re{" "}
            <span style={{ fontStyle: "italic", color: "var(--orange)" }}>eating</span>
          </h1>
        </div>
        <div style={{ paddingTop: "8px" }}>
          <NotificationBell />
        </div>
      </div>

      <CircleFeedClient
        allReviews={allReviews}
        likeCountMap={likeCountMap}
        commentMap={commentMap}
        rankMap={rankMap}
        initialMyName={myName}
        initialCircle={joinedCircles}
        initialMutualCircle={mutualMembers}
        initialLikedMap={likedByMeMap}
        initialBookmarkedRestaurantMap={bookmarkedRestaurantMap}
      />
    </div>
  );
}
