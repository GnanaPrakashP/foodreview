import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Comment, Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { canViewerSeeReview } from "@/lib/visibility";
import { notificationProfileName } from "@/lib/notifications";
import ReviewDetailClient from "@/components/reviews/ReviewDetailClient";
import { buildProfileDisplayMap } from "@/lib/profile-display";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CommentPostPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: review }, { data: { user } }] = await Promise.all([
    supabase
      .from("reviews")
      .select("*")
      .eq("id", id)
      .single<Review>(),
    supabase.auth.getUser(),
  ]);

  if (!review) notFound();

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
  if (myName && myName !== review.reviewer_name) {
    const canSeeCirclePost = await hasCircleAccess(supabase, review.reviewer_name, myName);
    if (canSeeCirclePost) circleOwnerNames = new Set([review.reviewer_name]);
  }

  if (!canViewerSeeReview(review, { viewerName: myName, circleOwnerNames })) notFound();

  const [{ data: likeRows }, { data: comments }] = await Promise.all([
    supabase.from("likes").select("post_id").eq("post_id", review.id),
    supabase
      .from("comments")
      .select("*")
      .eq("post_id", review.id)
      .order("created_at", { ascending: true })
      .returns<Comment[]>(),
  ]);

  const profileMap = await buildProfileDisplayMap(supabase, [
    review.reviewer_name,
    myName,
    ...(comments ?? []).map((c: Comment) => c.user_name),
  ]);

  return (
    <ReviewDetailClient
      review={review}
      initialLikeCount={likeRows?.length ?? 0}
      initialComments={comments ?? []}
      initialMyName={myName}
      profileMap={profileMap}
      autoFocusComment
      backHref="/"
    />
  );
}
