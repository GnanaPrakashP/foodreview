import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Review } from "@/lib/types";
import FriendProfileClient from "@/components/people/FriendProfileClient";
import { normalizeAccountType } from "@/lib/circle";
import { hasCircleAccess } from "@/lib/circle-db";
import { profileDisplayName } from "@/lib/profile-names";
import { REVIEW_SELECT } from "@/lib/selects";
import { normalizeReview } from "@/lib/server/normalize-review";
import { tasteTrustSummaryFromProfile } from "@/lib/taste-trust";
import { filterGlobalTrendingReviews } from "@/lib/visibility";
import { computeCommonRestaurants } from "@/lib/common-restaurants";
import { loadProfileReviewsPage } from "@/lib/profile-reviews";
import { getUserProfileReputation } from "@/lib/server/reputation";

interface Props {
  params: Promise<{ username: string }>;
}

export const dynamic = "force-dynamic";
const PROFILE_REVIEWS_PAGE_SIZE = 24;

type ProfileSummary = {
  first_name: string;
  last_name: string;
  username: string | null;
  account_type: string | null;
  bio: string | null;
  trust_score: number | null;
  trust_level: string | null;
  confirmed_recommendations_count: number | null;
  positive_confirmations_count: number | null;
  negative_confirmations_count: number | null;
  total_feedback_points: number | null;
};

export default async function UserProfilePage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);

  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: { user } }, { data: profiles }, { data: theirMemberRows }, { data: publicBestReviewRows }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("first_name, last_name, username, account_type, bio, trust_score, trust_level, confirmed_recommendations_count, positive_confirmations_count, negative_confirmations_count, total_feedback_points")
      .eq("username", name)
      .limit(1)
      .returns<ProfileSummary[]>(),
    // Fetch circle member list for the profile owner to show their circle count immediately
    admin
      .from("circle_memberships")
      .select("member_name")
      .eq("user_name", name),
    admin
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<Review[]>(),
  ]);

  const profile = (profiles ?? [])[0] ?? null;

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const displayName = profileDisplayName(profile, name);

  const initialTheirCircleCount = (theirMemberRows ?? []).length;

  let circleOwnerNames = new Set<string>();
  let initialCircleStatus: "one_way" | "sent" | "none" = "none";
  let initialHasIncomingRequest = false;
  let initialCommonRestaurantCount: number | null = null;

  if (myName && myName !== name) {
    const [canSeeCirclePosts, targetCanSeeMyCircle, { data: pendingRows }, { data: commonReviewRows }] = await Promise.all([
      hasCircleAccess(supabase, name, myName),
      hasCircleAccess(supabase, myName, name),
      // Fetch pending requests in both directions between viewer and profile owner
      admin
        .from("circle_requests")
        .select("sender_name, receiver_name")
        .in("sender_name", [myName, name])
        .in("receiver_name", [myName, name])
        .eq("status", "pending"),
      admin
        .from("reviews")
        .select(REVIEW_SELECT)
        .in("reviewer_name", [myName, name])
        .is("deleted_at", null)
        .is("hidden_at", null)
        .is("reported_at", null)
        .eq("status", "active")
        .returns<Review[]>(),
    ]);

    if (canSeeCirclePosts) circleOwnerNames = new Set([name]);
    const commonReviews = ((commonReviewRows ?? []) as unknown[])
      .map((review) => normalizeReview(review as Parameters<typeof normalizeReview>[0]));
    initialCommonRestaurantCount = computeCommonRestaurants(commonReviews, myName, name, {
      firstCanSeeSecondCircle: canSeeCirclePosts,
      secondCanSeeFirstCircle: targetCanSeeMyCircle,
    }).length;

    const rows = (pendingRows ?? []) as { sender_name: string; receiver_name: string }[];
    initialCircleStatus = canSeeCirclePosts
      ? "one_way"
      : rows.some((r) => r.sender_name === myName && r.receiver_name === name)
        ? "sent"
        : "none";
    initialHasIncomingRequest = rows.some((r) => r.sender_name === name && r.receiver_name === myName);
  }

  const accountType = normalizeAccountType(profile?.account_type);
  const isCircleMember = circleOwnerNames.has(name);

  const [profileReviewsPage, hiddenCircleCountResult, reputation] = await Promise.all([
    loadProfileReviewsPage(admin, name, myName, { limit: PROFILE_REVIEWS_PAGE_SIZE }),
    myName !== name && !isCircleMember
      ? admin
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("reviewer_name", name)
          .eq("visibility", "circle")
          .is("deleted_at", null)
          .is("hidden_at", null)
          .is("reported_at", null)
          .eq("status", "active")
      : Promise.resolve({ count: 0 }),
    getUserProfileReputation(admin, name),
  ]);

  if (profileReviewsPage.reviews.length === 0 && !profile) notFound();

  const hasAnyCirclePosts = (hiddenCircleCountResult.count ?? 0) > 0;
  const hasHiddenCirclePosts =
    myName !== name &&
    !isCircleMember &&
    hasAnyCirclePosts;

  const visibleReviews = profileReviewsPage.reviews;
  const publicBestReviews = filterGlobalTrendingReviews(
    ((publicBestReviewRows ?? []) as unknown[])
      .map((review) => normalizeReview(review as Parameters<typeof normalizeReview>[0]))
  );

  return (
    <FriendProfileClient
      key={name}
      name={name}
      displayName={displayName}
      bio={profile?.bio ?? ""}
      accountType={accountType}
      reviews={visibleReviews}
      publicBestReviews={publicBestReviews}
      hasHiddenCirclePosts={hasHiddenCirclePosts}
      initialMyName={myName}
      initialCircleStatus={initialCircleStatus}
      initialTheirCircleCount={initialTheirCircleCount}
      initialCommonRestaurantCount={initialCommonRestaurantCount}
      initialHasIncomingRequest={initialHasIncomingRequest}
      tasteTrust={tasteTrustSummaryFromProfile(profile)}
      reputation={reputation}
      initialHasMore={profileReviewsPage.hasMore}
      initialNextCursor={profileReviewsPage.nextCursor}
      likeCountMap={profileReviewsPage.likeCountMap}
      commentMap={profileReviewsPage.commentMap}
      likedByMeMap={profileReviewsPage.likedByMeMap}
      bookmarkedPostMap={profileReviewsPage.bookmarkedPostMap}
      profileMap={profileReviewsPage.profileMap}
    />
  );
}
