"use client";

import { useState, useEffect, useMemo } from "react";
import type { Review } from "@/lib/types";

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

function WishlistBtn({ reviewId, restaurantName }: { reviewId: string; restaurantName: string }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const list: { id: string }[] = JSON.parse(localStorage.getItem("fc_wishlist") ?? "[]");
    setSaved(list.some(item => item.id === reviewId));
  }, [reviewId]);

  function toggle() {
    const list: { id: string; restaurant_name: string; added_at: string }[] =
      JSON.parse(localStorage.getItem("fc_wishlist") ?? "[]");
    const next = saved
      ? list.filter(item => item.id !== reviewId)
      : [...list, { id: reviewId, restaurant_name: restaurantName, added_at: new Date().toISOString() }];
    localStorage.setItem("fc_wishlist", JSON.stringify(next));
    setSaved(!saved);
  }

  return (
    <button
      onClick={toggle}
      style={{
        background: saved ? "rgba(232,168,48,0.1)" : "var(--surface)",
        border: `1px solid ${saved ? "rgba(232,168,48,0.3)" : "var(--border)"}`,
        borderRadius: "10px",
        padding: "6px 12px",
        fontSize: "11px",
        color: saved ? "var(--gold)" : "var(--muted)",
        fontWeight: 600,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {saved ? "✓ Saved" : "+ Wishlist"}
    </button>
  );
}

export default function ComparisonSection({
  friendName,
  friendReviews,
  allReviews,
}: {
  friendName: string;
  friendReviews: Review[];
  allReviews: Review[];
}) {
  const [myName, setMyName] = useState("");
  const [mounted, setMounted] = useState(false);

  // All derived values computed unconditionally
  const myReviews = useMemo(
    () => allReviews.filter(r => r.reviewer_name === myName),
    [allReviews, myName]
  );

  const myRestaurants = useMemo(
    () => new Set(myReviews.map(r => r.restaurant_name)),
    [myReviews]
  );

  const notTriedByMe = useMemo(() => {
    const seen = new Set<string>();
    const result: Review[] = [];
    for (const r of friendReviews) {
      if (!myRestaurants.has(r.restaurant_name) && !seen.has(r.restaurant_name)) {
        seen.add(r.restaurant_name);
        result.push(r);
      }
    }
    return result.sort((a, b) => avgRating(b) - avgRating(a)).slice(0, 5);
  }, [friendReviews, myRestaurants]);

  const bothTried = useMemo(() => {
    const myMap = new Map(myReviews.map(r => [r.restaurant_name, avgRating(r)]));
    const seen = new Set<string>();
    return friendReviews
      .filter(r => {
        if (!myMap.has(r.restaurant_name) || seen.has(r.restaurant_name)) return false;
        seen.add(r.restaurant_name);
        return true;
      })
      .slice(0, 3)
      .map(r => ({
        restaurant: r.restaurant_name,
        theirScore: avgRating(r),
        myScore: myMap.get(r.restaurant_name) ?? 0,
      }));
  }, [friendReviews, myReviews]);

  useEffect(() => {
    setMyName(localStorage.getItem("fc_my_name") ?? "");
    setMounted(true);
  }, []);

  if (!mounted || !myName || myName === friendName) return null;
  if (notTriedByMe.length === 0 && bothTried.length === 0) return null;

  const firstName = friendName.split(/[\s_]+/)[0] ?? friendName;

  return (
    <div className="px-5 pb-5">
      {notTriedByMe.length > 0 && (
        <>
          <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "10px" }}>
            Places {firstName} tried that you haven&apos;t
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
            {notTriedByMe.map(r => {
              const rating = avgRating(r);
              return (
                <div key={r.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.restaurant_name}</p>
                    {rating > 0 && (
                      <p style={{ fontSize: "11px", color: "var(--gold)", marginTop: "2px" }}>
                        {firstName} gave it {rating.toFixed(1)}/5
                      </p>
                    )}
                  </div>
                  <WishlistBtn reviewId={r.id} restaurantName={r.restaurant_name} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {bothTried.length > 0 && (
        <>
          <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "10px" }}>
            Places you&apos;ve both tried
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {bothTried.map(item => (
              <div key={item.restaurant} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
                <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>{item.restaurant}</p>
                <div style={{ display: "flex", gap: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                    {firstName}:{" "}
                    <span style={{ color: "var(--gold)", fontWeight: 700 }}>{item.theirScore.toFixed(1)}</span>
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                    You:{" "}
                    <span style={{ color: "var(--gold)", fontWeight: 700 }}>{item.myScore.toFixed(1)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
