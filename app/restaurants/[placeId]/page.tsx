import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Comment, Review } from "@/lib/types";
import { COMMENT_SELECT, REVIEW_SELECT } from "@/lib/selects";
import { normalizeReview } from "@/lib/server/normalize-review";
import { filterGlobalTrendingReviews } from "@/lib/visibility";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { restaurantGradient } from "@/lib/profile";
import { googleMapsUrl, restaurantLocationLabel } from "@/lib/location";
import RestaurantPostsClient from "@/components/trending/RestaurantPostsClient";

export const dynamic = "force-dynamic";
const RESTAURANT_PAGE_SIZE = 24;

type Props = {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ name?: string; address?: string }>;
};

function avgScore10FromItems(rows: Array<Pick<Review, "items">>): number {
  const rated = rows.flatMap((row) => row.items.filter((item) => item.rating > 0));
  if (rated.length === 0) return 0;
  return Math.round((rated.reduce((sum, item) => sum + item.rating, 0) / rated.length) * 2 * 10) / 10;
}

function mapsUrlForPlace(placeId: string, restaurantName: string, locationLabel: string | null, review: Review | null): string {
  const coordinateUrl = review ? googleMapsUrl(review) : null;
  if (coordinateUrl) return coordinateUrl;

  const query = [restaurantName, locationLabel].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    api: "1",
    query: query || restaurantName,
    query_place_id: placeId,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

export default async function RestaurantPlacePage({ params, searchParams }: Props) {
  const { placeId } = await params;
  const search = await searchParams;
  const decodedPlaceId = decodeURIComponent(placeId);
  const fallbackName = search.name?.trim() || "Restaurant";
  const fallbackAddress = search.address?.trim() || null;

  const supabase = await createClient();
  const db = createAdminClient();
  const [{ data: { user } }, { data: rawReviews }] = await Promise.all([
    supabase.auth.getUser(),
    db
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("restaurant_id", decodedPlaceId)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(RESTAURANT_PAGE_SIZE + 1)
      .returns<Review[]>(),
  ]);

  const fetchedReviews = filterGlobalTrendingReviews(
    ((rawReviews ?? []) as unknown[]).map((review) => normalizeReview(review as Parameters<typeof normalizeReview>[0]))
  );
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: totalPostCount }, { count: weeklyVisitCount }, { data: statRows }] = await Promise.all([
    db
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", decodedPlaceId)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active"),
    db
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", decodedPlaceId)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .gte("created_at", weekStart),
    db
      .from("reviews")
      .select("items")
      .eq("restaurant_id", decodedPlaceId)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .returns<Array<Pick<Review, "items">>>(),
  ]);
  const hasMore = fetchedReviews.length > RESTAURANT_PAGE_SIZE;
  const reviews = fetchedReviews.slice(0, RESTAURANT_PAGE_SIZE);
  const nextCursor = hasMore && reviews.length > 0
    ? { createdAt: reviews[reviews.length - 1].created_at, id: reviews[reviews.length - 1].id }
    : null;
  const restaurantName = reviews[0]?.restaurant_name || fallbackName;
  const area = reviews.map((review) => restaurantLocationLabel(review)).find(Boolean) || fallbackAddress;
  const mapsUrl = mapsUrlForPlace(decodedPlaceId, restaurantName, area, reviews[0] ?? null);
  const myName = (user?.user_metadata?.username as string) ?? "";
  const reviewIds = reviews.map((review) => review.id);

  const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }, profileMap] = reviewIds.length > 0
    ? await Promise.all([
        db.from("likes").select("post_id, user_name").in("post_id", reviewIds),
        db
          .from("comments")
          .select(COMMENT_SELECT)
          .in("post_id", reviewIds)
          .order("created_at", { ascending: false })
          .returns<Comment[]>(),
        myName
          ? db
              .from("wishlist")
              .select("post_id")
              .eq("user_name", myName)
              .in("post_id", reviewIds)
          : Promise.resolve({ data: [] }),
        buildProfileDisplayMap(db, reviews.map((review) => review.reviewer_name)),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, {}];

  const likeCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (rawLikes ?? []) as { post_id: string; user_name: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (myName && like.user_name === myName) likedByMeMap[like.post_id] = true;
  }

  const bookmarkedPostMap: Record<string, boolean> = {};
  for (const item of (rawWishlist ?? []) as { post_id: string | null }[]) {
    if (item.post_id) bookmarkedPostMap[item.post_id] = true;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of rawComments ?? []) {
    const existing = commentMap[comment.post_id];
    if (!existing) commentMap[comment.post_id] = { count: 1, top: comment };
    else existing.count++;
  }

  const averageScore = avgScore10FromItems(statRows ?? []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
      <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ width: 40, height: 40, background: restaurantGradient(restaurantName), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px", fontWeight: 700, color: "white", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
          {restaurantName[0]?.toUpperCase() ?? "?"}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "16px", color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {restaurantName}
          </h1>
          {area && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.72)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "none" }}
            >
              {area}
            </a>
          )}
        </div>
      </div>

      <RestaurantPostsClient
        restaurantReviews={reviews}
        circleRestaurantReviews={[]}
        likeCountMap={likeCountMap}
        commentMap={commentMap}
        initialStats={{
          totalPosts: totalPostCount ?? reviews.length,
          averageRating: averageScore / 2,
          visitsThisWeek: weeklyVisitCount ?? 0,
        }}
        profileMap={profileMap}
        likedByMeMap={likedByMeMap}
        bookmarkedPostMap={bookmarkedPostMap}
        myName={myName}
        hasMore={hasMore}
        nextCursor={nextCursor}
        loadMoreUrl={`/api/feed/public?limit=${RESTAURANT_PAGE_SIZE}&placeId=${encodeURIComponent(decodedPlaceId)}${myName ? `&viewer=${encodeURIComponent(myName)}` : ""}`}
      />
    </div>
  );
}
