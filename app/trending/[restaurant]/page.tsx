import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Review, Comment } from "@/lib/types";
import RestaurantPostsClient from "@/components/trending/RestaurantPostsClient";
import { ArrowLeft } from "lucide-react";
import { restaurantGradient } from "@/lib/profile";
import { restaurantLocationLabel } from "@/lib/location";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { filterGlobalTrendingReviews, filterPublicCircleTrendingReviews } from "@/lib/visibility";
import { normalizeReview } from "@/lib/server/normalize-review";

export const dynamic = "force-dynamic";

const REVIEW_SELECT = [
  "id",
  "reviewer_name",
  "restaurant_id",
  "restaurant_name",
  "area",
  "restaurant_address",
  "restaurant_lat",
  "restaurant_lng",
  "items",
  "body",
  "tags",
  "photo_url",
  "photo_urls",
  "review_photos(public_url, media_type, position)",
  "visibility",
  "created_at",
  "deleted_at",
  "hidden_at",
  "reported_at",
  "status",
].join(", ");

interface Props {
  params: Promise<{ restaurant: string }>;
  searchParams: Promise<{ circle?: string }>;
}

export default async function RestaurantPostsPage({ params, searchParams }: Props) {
  const { restaurant } = await params;
  const { circle } = await searchParams;
  const circleOnly = circle === "1";
  const restaurantName = decodeURIComponent(restaurant);

  const supabase = await createClient();
  const readDb = createAdminClient();

  const [
    { data: { user } },
    { data: allReviews },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("restaurant_name", restaurantName)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .returns<Review[]>(),
  ]);

  const restaurantScopedReviews = ((allReviews ?? []) as unknown[])
    .map((review) => normalizeReview(review as Parameters<typeof normalizeReview>[0]));
  const myName = (user?.user_metadata?.username as string) ?? "";

  // Fetch circle members for the current user before filtering; the server
  // must never send non-visible restaurant posts to the client.
  let joinedCircles = new Set<string>();
  if (myName) {
    const relationships = await getCircleRelationshipsForName(supabase, myName);
    joinedCircles = relationships.joinedCircles;
  }

  const restaurantReviews = filterGlobalTrendingReviews(restaurantScopedReviews);
  const circleRestaurantReviews = filterPublicCircleTrendingReviews(restaurantReviews, {
    viewerName: myName,
    circleOwnerNames: joinedCircles,
  });
  const displayRestaurantReviews = circleOnly ? circleRestaurantReviews : restaurantReviews;

  if (displayRestaurantReviews.length === 0) notFound();

  const reviewIds = displayRestaurantReviews.map((r) => r.id);

  const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }, profileMap] = await Promise.all([
    readDb.from("likes").select("post_id, user_name").in("post_id", reviewIds),
    readDb
      .from("comments")
      .select("id, post_id, user_name, content, created_at")
      .in("post_id", reviewIds)
      .order("created_at", { ascending: false })
      .returns<Comment[]>(),
    myName
      ? readDb
          .from("wishlist")
          .select("post_id")
          .eq("user_name", myName)
          .in("post_id", reviewIds)
      : Promise.resolve({ data: [] }),
    buildProfileDisplayMap(
      readDb,
      displayRestaurantReviews.map((review) => review.reviewer_name)
    ),
  ]);

  // Like counts
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

  // Comment counts + top comment
  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const c of rawComments ?? []) {
    const ex = commentMap[c.post_id];
    if (!ex) commentMap[c.post_id] = { count: 1, top: c };
    else ex.count++;
  }

  // Avg score for the header
  const allRated = displayRestaurantReviews.flatMap((r) => r.items.filter((it) => it.rating > 0));
  const avgScore = allRated.length > 0
    ? allRated.reduce((s, it) => s + it.rating, 0) / allRated.length * 2
    : 0;

  const area = displayRestaurantReviews.map((r) => restaurantLocationLabel(r)).find(Boolean) ?? null;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/explore" style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
          </div>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <div style={{ width: 40, height: 40, background: restaurantGradient(restaurantName), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
            {restaurantName[0]?.toUpperCase() ?? "?"}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "16px", color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {restaurantName}
            </h1>
            <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>
              {area && `${area} · `}{displayRestaurantReviews.length} post{displayRestaurantReviews.length !== 1 ? "s" : ""}
              {avgScore > 0 ? ` · ${avgScore.toFixed(1)}/10 avg` : ""}
            </p>
          </div>
        </div>
      </div>

      <RestaurantPostsClient
        restaurantReviews={restaurantReviews}
        circleRestaurantReviews={circleRestaurantReviews}
        likeCountMap={likeCountMap}
        commentMap={commentMap}
        profileMap={profileMap}
        likedByMeMap={likedByMeMap}
        bookmarkedPostMap={bookmarkedPostMap}
        myName={myName}
        circleOnly={circleOnly}
      />

    </div>
  );
}
