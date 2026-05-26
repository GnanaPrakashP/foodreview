import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Comment, Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { canViewerSeeReview, isReviewSuppressed } from "@/lib/visibility";
import ReviewDetailClient from "@/components/reviews/ReviewDetailClient";
import { notificationProfileName } from "@/lib/notifications";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { COMMENT_SELECT, REVIEW_SELECT } from "@/lib/selects";
import { normalizeReview } from "@/lib/server/normalize-review";
import { getPostTasteTrustSummary } from "@/lib/server/taste-trust";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = createAdminClient();

  const { data: review } = await db
    .from("reviews")
    .select("reviewer_name, restaurant_name, body, visibility, deleted_at, hidden_at, reported_at, status")
    .eq("id", id)
    .maybeSingle<Pick<Review, "reviewer_name" | "restaurant_name" | "body" | "visibility" | "deleted_at" | "hidden_at" | "reported_at" | "status">>();

  const genericMeta: Metadata = {
    title: "CircleBites post",
    description: "This post may require access to view.",
  };

  if (!review || isReviewSuppressed(review as Review) || review.visibility !== "public") {
    return genericMeta;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://circlebites.in";
  const title = `${review.reviewer_name} tried ${review.restaurant_name} on CircleBites`;
  const description = review.body
    ? review.body.slice(0, 160)
    : "Check this food review on CircleBites";
  const imageUrl = `${siteUrl}/api/posts/${encodeURIComponent(id)}/share-image`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${siteUrl}/reviews/${encodeURIComponent(id)}`,
      images: [{ url: imageUrl, width: 640, height: 900, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ReviewDetailPage({ params }: Props) {
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

  const [{ data: likeRows }, { data: comments }, { data: viewerLike }, { data: viewerBookmark }, postTasteTrustSummary] = await Promise.all([
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
    getPostTasteTrustSummary(readDb, normalizedReview.id),
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
      initialTasteTrustSummary={postTasteTrustSummary}
    />
  );
}
