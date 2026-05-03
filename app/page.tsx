import { createClient } from "@/lib/supabase/server";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import CircleGapBanner from "@/components/circle/CircleGapBanner";
import NotificationBell from "@/components/reviews/NotificationBell";
import Link from "next/link";

export const dynamic = "force-dynamic";

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

export default async function CirclePage() {
  const supabase = await createClient();

  const [{ data: reviews }, { data: rawLikes }, { data: rawComments }] = await Promise.all([
    supabase.from("reviews").select("*").order("created_at", { ascending: false }).limit(200).returns<Review[]>(),
    supabase.from("likes").select("post_id"),
    supabase.from("comments").select("id, post_id, user_name, content, created_at").order("created_at", { ascending: false }).limit(1000).returns<Comment[]>(),
  ]);

  const allReviews = reviews ?? [];

  // Like count per post
  const likeCountMap = new Map<string, number>();
  for (const like of (rawLikes ?? []) as { post_id: string }[]) {
    likeCountMap.set(like.post_id, (likeCountMap.get(like.post_id) ?? 0) + 1);
  }

  // Comment count + most recent comment per post (rawComments already DESC)
  const commentMap = new Map<string, { count: number; top: Comment }>();
  for (const comment of rawComments ?? []) {
    const ex = commentMap.get(comment.post_id);
    if (!ex) {
      commentMap.set(comment.post_id, { count: 1, top: comment });
    } else {
      ex.count++;
    }
  }

  // Visit count per (reviewer, restaurant)
  const visitCounts = new Map<string, number>();
  for (const r of allReviews) {
    const k = `${r.reviewer_name}\x00${r.restaurant_name}`;
    visitCounts.set(k, (visitCounts.get(k) ?? 0) + 1);
  }

  // Rank per review
  const byReviewer = new Map<string, Review[]>();
  for (const r of allReviews) {
    const g = byReviewer.get(r.reviewer_name) ?? [];
    g.push(r);
    byReviewer.set(r.reviewer_name, g);
  }
  const rankMap = new Map<string, { rank: number; total: number; visitCount: number }>();
  for (const [, group] of byReviewer) {
    const sorted = [...group].sort((a, b) => avgRating(b) - avgRating(a));
    sorted.forEach((r, i) =>
      rankMap.set(r.id, {
        rank: i + 1,
        total: group.length,
        visitCount: visitCounts.get(`${r.reviewer_name}\x00${r.restaurant_name}`) ?? 1,
      })
    );
  }

  const isEmpty = allReviews.length === 0;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div className="px-5 pt-6 pb-3" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ color: "var(--muted)", fontSize: "13px", fontFamily: "'DM Sans', sans-serif" }}>Your circle</p>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: "28px", color: "var(--cream)", lineHeight: "1.2", marginTop: "4px" }}>
            What they&rsquo;re{" "}
            <span style={{ fontStyle: "italic", color: "var(--orange)" }}>eating</span>
          </h1>
        </div>
        <div style={{ paddingTop: "8px" }}>
          <NotificationBell />
        </div>
      </div>

      {!isEmpty && <CircleGapBanner allReviews={allReviews} />}

      {isEmpty && (
        <div className="flex flex-col items-center gap-3 py-20 text-center px-6">
          <span style={{ fontSize: "52px" }}>👥</span>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)" }}>Your circle is empty</p>
          <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif" }}>
            Add friends to see what they&apos;re eating — or be the first to share a spot.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <Link href="/people">
              <button style={{ background: "var(--surface)", color: "var(--cream)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 20px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                Find friends →
              </button>
            </Link>
            <Link href="/reviews/new">
              <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "12px 20px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                Share a spot →
              </button>
            </Link>
          </div>
        </div>
      )}

      {!isEmpty && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 16px 100px" }}>
          {allReviews.map((review) => {
            const info = rankMap.get(review.id);
            const eng = commentMap.get(review.id);
            return (
              <CircleFeedCard
                key={review.id}
                review={review}
                rank={info?.rank ?? null}
                totalByReviewer={info?.total ?? 1}
                visitCount={info?.visitCount ?? 1}
                initialLikeCount={likeCountMap.get(review.id) ?? 0}
                initialCommentCount={eng?.count ?? 0}
                topComment={eng?.top ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
