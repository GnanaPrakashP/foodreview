import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Comment, Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { canViewerSeeReview } from "@/lib/visibility";
import { notificationProfileName } from "@/lib/notifications";
import ReviewDetailClient from "@/components/reviews/ReviewDetailClient";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { COMMENT_SELECT, REVIEW_SELECT } from "@/lib/selects";
import { normalizeReview } from "@/lib/server/normalize-review";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CommentPostPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const readDb = createAdminClient();

  const [{ data: review }, { data: { user } }] = await Promise.all([
    readDb
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("id", id)
      .single<Review>(),
    supabase.auth.getUser(),
  ]);

  if (!review) notFound();
  const normalizedReview = normalizeReview(review as Parameters<typeof normalizeReview>[0]);

  let myName = (user?.user_metadata?.username as string) ?? "";
  if (!myName && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, username")
      .eq("id", user.id)
      .maybeSingle();
    if (profile) myName = notificationProfileName(profile);
  }

  let circleOwnerNames = new Set<string>();
  if (myName && myName !== normalizedReview.reviewer_name) {
    const canSeeCirclePost = await hasCircleAccess(supabase, normalizedReview.reviewer_name, myName);
    if (canSeeCirclePost) circleOwnerNames = new Set([normalizedReview.reviewer_name]);
  }

  if (!canViewerSeeReview(normalizedReview, { viewerName: myName, circleOwnerNames })) notFound();

  const [{ data: likeRows }, { data: comments }, { data: viewerLike }, { data: viewerBookmark }] = await Promise.all([
    readDb.from("likes").select("post_id, user_name").eq("post_id", normalizedReview.id),
    readDb
      .from("comments")
      .select(COMMENT_SELECT)
      .eq("post_id", normalizedReview.id)
      .order("created_at", { ascending: true })
      .returns<Comment[]>(),
    myName
      ? readDb.from("likes").select("post_id").eq("post_id", normalizedReview.id).eq("user_name", myName).maybeSingle()
      : Promise.resolve({ data: null }),
    myName
      ? readDb.from("wishlist").select("post_id").eq("post_id", normalizedReview.id).eq("user_name", myName).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profileMap = await buildProfileDisplayMap(supabase, [
    normalizedReview.reviewer_name,
    myName,
    ...(comments ?? []).map((c: Comment) => c.user_name),
  ]);

  return (
    <ReviewDetailClient
      review={normalizedReview}
      initialLikeCount={likeRows?.length ?? 0}
      initialComments={comments ?? []}
      initialMyName={myName}
      initialLiked={Boolean(viewerLike)}
      initialBookmarked={Boolean(viewerBookmark)}
      initialSnapshotAt={Date.now()}
      profileMap={profileMap}
      autoFocusComment
      backHref="/"
    />
  );
}
