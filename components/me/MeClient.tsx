"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Review } from "@/lib/types";
import { avatarGradient, avatarInitials, restaurantGradient } from "@/lib/profile";
import { Settings, ChevronRight } from "lucide-react";
import { cachedCircleStatus } from "@/lib/browser-circle-status";
import { resolveActorName, resolveDisplayName } from "@/lib/browser-actor";

/* ─── helpers ────────────────────────────────────── */

const RANK_COLORS: Record<number, string> = {
  1: "#E8A830",
  2: "#9CA3AF",
  3: "#CD7C2F",
};

interface RankedPlace {
  name: string;
  score10: number;
  visitCount: number;
  dishCount: number;
  isRegular: boolean;
}

function buildRankedPlaces(reviews: Review[]): RankedPlace[] {
  const map = new Map<string, { totalRating: number; ratingCount: number; visitCount: number; dishes: Set<string> }>();
  for (const r of reviews) {
    const existing = map.get(r.restaurant_name);
    const rated = r.items.filter(it => it.rating > 0);
    const sum = rated.reduce((s, it) => s + it.rating, 0);
    if (existing) {
      existing.visitCount++;
      existing.totalRating += sum;
      existing.ratingCount += rated.length;
      for (const it of r.items) if (it.name.trim()) existing.dishes.add(it.name.trim().toLowerCase());
    } else {
      const dishes = new Set<string>();
      for (const it of r.items) if (it.name.trim()) dishes.add(it.name.trim().toLowerCase());
      map.set(r.restaurant_name, { totalRating: sum, ratingCount: rated.length, visitCount: 1, dishes });
    }
  }
  return [...map.entries()]
    .map(([name, d]) => ({
      name,
      score10: d.ratingCount > 0 ? Math.round((d.totalRating / d.ratingCount) * 2 * 10) / 10 : 0,
      visitCount: d.visitCount,
      dishCount: d.dishes.size,
      isRegular: d.visitCount >= 5,
    }))
    .sort((a, b) => b.score10 - a.score10);
}

/* ─── skeleton ────────────────────────────────────── */

function StatSkeleton() {
  return (
    <div className="animate-pulse" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
      <div style={{ height: "28px", background: "var(--surface)", borderRadius: "6px", width: "36px", margin: "0 auto 8px" }} />
      <div style={{ height: "11px", background: "var(--surface)", borderRadius: "4px", width: "48px", margin: "0 auto" }} />
    </div>
  );
}

/* ─── circle bottom sheet ─────────────────────────── */

function CircleSheet({ circle, allReviews, onClose }: {
  circle: string[];
  allReviews: Review[];
  onClose: () => void;
}) {
  const members = useMemo(
    () => circle.map(name => ({
      name,
      places: new Set(allReviews.filter(r => r.reviewer_name === name).map(r => r.restaurant_name)).size,
    })),
    [circle, allReviews]
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "512px", margin: "0 auto" }}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", width: "100%", maxHeight: "70vh", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--border)" }} />
        </div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 14px" }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "16px", color: "var(--cream)" }}>
            Your Circle · <span style={{ color: "var(--muted)" }}>{circle.length} people</span>
          </p>
          <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 14px", fontSize: "13px", color: "var(--muted)", cursor: "pointer" }}>
            Done
          </button>
        </div>
        {/* List */}
        <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 32px" }}>
          {members.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "32px 0", gap: "14px" }}>
              <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>No one in your circle yet</p>
              <Link href="/people" onClick={onClose} style={{ textDecoration: "none" }}>
                <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "12px", padding: "12px 24px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  Find friends
                </button>
              </Link>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {members.map(({ name, places }) => (
                  <Link key={name} href={`/people/${encodeURIComponent(name)}`} onClick={onClose} style={{ textDecoration: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
                        {avatarInitials(name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>{name}</p>
                        <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
                          {places} place{places !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
                    </div>
                  </Link>
                ))}
              </div>
              <Link href="/people" onClick={onClose} style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "18px 0 4px", gap: "6px", color: "var(--orange)", fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                  + Add more friends
                </div>
              </Link>
            </>
          )}
        </div>
      </div>
      </div>{/* end max-width wrapper */}
    </div>
  );
}

/* ─── main component ──────────────────────────────── */

export default function MeClient({
  allReviews,
  initialMyName = "",
  initialDisplayName = "",
  initialCircle = [],
}: {
  allReviews: Review[];
  initialMyName?: string;
  initialDisplayName?: string;
  initialCircle?: string[];
}) {
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const [myName, setMyName] = useState(initialMyName);
  const [displayName, setDisplayName] = useState(initialDisplayName || initialMyName);
  const [circle, setCircle] = useState<string[]>(initialCircle);

  // All derived — unconditional
  const myReviews = useMemo(
    () => allReviews.filter(r => r.reviewer_name === myName),
    [allReviews, myName]
  );

  const uniquePlaces = useMemo(
    () => new Set(myReviews.map(r => r.restaurant_name)).size,
    [myReviews]
  );

  const uniqueDishes = useMemo(() => {
    const pairs = new Set<string>();
    for (const r of myReviews)
      for (const it of r.items)
        if (it.name.trim())
          pairs.add(`${it.name.trim().toLowerCase()}\x00${r.restaurant_name.toLowerCase()}`);
    return pairs.size;
  }, [myReviews]);

  const totalVisits = useMemo(() => myReviews.length, [myReviews]);

  const rankedPlaces = useMemo(() => buildRankedPlaces(myReviews), [myReviews]);

  useEffect(() => {
    const name = resolveActorName(initialMyName);
    const dName = resolveDisplayName(initialDisplayName, name);
    setMyName(name);
    setDisplayName(dName || name);
    setMounted(true);
    if (name) {
      cachedCircleStatus(name)
        .then((data) => {
          setCircle(data.displayMembers ?? data.members ?? []);
        })
        .catch(() => {});
    }
  }, [initialMyName, initialDisplayName]);

  /* ── skeleton ── */
  if (!mounted) {
    return (
      <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
        <div className="px-5 pt-6 pb-5" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="animate-pulse" style={{ width: "72px", height: "72px", borderRadius: "22px", background: "var(--card)", flexShrink: 0 }} />
          <div>
            <div className="animate-pulse" style={{ height: "20px", width: "120px", background: "var(--card)", borderRadius: "6px", marginBottom: "8px" }} />
            <div className="animate-pulse" style={{ height: "13px", width: "80px", background: "var(--card)", borderRadius: "4px" }} />
          </div>
        </div>
        <div className="px-5 pb-5">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            <StatSkeleton /><StatSkeleton /><StatSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* ── Section 1: Header ── */}
      <div style={{ padding: "20px", position: "relative" }}>
        <div style={{ position: "absolute", top: "20px", right: "20px", display: "flex", gap: "8px" }}>
          <Link href="/me/settings" style={{ textDecoration: "none" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Settings size={15} strokeWidth={2} color="var(--muted)" />
            </div>
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: myName ? avatarGradient(myName) : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
            {myName ? avatarInitials(displayName || myName) : "?"}
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)" }}>
              {displayName || myName || "Set your name"}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              @{myName || "you"}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              {totalVisits} visit{totalVisits !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ── Section 2: Stats Row ── */}
      <div style={{ padding: "0 20px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {/* Places */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniquePlaces}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Places
            </div>
          </div>
          {/* Dishes */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniqueDishes}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Dishes
            </div>
          </div>
          {/* Circle — links to /me/circle */}
          <Link href="/me/circle" style={{ textDecoration: "none" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center", cursor: "pointer" }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
                {circle.length}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
                Circle
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Your List ── */}
      <div style={{ padding: "0 20px 8px" }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "12px" }}>Your List</p>
        {rankedPlaces.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "48px 0", gap: "16px" }}>
              <p style={{ fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
                You haven&apos;t logged any places yet
              </p>
              <Link href="/reviews/new" style={{ textDecoration: "none" }}>
                <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "13px 28px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  Share your first meal
                </button>
              </Link>
            </div>
          ) : (
            <div>
              {rankedPlaces.map((place, i) => (
                <Link
                  key={place.name}
                  href={`/people/${encodeURIComponent(myName)}/${encodeURIComponent(place.name)}`}
                  style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "12px", padding: "13px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                >
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 700, color: RANK_COLORS[i + 1] ?? "var(--border)", width: "24px", textAlign: "center", flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ width: "44px", height: "44px", background: restaurantGradient(place.name), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                    {place.name[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{place.name}</p>
                    <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
                      {place.visitCount} visit{place.visitCount !== 1 ? "s" : ""}
                      {place.dishCount > 0 && ` · ${place.dishCount} dish${place.dishCount !== 1 ? "es" : ""}`}
                      {place.isRegular && (
                        <span style={{ marginLeft: "8px", background: "var(--orange-dim)", border: "1px solid rgba(240,96,48,0.25)", borderRadius: "20px", padding: "1px 7px", fontSize: "9px", fontWeight: 700, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Regular
                        </span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, marginLeft: "4px" }}>
                    {place.score10 > 0 && (
                      <div style={{ minWidth: "46px", height: "38px", borderRadius: "13px", background: "linear-gradient(180deg, rgba(232,168,48,0.18), rgba(232,168,48,0.07))", border: "1px solid rgba(232,168,48,0.28)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--gold)" }}>{place.score10}</span>
                        <span style={{ marginTop: "2px", fontSize: "8px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontWeight: 800 }}>/10</span>
                      </div>
                    )}
                    <ChevronRight size={15} strokeWidth={2} color="var(--muted)" />
                  </div>
                </Link>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
