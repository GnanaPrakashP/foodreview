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
      <div style={{ background: "#1A1410", borderRadius: "24px 24px 0 0", width: "100%", maxHeight: "70vh", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "#2E2720" }} />
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
        <div style={{ overflowY: "auto", flex: 1, padding: "0 20px" }}>
          {members.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px" }}>No one in your circle yet</p>
              <Link href="/people" onClick={onClose}>
                <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "12px", padding: "10px 20px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  Invite friends →
                </button>
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {members.map(({ name, places }) => (
                <Link key={name} href={`/people/${encodeURIComponent(name)}`} onClick={onClose} style={{ textDecoration: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                      {avatarInitials(name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)" }}>{name}</p>
                      <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "1px", fontFamily: "'DM Sans', sans-serif" }}>
                        @{name.toLowerCase().replace(/\s+/g, "_")}
                      </p>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>{places} places</span>
                    <span style={{ fontSize: "16px", color: "var(--border)" }}>›</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <Link href="/people" onClick={onClose} style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 0 20px", color: "var(--orange)", fontSize: "14px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
              + Invite more friends →
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── main component ──────────────────────────────── */

export default function MeClient({ allReviews }: { allReviews: Review[] }) {
  const [mounted, setMounted] = useState(false);
  const [myName, setMyName] = useState("");
  const [circle, setCircle] = useState<string[]>([]);
  const [showCircleSheet, setShowCircleSheet] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

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
    const names = new Set<string>();
    for (const r of myReviews)
      for (const it of r.items)
        if (it.name.trim()) names.add(it.name.trim().toLowerCase());
    return names.size;
  }, [myReviews]);

  const totalVisits = useMemo(() => myReviews.length, [myReviews]);

  const rankedPlaces = useMemo(() => buildRankedPlaces(myReviews), [myReviews]);

  useEffect(() => {
    setMyName(localStorage.getItem("fc_my_name") ?? "");
    setCircle(JSON.parse(localStorage.getItem("fc_circle") ?? "[]"));
    setMounted(true);
  }, []);

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

      {/* Circle sheet */}
      {showCircleSheet && (
        <CircleSheet circle={circle} allReviews={allReviews} onClose={() => setShowCircleSheet(false)} />
      )}

      {/* Edit sheet */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 50, display: "flex", alignItems: "flex-end" }}>
          <div style={{ background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: "24px 20px", width: "100%", borderTop: "1px solid var(--border)" }}>
            <h3 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: "var(--cream)", fontSize: "17px", marginBottom: "20px" }}>Edit Profile</h3>
            <label style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: "8px", fontFamily: "'DM Sans', sans-serif" }}>
              Username
            </label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Your name"
              style={{ width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", color: "var(--cream)", fontSize: "14px", outline: "none", marginBottom: "16px", boxSizing: "border-box" }}
            />
            <button
              onClick={() => {
                const n = editName.trim();
                if (n) { localStorage.setItem("fc_my_name", n); setMyName(n); }
                setEditing(false);
              }}
              style={{ width: "100%", background: "var(--orange)", border: "none", borderRadius: "14px", padding: "14px", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── Section 1: Header ── */}
      <div style={{ padding: "20px", position: "relative" }}>
        <button
          onClick={() => { setEditName(myName); setEditing(true); }}
          style={{ position: "absolute", top: "20px", right: "20px", background: "#211C17", border: "1px solid #2E2720", borderRadius: "10px", padding: "6px 12px", fontSize: "12px", color: "var(--muted)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
        >
          Edit
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: myName ? avatarGradient(myName) : "#211C17", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
            {myName ? avatarInitials(myName) : "?"}
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)" }}>
              {myName || "Set your name"}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              @{(myName || "you").toLowerCase().replace(/\s+/g, "_")}
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
          <div style={{ background: "#211C17", border: "1px solid #2E2720", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniquePlaces}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Places
            </div>
          </div>
          {/* Dishes */}
          <div style={{ background: "#211C17", border: "1px solid #2E2720", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniqueDishes}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Dishes
            </div>
          </div>
          {/* Circle — tappable */}
          <button
            onClick={() => setShowCircleSheet(true)}
            style={{ background: "#211C17", border: "1px solid #2E2720", borderRadius: "14px", padding: "14px 10px", textAlign: "center", cursor: "pointer" }}
          >
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {circle.length}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif", textDecoration: "underline", textDecorationColor: "#2E2720", textUnderlineOffset: "3px" }}>
              Circle
            </div>
          </button>
        </div>
      </div>

      {/* ── Section 3: Ranked List ── */}
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>
          Your List
        </p>

        {rankedPlaces.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginBottom: "16px" }}>
              You haven&apos;t logged any places yet
            </p>
            <Link href="/reviews/new">
              <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "12px 24px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                Share your first meal →
              </button>
            </Link>
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
                    {place.dishCount > 0 && ` · ${place.dishCount} dish${place.dishCount !== 1 ? "es" : ""}`}
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
