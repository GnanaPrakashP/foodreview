"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Review } from "@/lib/types";
import { avatarGradient, avatarInitials } from "@/lib/profile";

/* ─── helpers ────────────────────────────────────── */

function restaurantEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("idli") || n.includes("dosa") || n.includes("tiffin") || n.includes("murugan")) return "🥘";
  if (n.includes("biryani") || n.includes("mughal") || n.includes("dum")) return "🍛";
  if (n.includes("ramen") || n.includes("nagi") || n.includes("japanese") || n.includes("sushi")) return "🍜";
  if (n.includes("pizza") || n.includes("italiano") || n.includes("pasta")) return "🍕";
  if (n.includes("burger") || n.includes("grill")) return "🍔";
  if (n.includes("mess") || n.includes("madurai") || n.includes("mutton") || n.includes("chicken")) return "🍖";
  if (n.includes("cafe") || n.includes("coffee") || n.includes("brew")) return "☕";
  return "🍽️";
}

const RANK_COLORS: Record<number, string> = {
  1: "#E8A830",
  2: "#9CA3AF",
  3: "#CD7C2F",
};

interface RankedPlace {
  name: string;
  score10: number;
  visitCount: number;
  isRegular: boolean;
}

function buildRankedPlaces(reviews: Review[]): RankedPlace[] {
  const map = new Map<string, { totalRating: number; ratingCount: number; visitCount: number }>();
  for (const r of reviews) {
    const existing = map.get(r.restaurant_name);
    const rated = r.items.filter(it => it.rating > 0);
    const sum = rated.reduce((s, it) => s + it.rating, 0);
    if (existing) {
      existing.visitCount++;
      existing.totalRating += sum;
      existing.ratingCount += rated.length;
    } else {
      map.set(r.restaurant_name, { totalRating: sum, ratingCount: rated.length, visitCount: 1 });
    }
  }
  return [...map.entries()]
    .map(([name, d]) => ({
      name,
      score10: d.ratingCount > 0 ? Math.round((d.totalRating / d.ratingCount) * 2 * 10) / 10 : 0,
      visitCount: d.visitCount,
      isRegular: d.visitCount >= 5,
    }))
    .sort((a, b) => b.score10 - a.score10);
}

/* ─── main component ──────────────────────────────── */

export default function FriendProfileClient({ name, reviews }: { name: string; reviews: Review[] }) {
  const [inCircle, setInCircle] = useState(false);
  const [mounted, setMounted] = useState(false);

  const uniquePlaces = useMemo(
    () => new Set(reviews.map(r => r.restaurant_name)).size,
    [reviews]
  );

  const uniqueDishes = useMemo(() => {
    const names = new Set<string>();
    for (const r of reviews)
      for (const it of r.items)
        if (it.name.trim()) names.add(it.name.trim().toLowerCase());
    return names.size;
  }, [reviews]);

  const totalVisits = useMemo(() => reviews.length, [reviews]);

  const rankedPlaces = useMemo(() => buildRankedPlaces(reviews), [reviews]);

  useEffect(() => {
    const circle: string[] = JSON.parse(localStorage.getItem("fc_circle") ?? "[]");
    setInCircle(circle.includes(name));
    setMounted(true);
  }, [name]);

  function toggleCircle() {
    const circle: string[] = JSON.parse(localStorage.getItem("fc_circle") ?? "[]");
    const next = inCircle
      ? circle.filter(n => n !== name)
      : [...circle, name];
    localStorage.setItem("fc_circle", JSON.stringify(next));
    setInCircle(!inCircle);
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* Back */}
      <div style={{ padding: "20px 20px 0" }}>
        <Link
          href="/people"
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted)", textDecoration: "none" }}
        >
          ← People
        </Link>
      </div>

      {/* ── Section 1: Header ── */}
      <div style={{ padding: "16px 20px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "12px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
            {avatarInitials(name)}
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)" }}>
              {name}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              @{name.toLowerCase().replace(/\s+/g, "_")}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              {totalVisits} visit{totalVisits !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Circle relationship button */}
        {mounted && (
          <button
            onClick={toggleCircle}
            style={{
              width: "100%",
              background: inCircle ? "transparent" : "var(--orange)",
              border: `1px solid ${inCircle ? "var(--orange)" : "transparent"}`,
              borderRadius: "14px",
              padding: "13px",
              color: inCircle ? "var(--orange)" : "white",
              fontFamily: "'Syne', sans-serif",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.2px",
            }}
          >
            {inCircle ? "✓ In your circle" : "Add to Circle +"}
          </button>
        )}
      </div>

      {/* ── Section 2: Stats Row ── */}
      <div style={{ padding: "0 20px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
          <div style={{ background: "#211C17", border: "1px solid #2E2720", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniquePlaces}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Places
            </div>
          </div>
          <div style={{ background: "#211C17", border: "1px solid #2E2720", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniqueDishes}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Dishes
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Ranked List ── */}
      <div style={{ padding: "0 20px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>
          {name.split(" ")[0]}&apos;s List
        </p>

        {rankedPlaces.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
              No places logged yet
            </p>
          </div>
        ) : (
          <div>
            {rankedPlaces.map((place, i) => (
              <div
                key={place.name}
                style={{ display: "flex", alignItems: "center", gap: "12px", padding: "13px 0", borderBottom: "1px solid #2E2720" }}
              >
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 700, color: RANK_COLORS[i + 1] ?? "#2E2720", width: "24px", textAlign: "center", flexShrink: 0 }}>
                  {i + 1}
                </div>
                <div style={{ width: "44px", height: "44px", background: "#211C17", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>
                  {restaurantEmoji(place.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {place.name}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
                    {place.visitCount} visit{place.visitCount !== 1 ? "s" : ""}
                    {place.isRegular && (
                      <span style={{ marginLeft: "8px", background: "rgba(240,96,48,0.12)", border: "1px solid rgba(240,96,48,0.25)", borderRadius: "20px", padding: "1px 7px", fontSize: "9px", fontWeight: 700, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Regular
                      </span>
                    )}
                  </p>
                </div>
                {place.score10 > 0 && (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)" }}>
                      {place.score10}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>/10</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
