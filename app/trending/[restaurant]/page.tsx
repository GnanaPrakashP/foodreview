import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Review, Comment } from "@/lib/types";
import RestaurantPostsClient from "@/components/trending/RestaurantPostsClient";
import { ArrowLeft } from "lucide-react";
import { restaurantGradient } from "@/lib/profile";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ restaurant: string }>;
  searchParams: Promise<{ circle?: string }>;
}

function avgRating(review: Review): number {
  const rated = review.items.filter((it) => it.rating > 0);
  if (!rated.length) return 0;
  return rated.reduce((s, it) => s + it.rating, 0) / rated.length;
}

export default async function RestaurantPostsPage({ params, searchParams }: Props) {
  const { restaurant } = await params;
  const { circle } = await searchParams;
  const circleOnly = circle === "1";
  const restaurantName = decodeURIComponent(restaurant);

  const supabase = await createClient();

  const [
    { data: { user } },
    { data: allReviews },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<Review[]>(),
  ]);

  const reviews = allReviews ?? [];
  const restaurantReviews = reviews.filter((r) => r.restaurant_name === restaurantName);

  if (restaurantReviews.length === 0) notFound();

  // Fetch circle members for the current user
  let circleMembers: string[] = [];
  let mutualCircleMembers: string[] = [];
  const myName = user?.user_metadata?.full_name ?? "";
  if (myName) {
    const { data: circleRaw } = await (supabase as ReturnType<typeof supabase.from>)
      .from("circle_memberships")
      .select("user_name, member_name")
      .or(`user_name.eq.${myName},member_name.eq.${myName}`) as unknown as { data: { user_name: string; member_name: string }[] | null };

    const myCircleMembers = new Set((circleRaw ?? []).filter((r) => r.user_name === myName).map((r) => r.member_name));
    const joinedCircles = new Set((circleRaw ?? []).filter((r) => r.member_name === myName).map((r) => r.user_name));
    circleMembers = Array.from(joinedCircles);
    mutualCircleMembers = circleMembers.filter((member) => myCircleMembers.has(member));
  }

  const reviewIds = restaurantReviews.map((r) => r.id);

  const [{ data: rawLikes }, { data: rawComments }] = await Promise.all([
    supabase.from("likes").select("post_id").in("post_id", reviewIds),
    supabase
      .from("comments")
      .select("id, post_id, user_name, content, created_at")
      .in("post_id", reviewIds)
      .order("created_at", { ascending: false })
      .returns<Comment[]>(),
  ]);

  // Like counts
  const likeCountMap: Record<string, number> = {};
  for (const like of (rawLikes ?? []) as { post_id: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
  }

  // Comment counts + top comment
  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const c of rawComments ?? []) {
    const ex = commentMap[c.post_id];
    if (!ex) commentMap[c.post_id] = { count: 1, top: c };
    else ex.count++;
  }

  // Rank each review within its reviewer's full history
  const visitCounts = new Map<string, number>();
  for (const r of reviews) {
    const k = `${r.reviewer_name}\x00${r.restaurant_name}`;
    visitCounts.set(k, (visitCounts.get(k) ?? 0) + 1);
  }

  const byReviewer = new Map<string, Review[]>();
  for (const r of reviews) {
    const g = byReviewer.get(r.reviewer_name) ?? [];
    g.push(r);
    byReviewer.set(r.reviewer_name, g);
  }

  const rankMap: Record<string, { rank: number; total: number; visitCount: number }> = {};
  for (const [, group] of byReviewer) {
    const sorted = [...group].sort((a, b) => avgRating(b) - avgRating(a));
    sorted.forEach((r, i) => {
      rankMap[r.id] = {
        rank: i + 1,
        total: group.length,
        visitCount: visitCounts.get(`${r.reviewer_name}\x00${r.restaurant_name}`) ?? 1,
      };
    });
  }

  // Avg score for the header
  const allRated = restaurantReviews.flatMap((r) => r.items.filter((it) => it.rating > 0));
  const avgScore = allRated.length > 0
    ? allRated.reduce((s, it) => s + it.rating, 0) / allRated.length * 2
    : 0;

  const area = restaurantReviews.find((r) => r.area)?.area ?? null;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/trending" style={{ textDecoration: "none", flexShrink: 0 }}>
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
              {area && `${area} · `}{restaurantReviews.length} post{restaurantReviews.length !== 1 ? "s" : ""}
              {avgScore > 0 ? ` · ${avgScore.toFixed(1)}/10 avg` : ""}
            </p>
          </div>
        </div>
      </div>

      <RestaurantPostsClient
        restaurantReviews={restaurantReviews}
        myName={myName}
        circleMembers={circleMembers}
        mutualCircleMembers={mutualCircleMembers}
        likeCountMap={likeCountMap}
        commentMap={commentMap}
        rankMap={rankMap}
        circleOnly={circleOnly}
      />

    </div>
  );
}
