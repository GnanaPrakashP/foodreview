import { createClient } from "@/lib/supabase/server";
import CircleFeedClient from "@/components/circle/CircleFeedClient";
import NotificationBell from "@/components/reviews/NotificationBell";
import { getCircleFeedPage } from "@/lib/circle-feed";

export const dynamic = "force-dynamic";

export default async function CirclePage() {
  const supabase = await createClient();
  const feed = await getCircleFeedPage(supabase);

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
        allReviews={feed.reviews}
        likeCountMap={feed.likeCountMap}
        commentMap={feed.commentMap}
        rankMap={feed.rankMap}
        initialProfileMap={feed.profileMap}
        initialMyName={feed.myName}
        initialCircle={feed.joinedCircles}
        initialMutualCircle={feed.mutualMembers}
        initialLikedMap={feed.likedByMeMap}
        initialBookmarkedRestaurantMap={feed.bookmarkedRestaurantMap}
        initialHasMore={feed.hasMore}
        initialNextCursor={feed.nextCursor}
      />
    </div>
  );
}
