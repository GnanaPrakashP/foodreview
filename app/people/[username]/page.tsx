import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Review } from "@/lib/types";
import FriendProfileClient from "@/components/people/FriendProfileClient";
import { normalizeAccountType } from "@/lib/circle";
import { hasCircleAccess } from "@/lib/circle-db";
import { profileDisplayName } from "@/lib/profile-names";
import { REVIEW_SELECT } from "@/lib/selects";
import { filterProfileReviews, isReviewSuppressed, normalizeVisibility } from "@/lib/visibility";

interface Props {
  params: Promise<{ username: string }>;
}

export const dynamic = "force-dynamic";

type ProfileSummary = {
  first_name: string;
  last_name: string;
  username: string | null;
  account_type: string | null;
};

export default async function UserProfilePage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);

  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: { user } }, { data: profiles }, { data: ownerAllReviews }, { data: theirMemberRows }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("first_name, last_name, username, account_type")
      .eq("username", name)
      .limit(1)
      .returns<ProfileSummary[]>(),
    admin
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("reviewer_name", name)
      .order("created_at", { ascending: false })
      .returns<Review[]>(),
    // Fetch circle member list for the profile owner to show their circle count immediately
    admin
      .from("circle_memberships")
      .select("member_name")
      .eq("user_name", name),
  ]);

  const profile = (profiles ?? [])[0] ?? null;

  if ((!ownerAllReviews || ownerAllReviews.length === 0) && !profile) notFound();

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const displayName = profileDisplayName(profile, name);

  const initialTheirCircleCount = (theirMemberRows ?? []).length;

  let circleOwnerNames = new Set<string>();
  let initialCircleStatus: "one_way" | "sent" | "none" = "none";
  let initialHasIncomingRequest = false;

  if (myName && myName !== name) {
    const [canSeeCirclePosts, { data: pendingRows }] = await Promise.all([
      hasCircleAccess(supabase, name, myName),
      // Fetch pending requests in both directions between viewer and profile owner
      admin
        .from("circle_requests")
        .select("sender_name, receiver_name")
        .in("sender_name", [myName, name])
        .in("receiver_name", [myName, name])
        .eq("status", "pending"),
    ]);

    if (canSeeCirclePosts) circleOwnerNames = new Set([name]);

    const rows = (pendingRows ?? []) as { sender_name: string; receiver_name: string }[];
    initialCircleStatus = canSeeCirclePosts
      ? "one_way"
      : rows.some((r) => r.sender_name === myName && r.receiver_name === name)
        ? "sent"
        : "none";
    initialHasIncomingRequest = rows.some((r) => r.sender_name === name && r.receiver_name === myName);
  }

  const accountType = normalizeAccountType(profile?.account_type);
  const rawReviews = ownerAllReviews ?? [];
  const isCircleMember = circleOwnerNames.has(name);
  const hasAnyCirclePosts = (ownerAllReviews ?? []).some(
    (review) => !isReviewSuppressed(review) && normalizeVisibility(review.visibility) === "circle"
  );
  const hasHiddenCirclePosts =
    myName !== name &&
    !isCircleMember &&
    hasAnyCirclePosts;

  const visibleReviews = filterProfileReviews(rawReviews, name, {
    viewerName: myName,
    circleOwnerNames,
  });

  return (
    <FriendProfileClient
      key={name}
      name={name}
      displayName={displayName}
      accountType={accountType}
      reviews={visibleReviews}
      hasHiddenCirclePosts={hasHiddenCirclePosts}
      initialMyName={myName}
      initialCircleStatus={initialCircleStatus}
      initialTheirCircleCount={initialTheirCircleCount}
      initialHasIncomingRequest={initialHasIncomingRequest}
    />
  );
}
