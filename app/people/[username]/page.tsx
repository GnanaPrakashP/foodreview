import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Review } from "@/lib/types";
import FriendProfileClient from "@/components/people/FriendProfileClient";
import { normalizeAccountType } from "@/lib/circle";
import { hasCircleAccess } from "@/lib/circle-db";
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

  const [{ data: { user } }, { data: profiles }, { data: ownerAllReviews }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("first_name, last_name, username, account_type")
      .eq("username", name)
      .limit(1)
      .returns<ProfileSummary[]>(),
    admin
      .from("reviews")
      .select("*")
      .eq("reviewer_name", name)
      .order("created_at", { ascending: false })
      .returns<Review[]>(),
  ]);

  const profile = (profiles ?? [])[0] ?? null;

  if ((!ownerAllReviews || ownerAllReviews.length === 0) && !profile) notFound();

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const displayName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim()
    : name;

  let circleOwnerNames = new Set<string>();
  if (myName && myName !== name) {
    const canSeeCirclePosts = await hasCircleAccess(supabase, name, myName);
    if (canSeeCirclePosts) circleOwnerNames = new Set([name]);
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
      name={name}
      displayName={displayName}
      accountType={accountType}
      reviews={visibleReviews}
      hasHiddenCirclePosts={hasHiddenCirclePosts}
    />
  );
}
