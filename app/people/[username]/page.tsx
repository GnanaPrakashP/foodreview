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
  account_type: string | null;
};

export default async function UserProfilePage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);

  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: { user } }, { data: reviews }, { data: profiles }, { data: ownerAllReviews }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("reviews")
      .select("*")
      .eq("reviewer_name", name)
      .order("created_at", { ascending: false })
      .returns<Review[]>(),
    supabase
      .from("profiles")
      .select("first_name, last_name, account_type")
      .limit(1000)
      .returns<ProfileSummary[]>(),
    admin
      .from("reviews")
      .select("*")
      .eq("reviewer_name", name)
      .order("created_at", { ascending: false })
      .returns<Review[]>(),
  ]);

  const profile = (profiles ?? []).find((row) => `${row.first_name} ${row.last_name}`.trim() === name);

  if ((!reviews || reviews.length === 0) && !profile) notFound();

  const myName = user?.user_metadata?.full_name ?? "";
  let circleOwnerNames = new Set<string>();
  if (myName && myName !== name) {
    const canSeeCirclePosts = await hasCircleAccess(supabase, name, myName);
    if (canSeeCirclePosts) circleOwnerNames = new Set([name]);
  }

  const accountType = normalizeAccountType(profile?.account_type);
  const rawReviews = reviews ?? [];
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
      accountType={accountType}
      reviews={visibleReviews}
      hasHiddenCirclePosts={hasHiddenCirclePosts}
    />
  );
}
