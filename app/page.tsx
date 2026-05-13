import { createClient } from "@/lib/supabase/server";
import { getCircleFeedPage } from "@/lib/circle-feed";
import CircleFeedClient from "@/components/circle/CircleFeedClient";
import NotificationBell from "@/components/reviews/NotificationBell";

export const dynamic = "force-dynamic";

export default async function CirclePage() {
  const supabase = await createClient();
  const feed = await getCircleFeedPage(supabase);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
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
