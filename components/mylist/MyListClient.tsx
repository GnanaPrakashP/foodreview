"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Review } from "@/lib/types";
import { computeGapSuggestions, type GapSuggestion } from "@/lib/discovery";
import { isWishlisted, toggleWishlist } from "@/lib/wishlist";
import { buildMyDishMap, buildAllDishMap, getRegulars, getMenuExplorers } from "@/lib/visits";
import { restaurantGradient } from "@/lib/profile";
import { clearStoredActor, getStoredActorName, setStoredActorName } from "@/lib/browser-actor";

/* ─── helpers ────────────────────────────────────── */

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

const RANK_COLORS = ["#E8A830", "#9CA3AF", "#CD7C2F"];

/* ─── Menu progress bar ──────────────────────────── */

function MenuProgress({
  restaurant,
  tried,
  total,
}: {
  restaurant: string;
  tried: string[];
  total: number;
}) {
  const pct = total > 0 ? Math.round((tried.length / total) * 100) : 0;
  const isExplorer = tried.length >= 5;

  // Fill out to `total` slots, padding with empty slots
  const slots = Array.from({ length: Math.max(total, tried.length) }, (_, i) => tried[i] ?? null);

  return (
    <div style={{ marginTop: "10px", paddingBottom: "4px" }}>
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <p style={{ fontSize: "10px", color: "var(--gold)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px" }}>
          Dishes at {restaurant}
        </p>
        <p style={{ fontSize: "11px", color: "var(--muted)" }}>
          {tried.length} of {total}
          {isExplorer && <span style={{ color: "var(--gold)", marginLeft: "6px", fontWeight: 600 }}>Menu Explorer ✦</span>}
        </p>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: "4px",
          background: "var(--surface)",
          borderRadius: "4px",
          overflow: "hidden",
          marginBottom: "8px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--gold)",
            borderRadius: "4px",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Dish chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {slots.map((dish, i) =>
          dish ? (
            <span
              key={i}
              style={{
                background: "rgba(232,168,48,0.1)",
                border: "1px solid rgba(232,168,48,0.2)",
                borderRadius: "20px",
                padding: "3px 9px",
                fontSize: "10px",
                color: "var(--gold)",
                fontWeight: 500,
              }}
            >
              {dish}
            </span>
          ) : (
            <span
              key={i}
              style={{
                background: "var(--surface)",
                border: "1px dashed var(--border)",
                borderRadius: "20px",
                padding: "3px 9px",
                fontSize: "10px",
                color: "var(--border)",
                fontStyle: "italic",
              }}
            >
              try something new
            </span>
          )
        )}
      </div>
    </div>
  );
}

/* ─── Gap card ───────────────────────────────────── */

function GapCard({ gap }: { gap: GapSuggestion }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(isWishlisted(gap.wishlistId));
  }, [gap.wishlistId]);

  function handleWishlist() {
    setSaved(toggleWishlist({ id: gap.wishlistId, restaurant_name: gap.restaurant_name }));
  }

  const typeIcon = gap.type === "cuisine" ? "🗺️" : gap.type === "dish" ? "🍴" : "📍";

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>
          {typeIcon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", lineHeight: 1.3, marginBottom: "4px" }}>
            {gap.headline}
          </p>
          <p style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.4 }}>{gap.subline}</p>
        </div>
      </div>
      <button
        onClick={handleWishlist}
        style={{
          width: "100%",
          background: saved ? "rgba(232,168,48,0.12)" : "var(--surface)",
          border: `1px solid ${saved ? "rgba(232,168,48,0.35)" : "var(--border)"}`,
          borderRadius: "10px",
          padding: "9px",
          color: saved ? "var(--gold)" : "var(--muted)",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          transition: "all 0.15s",
        }}
      >
        {saved ? "⭐ On your wishlist" : "☆ Add to Wishlist"}
      </button>
    </div>
  );
}

/* ─── Name setup ─────────────────────────────────── */

function NameSetup({ onSet }: { onSet: (name: string) => void }) {
  const [input, setInput] = useState("");
  function save() {
    const n = input.trim();
    if (!n) return;
    setStoredActorName(n);
    onSet(n);
  }
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", padding: "20px", margin: "20px 20px 0", textAlign: "center" }}>
      <span style={{ fontSize: "40px", display: "block", marginBottom: "10px" }}>📍</span>
      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>
        Personalise your Food Map
      </p>
      <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px", lineHeight: 1.5 }}>
        Enter your name to see your reviews and discover what you haven&apos;t tried yet.
      </p>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "12px 14px", marginBottom: "12px" }}>
        <input
          type="text"
          placeholder="Your name…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          autoComplete="off"
          style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontSize: "15px" }}
        />
      </div>
      <button
        onClick={save}
        disabled={!input.trim()}
        style={{ width: "100%", background: input.trim() ? "var(--orange)" : "var(--surface)", color: input.trim() ? "white" : "var(--muted)", border: "none", borderRadius: "14px", padding: "14px", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: input.trim() ? "pointer" : "default", transition: "all 0.15s" }}
      >
        Show My List →
      </button>
    </div>
  );
}

/* ─── Main component ─────────────────────────────── */

export default function MyListClient({ allReviews }: { allReviews: Review[] }) {
  const [myName, setMyName] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMyName(getStoredActorName() || null);
  }, []);

  // All hooks must run unconditionally — before any early returns
  const myReviews = useMemo(
    () => (myName ? allReviews.filter((r) => r.reviewer_name === myName) : []),
    [myName, allReviews]
  );

  const sorted = useMemo(
    () => [...myReviews].sort((a, b) => avgRating(b) - avgRating(a)),
    [myReviews]
  );

  const visitCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of myReviews) {
      map.set(r.restaurant_name, (map.get(r.restaurant_name) ?? 0) + 1);
    }
    return map;
  }, [myReviews]);

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return sorted.filter((r) => {
      if (seen.has(r.restaurant_name)) return false;
      seen.add(r.restaurant_name);
      return true;
    });
  }, [sorted]);

  const myDishMap = useMemo(() => buildMyDishMap(myReviews), [myReviews]);
  const allDishMap = useMemo(() => buildAllDishMap(allReviews), [allReviews]);
  const regulars = useMemo(() => getRegulars(myReviews, 2), [myReviews]);
  const explorers = useMemo(() => getMenuExplorers(myReviews, 3), [myReviews]);
  const gaps = useMemo(() => computeGapSuggestions(myReviews, allReviews), [myReviews, allReviews]);

  const topRated = useMemo(
    () => myReviews.filter((r) => avgRating(r) >= 4).length,
    [myReviews]
  );
  const avgOverall = useMemo(
    () => myReviews.length > 0
      ? myReviews.reduce((s, r) => s + avgRating(r), 0) / myReviews.length
      : 0,
    [myReviews]
  );

  // Conditional returns only after all hooks
  if (!mounted) return <div style={{ background: "var(--bg)", minHeight: "100vh" }} />;
  if (!myName) {
    return (
      <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
        <div className="px-5 pt-6 pb-2">
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "26px", color: "var(--cream)" }}>Your Food Map</h1>
        </div>
        <NameSetup onSet={setMyName} />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div className="px-5 pt-6 pb-2 flex items-end justify-between">
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "26px", color: "var(--cream)" }}>
            Your Food Map
          </h1>
          <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
            Every place {myName.split(/[\s_]+/)[0]} has tried, ranked
          </p>
        </div>
        <button
          onClick={() => { clearStoredActor(); setMyName(null); }}
          style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "11px", cursor: "pointer" }}
        >
          Not you?
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-2 px-5 mt-4">
        {[
          { num: deduped.length, label: "Places" },
          { num: avgOverall > 0 ? avgOverall.toFixed(1) : "–", label: "Avg rating" },
          { num: topRated, label: "Top-rated" },
        ].map((s) => (
          <div key={s.label} style={{ flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "22px", fontWeight: 800, color: "var(--cream)" }}>{s.num}</div>
            <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Regulars banner */}
      {regulars.length > 0 && (
        <div className="px-5 mt-5">
          <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "8px" }}>
            Your regulars
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {regulars.slice(0, 3).map((r) => (
              <div
                key={r.restaurant}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "var(--orange-dim)",
                  border: "1px solid rgba(240,96,48,0.3)",
                  borderRadius: "20px",
                  padding: "6px 12px",
                }}
              >
                <span style={{ fontSize: "12px" }}>🏠</span>
                <div>
                  <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--orange)", lineHeight: 1.2 }}>{r.restaurant}</p>
                  <p style={{ fontSize: "10px", color: "var(--muted)" }}>{r.visits} visit{r.visits !== 1 ? "s" : ""} · Regular</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu Explorer banner */}
      {explorers.length > 0 && (
        <div className="px-5 mt-3">
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {explorers.map((e) => (
              <div
                key={e.restaurant}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "rgba(232,168,48,0.08)",
                  border: "1px solid rgba(232,168,48,0.2)",
                  borderRadius: "20px",
                  padding: "6px 12px",
                }}
              >
                <span style={{ fontSize: "12px" }}>✦</span>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--gold)" }}>
                  Menu Explorer · {e.restaurant}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranked list */}
      <div className="px-5 mt-5">
        <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>
          Top Ranked
        </p>

        {deduped.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span style={{ fontSize: "48px" }}>📍</span>
            <p style={{ color: "var(--muted)", fontSize: "14px" }}>Nothing logged yet — go eat somewhere!</p>
            <Link href="/reviews/new">
              <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "12px 24px", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
                Log a place →
              </button>
            </Link>
          </div>
        )}

        <div className="flex flex-col">
          {deduped.map((review, i) => {
            const rating = avgRating(review);
            const visits = visitCounts.get(review.restaurant_name) ?? 1;
            const isRegular = visits >= 2; // threshold for demo; prod = 5
            const showMenu = visits >= 2;
            const myDishes = Array.from(myDishMap.get(review.restaurant_name) ?? new Set<string>()) as string[];
            const allDishes = Array.from(allDishMap.get(review.restaurant_name) ?? new Set<string>()) as string[];
            const totalDishes = Math.max(allDishes.length, myDishes.length);

            return (
              <div
                key={review.id}
                style={{ borderBottom: "1px solid var(--border)", paddingBottom: showMenu ? "12px" : "0" }}
              >
                <Link href={`/reviews/${review.id}`} className="block">
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "13px 0" }}>
                    {/* Rank */}
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: RANK_COLORS[i] ?? "var(--border)", width: "28px", textAlign: "center", flexShrink: 0 }}>
                      {i + 1}
                    </div>

                    {/* Avatar */}
                    <div style={{ width: "44px", height: "44px", background: restaurantGradient(review.restaurant_name), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                      {review.restaurant_name[0]?.toUpperCase() ?? "?"}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px" }}>
                          {review.restaurant_name}
                        </span>
                        {isRegular && (
                          <span style={{ background: "var(--orange-dim)", border: "1px solid rgba(240,96,48,0.3)", borderRadius: "20px", padding: "2px 8px", fontSize: "9px", fontWeight: 700, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0 }}>
                            Regular
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                        {visits > 1 ? `${visits} visits` : "1 visit"}
                        {review.items.length > 0 && ` · ${review.items.map((it) => it.name).join(", ")}`}
                      </div>
                    </div>

                    {/* Score */}
                    {rating > 0 && (
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800, color: "var(--cream)" }}>{rating.toFixed(1)}</span>
                        <span style={{ fontSize: "10px", color: "var(--muted)" }}>/5</span>
                      </div>
                    )}
                    <span style={{ fontSize: "14px", color: "var(--muted)" }}>›</span>
                  </div>
                </Link>

                {/* Menu challenge (visits >= 2) */}
                {showMenu && totalDishes > 0 && (
                  <div style={{ paddingLeft: "40px" }}>
                    <MenuProgress
                      restaurant={review.restaurant_name}
                      tried={myDishes}
                      total={totalDishes}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Gap suggestions */}
      {gaps.length > 0 && (
        <div className="px-5 mt-8 mb-2">
          <div style={{ marginBottom: "12px" }}>
            <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "4px" }}>
              You haven&apos;t tried yet
            </p>
            <p style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.4 }}>Based on what your circle loves</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {gaps.map((gap) => <GapCard key={gap.wishlistId} gap={gap} />)}
          </div>
        </div>
      )}

      <div style={{ height: "32px" }} />
    </div>
  );
}
