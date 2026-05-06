"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType, Review } from "@/lib/types";
import { avatarGradient, avatarInitials, restaurantGradient } from "@/lib/profile";
import { ArrowLeft, Lock } from "lucide-react";

/* ─── helpers ─────────────────────────────────────── */

const RANK_COLORS: Record<number, string> = { 1: "#E8A830", 2: "#9CA3AF", 3: "#CD7C2F" };

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
    const rated = r.items.filter((it) => it.rating > 0);
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

type CircleStatus = "mutual" | "one_way" | "sent" | "incoming" | "none";

/* ─── main component ──────────────────────────────── */

export default function FriendProfileClient({
  name,
  accountType,
  reviews,
  hasHiddenCirclePosts = false,
}: {
  name: string;
  accountType: AccountType;
  reviews: Review[];
  hasHiddenCirclePosts?: boolean;
}) {
  const router = useRouter();
  const [myName, setMyName] = useState("");
  const [circleStatus, setCircleStatus] = useState<CircleStatus>("none");
  const [theirCircleCount, setTheirCircleCount] = useState(0);
  const [commonRestaurantCount, setCommonRestaurantCount] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  const isOwnProfile = myName === name;
  const isPrivateLocked = false;
  const isCheckingPrivateAccess = false;

  const visibleReviews = useMemo(() => {
    return reviews;
  }, [reviews]);

  const uniquePlaces = useMemo(() => new Set(reviews.map((r) => r.restaurant_name)).size, [reviews]);

  const uniqueDishes = useMemo(() => {
    const pairs = new Set<string>();
    for (const r of reviews)
      for (const it of r.items)
        if (it.name.trim())
          pairs.add(`${it.name.trim().toLowerCase()}\x00${r.restaurant_name.toLowerCase()}`);
    return pairs.size;
  }, [reviews]);

  const totalVisits = useMemo(() => reviews.length, [reviews]);
  const rankedPlaces = useMemo(() => buildRankedPlaces(visibleReviews), [visibleReviews]);

  const loadCircleStatus = useCallback((me: string) => {
    if (!me) return Promise.resolve();
    return Promise.all([
      fetch(`/api/circle/status?name=${encodeURIComponent(me)}`).then((r) => r.json()),
      fetch(`/api/circle/status?name=${encodeURIComponent(name)}`).then((r) => r.json()),
    ]).then(([myStatus, theirStatus]) => {
      const members: string[] = myStatus.members ?? [];
      const mutualMembers: string[] = myStatus.mutualMembers ?? [];
      const pendingSent: string[] = myStatus.pendingSent ?? [];
      const pendingIncoming: string[] = myStatus.pendingIncoming ?? [];

      if (mutualMembers.includes(name)) setCircleStatus("mutual");
      else if (members.includes(name)) setCircleStatus("one_way");
      else if (pendingSent.includes(name)) setCircleStatus("sent");
      else if (pendingIncoming.includes(name)) setCircleStatus("incoming");
      else setCircleStatus("none");

      setTheirCircleCount(theirStatus.circleCount ?? (theirStatus.displayMembers ?? theirStatus.members ?? []).length);
    }).catch(() => {});
  }, [name]);

  useEffect(() => {
    const me = localStorage.getItem("fc_my_name") ?? "";
    setMyName(me);
    if (!me) { setMounted(true); return; }

    if (me !== name) {
      fetch(`/api/users/${encodeURIComponent(name)}/common-restaurants`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (typeof data?.commonRestaurantCount === "number") {
            setCommonRestaurantCount(data.commonRestaurantCount);
          }
        })
        .catch(() => {});
    }

    loadCircleStatus(me).finally(() => setMounted(true));
  }, [loadCircleStatus]);

  async function refreshAfterCircleChange() {
    await loadCircleStatus(myName);
    router.refresh();
  }

  async function sendRequest() {
    if (!myName || myName === name) return;
    const previousStatus = circleStatus;
    setCircleStatus("sent");
    const res = await fetch("/api/circle/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: myName, receiverName: name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCircleStatus(previousStatus);
      return;
    }
    if (data.state === "CIRCLE_MUTUAL" || data.status === "accepted") {
      setCircleStatus("mutual");
      setTheirCircleCount((c) => c + 1);
    } else if (data.state === "CIRCLE_ONE_WAY" || data.status === "one_way") {
      setCircleStatus("one_way");
      if (accountType === "public") setTheirCircleCount((c) => c + 1);
    } else {
      setCircleStatus("sent");
    }
    await refreshAfterCircleChange();
  }

  async function cancelRequest() {
    if (!myName) return;
    const previousStatus = circleStatus;
    setCircleStatus("none");
    const res = await fetch("/api/circle/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: myName, receiverName: name }),
    });
    if (!res.ok) {
      setCircleStatus(previousStatus);
      return;
    }
    await refreshAfterCircleChange();
  }

  async function removeFromCircle() {
    if (!myName) return;
    const previousStatus = circleStatus;
    setCircleStatus("none");
    setTheirCircleCount((c) => Math.max(0, c - 1));
    const res = await fetch("/api/circle/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myName, otherName: name }),
    });
    if (!res.ok) {
      setCircleStatus(previousStatus);
      return;
    }
    await refreshAfterCircleChange();
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* ── Header ── */}
      <div style={{ padding: "20px", position: "relative" }}>
        <div style={{ position: "absolute", top: "20px", right: "20px" }}>
          <Link href="/people" style={{ textDecoration: "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
            </div>
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
            {avatarInitials(name)}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>{name}</p>
              {mounted && !isOwnProfile && commonRestaurantCount !== null && (
                <span
                  aria-label={`${commonRestaurantCount} common restaurant${commonRestaurantCount !== 1 ? "s" : ""}`}
                  title={`${commonRestaurantCount} common restaurant${commonRestaurantCount !== 1 ? "s" : ""}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: "3px", border: "1px solid rgba(240,96,48,0.28)", background: "rgba(240,96,48,0.12)", borderRadius: "999px", padding: "2px 7px", fontSize: "12px", lineHeight: 1.35, color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}
                >
                  {commonRestaurantCount} 🧑‍🍳
                </span>
              )}
            </div>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              @{name.toLowerCase().replace(/\s+/g, "_")}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              {totalVisits} visit{totalVisits !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div style={{ padding: "0 20px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
          {[
            { val: uniquePlaces, label: "Places" },
            { val: uniqueDishes, label: "Dishes" },
          ].map(({ val, label }) => (
            <div key={label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
            </div>
          ))}
          {isPrivateLocked ? (
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>{theirCircleCount}</div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>Circle</div>
            </div>
          ) : (
            <Link href={`/people/${encodeURIComponent(name)}/circle`} style={{ textDecoration: "none" }}>
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center", cursor: "pointer" }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>{theirCircleCount}</div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>Circle</div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* ── Circle action button ── */}
      {mounted && !isOwnProfile && (
        <div style={{ padding: "0 20px 20px" }}>
          {(circleStatus === "mutual" || circleStatus === "one_way") && (
            <button onClick={removeFromCircle} style={{ width: "100%", background: "transparent", border: "1.5px solid var(--border)", borderRadius: "14px", padding: "13px", color: "var(--muted)", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              {circleStatus === "mutual" ? "Mutual Circle" : "In Circle"}
            </button>
          )}
          {circleStatus === "sent" && (
            <button onClick={cancelRequest} style={{ width: "100%", background: "transparent", border: "1.5px solid var(--border)", borderRadius: "14px", padding: "13px", color: "var(--muted)", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              Requested
            </button>
          )}
          {circleStatus === "incoming" && (
            <button onClick={sendRequest} style={{ width: "100%", background: "var(--orange)", border: "none", borderRadius: "14px", padding: "13px", color: "white", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              Add
            </button>
          )}
          {circleStatus === "none" && (
            <button onClick={sendRequest} style={{ width: "100%", background: "var(--orange)", border: "none", borderRadius: "14px", padding: "13px", color: "white", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              Add
            </button>
          )}
        </div>
      )}

      {hasHiddenCirclePosts && (
        <div style={{ padding: "0 20px 18px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "13px 14px" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(240,96,48,0.12)", border: "1px solid rgba(240,96,48,0.22)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Lock size={16} strokeWidth={2} color="var(--orange)" />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, color: "var(--cream)", fontSize: "13px", fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                Private account
              </p>
              <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: "12px", lineHeight: 1.45, fontFamily: "'DM Sans', sans-serif" }}>
                Some posts are visible only to their circle.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Ranked List ── */}
      <div style={{ padding: "0 20px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>
          {name.split(" ")[0]}&apos;s List
        </p>

        {isPrivateLocked ? (
          <div style={{ textAlign: "center", padding: "48px 20px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
              This is a private account
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5, margin: "8px auto 0", maxWidth: "260px" }}>
              Add them to see their meal list and Circle.
            </p>
          </div>
        ) : isCheckingPrivateAccess ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse"
                style={{ height: "70px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", opacity: 0.55 }}
              />
            ))}
          </div>
        ) : rankedPlaces.length === 0 ? (
          <p style={{ textAlign: "center", padding: "48px 0", fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
            No places logged yet
          </p>
        ) : (
          rankedPlaces.map((place, i) => (
            <Link
              key={place.name}
              href={`/people/${encodeURIComponent(name)}/${encodeURIComponent(place.name)}`}
              style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "12px", padding: "13px 0", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 700, color: RANK_COLORS[i + 1] ?? "var(--border)", width: "24px", textAlign: "center", flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ width: "44px", height: "44px", background: restaurantGradient(place.name), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                {place.name[0]?.toUpperCase() ?? "?"}
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
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)" }}>{place.score10}</span>
                  <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>/10</span>
                </div>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
