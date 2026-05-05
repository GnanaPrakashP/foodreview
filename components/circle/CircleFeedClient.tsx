"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Review, Comment } from "@/lib/types";
import { canShowInCircleFeed } from "@/lib/circle";
import { Users } from "lucide-react";

interface Props {
  allReviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  rankMap: Record<string, { rank: number; total: number; visitCount: number }>;
}

export default function CircleFeedClient({ allReviews, likeCountMap, commentMap, rankMap }: Props) {
  const [circle, setCircle] = useState<string[]>([]);
  const [mutualCircle, setMutualCircle] = useState<string[]>([]);
  const [myName, setMyName] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem("fc_my_name") ?? "";
    setMyName(name);
    if (!name) { setMounted(true); return; }
    fetch(`/api/circle/status?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => {
        setCircle(data.members ?? []);
        setMutualCircle(data.mutualMembers ?? []);
      })
      .catch(() => {})
      .finally(() => setMounted(true));
  }, []);

  const circleSet = useMemo(() => new Set(circle), [circle]);
  const mutualSet = useMemo(() => new Set(mutualCircle), [mutualCircle]);

  const circleReviews = useMemo(
    () => allReviews.filter((r) => canShowInCircleFeed(r, myName, circleSet, mutualSet)),
    [allReviews, circleSet, mutualSet, myName]
  );

  // Don't render until we've read localStorage to avoid flash
  if (!mounted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 16px 100px" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse" style={{ height: "280px", background: "var(--card)", borderRadius: "20px", opacity: 0.5 }} />
        ))}
      </div>
    );
  }

  // Circle is empty
  if (circle.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 24px 100px", gap: "12px" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--orange-dim)", border: "1.5px solid rgba(240,96,48,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Users size={28} strokeWidth={1.8} color="var(--orange)" />
        </div>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Your circle is empty
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "260px" }}>
          Add friends to see what they&apos;re eating — or be the first to share a spot.
        </p>
        <div style={{ display: "flex", gap: "10px", marginTop: "8px", width: "100%", maxWidth: "320px" }}>
          <Link href="/people" style={{ flex: 1, textDecoration: "none" }}>
            <button style={{ width: "100%", background: "var(--surface)", color: "var(--cream)", border: "1px solid var(--border)", borderRadius: "14px", padding: "13px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              Find friends
            </button>
          </Link>
          <Link href="/reviews/new" style={{ flex: 1, textDecoration: "none" }}>
            <button style={{ width: "100%", background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "13px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              Share a spot
            </button>
          </Link>
        </div>
      </div>
    );
  }

  // Circle has people but none have posted yet
  if (circleReviews.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 24px 100px", gap: "12px" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--orange-dim)", border: "1.5px solid rgba(240,96,48,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Users size={28} strokeWidth={1.8} color="var(--orange)" />
        </div>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
          Your circle hasn&apos;t posted yet
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "260px" }}>
          {circle.length === 1 ? "They haven't" : "None of them have"} logged a place yet. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 16px 100px" }}>
        {circleReviews.map((review) => {
          const info = rankMap[review.id];
          const eng = commentMap[review.id];
          return (
            <CircleFeedCard
              key={review.id}
              review={review}
              initialLikeCount={likeCountMap[review.id] ?? 0}
              initialCommentCount={eng?.count ?? 0}
              topComment={eng?.top ?? null}
            />
          );
        })}
      </div>
    </>
  );
}
