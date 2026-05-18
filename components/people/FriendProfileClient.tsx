"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType, Review } from "@/lib/types";
import { avatarGradient, avatarInitials, restaurantGradient } from "@/lib/profile";
import { normalizeVisibility } from "@/lib/visibility";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { ArrowLeft, ChefHat, Lock } from "lucide-react";
import { freshCircleStatus, invalidateCircleStatusCache, type CircleStatusPayload } from "@/lib/browser-circle-status";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { resolveActorName } from "@/lib/browser-actor";

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

type CircleStatus = "one_way" | "sent" | "none";

async function fetchCircleStatusPayload(personName: string): Promise<CircleStatusPayload> {
  try {
    return await freshCircleStatus(personName);
  } catch {
    return {};
  }
}

/* ─── main component ──────────────────────────────── */

export default function FriendProfileClient({
  name,
  displayName,
  accountType,
  reviews,
  hasHiddenCirclePosts = false,
  initialMyName = "",
  initialCircleStatus = "none",
  initialTheirCircleCount = 0,
  initialCommonRestaurantCount = null,
  initialHasIncomingRequest = false,
}: {
  name: string;
  displayName?: string;
  accountType: AccountType;
  reviews: Review[];
  hasHiddenCirclePosts?: boolean;
  initialMyName?: string;
  initialCircleStatus?: "one_way" | "sent" | "none";
  initialTheirCircleCount?: number;
  initialCommonRestaurantCount?: number | null;
  initialHasIncomingRequest?: boolean;
}) {
  const router = useRouter();
  const hasVisibleCirclePosts = useMemo(
    () => reviews.some((review) => normalizeVisibility(review.visibility) === "circle"),
    [reviews]
  );
  const [myName, setMyName] = useState(initialMyName);
  const [circleStatus, setCircleStatus] = useState<CircleStatus>(() =>
    initialCircleStatus !== "none" ? initialCircleStatus : hasVisibleCirclePosts ? "one_way" : "none"
  );
  const [theirCircleCount, setTheirCircleCount] = useState(initialTheirCircleCount);
  const [hasIncomingRequest, setHasIncomingRequest] = useState(initialHasIncomingRequest);
  const [commonRestaurantCount, setCommonRestaurantCount] = useState<number | null>(initialCommonRestaurantCount);
  const [confirmAction, setConfirmAction] = useState<"cancel_request" | "leave_circle" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [respondBusy, setRespondBusy] = useState(false);
  // If the server already supplied relationship data we can show the button immediately.
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const loadSeqRef = useRef(0);
  const relationshipReady = mounted;

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
    const seq = ++loadSeqRef.current;
    const myStatusPromise = fetchCircleStatusPayload(me).then((myStatus) => {
      if (seq !== loadSeqRef.current) return;
      const members: string[] = myStatus.members ?? [];
      const pendingSent: string[] = myStatus.pendingSent ?? [];
      const pendingIncoming: string[] = myStatus.pendingIncoming ?? [];

      if (members.includes(name)) setCircleStatus("one_way");
      else if (pendingSent.includes(name)) setCircleStatus("sent");
      else setCircleStatus("none");
      setHasIncomingRequest(pendingIncoming.includes(name));
    });

    fetchCircleStatusPayload(name).then((theirStatus) => {
      if (seq !== loadSeqRef.current) return;
      setTheirCircleCount(theirStatus.circleCount ?? (theirStatus.displayMembers ?? theirStatus.members ?? []).length);
    });

    return myStatusPromise;
  }, [name]);

  useEffect(() => {
    const me = resolveActorName(initialMyName);
    setMyName(me);
    setCommonRestaurantCount(initialCommonRestaurantCount);

    // When the server did NOT supply relationship data (unauthenticated / first load
    // without SSR auth), reset to safe defaults and show the skeleton until the
    // client fetch resolves. When initial data is present, skip the reset so the
    // button and circle count are visible immediately.
    if (!initialMyName) {
      setCircleStatus(hasVisibleCirclePosts ? "one_way" : "none");
      setTheirCircleCount(0);
      setHasIncomingRequest(false);
      setMounted(false);
    }

    if (!me) { setMounted(true); return; }

    let active = true;

    if (me !== name) {
      fetch(`/api/users/${encodeURIComponent(name)}/common-restaurants`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!active) return;
          if (typeof data?.commonRestaurantCount === "number") {
            setCommonRestaurantCount(data.commonRestaurantCount);
          }
        })
        .catch(() => {});
    }

    // Background refresh keeps the displayed state fresh. When initial server data
    // is already shown this is a silent update with no visible flash.
    loadCircleStatus(me).finally(() => {
      if (active) setMounted(true);
    });

    return () => {
      active = false;
      loadSeqRef.current += 1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, initialCommonRestaurantCount]);

  async function refreshAfterCircleChange() {
    await loadCircleStatus(myName);
    router.refresh();
  }

  async function sendRequest() {
    if (!myName || myName === name) return;
    const previousStatus = circleStatus;
    // Optimistic: public accounts auto-accept so show "In Circle" immediately;
    // private accounts require approval so show "Requested" immediately.
    const optimisticStatus = accountType === "public" ? "one_way" : "sent";
    setCircleStatus(optimisticStatus);
    if (accountType === "public") setTheirCircleCount((c) => c + 1);
    const res = await fetch("/api/circle/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: myName, receiverName: name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCircleStatus(previousStatus);
      if (accountType === "public") setTheirCircleCount((c) => Math.max(0, c - 1));
      return;
    }
    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(name);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");
    // Correct if API response disagrees with our optimistic guess
    if (data.state === "CIRCLE_ONE_WAY" || data.status === "one_way" || data.status === "accepted") {
      setCircleStatus("one_way");
    } else {
      setCircleStatus("sent");
      if (accountType === "public") setTheirCircleCount((c) => Math.max(0, c - 1));
    }
    await refreshAfterCircleChange();
  }

  async function cancelRequest() {
    if (!myName || actionBusy) return;
    setActionBusy(true);
    const previousStatus = circleStatus;
    setCircleStatus("none");
    try {
      const res = await fetch("/api/circle/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: myName, receiverName: name }),
      });
      if (!res.ok) {
        setCircleStatus(previousStatus);
        return;
      }
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(name);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
      await refreshAfterCircleChange();
    } finally {
      setActionBusy(false);
    }
  }

  async function removeFromCircle() {
    if (!myName || actionBusy) return;
    setActionBusy(true);
    const previousStatus = circleStatus;
    const previousCount = theirCircleCount;
    setCircleStatus("none");
    setTheirCircleCount((c) => Math.max(0, c - 1));
    try {
      const res = await fetch("/api/circle/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myName, otherName: name }),
      });
      if (!res.ok) {
        setCircleStatus(previousStatus);
        setTheirCircleCount(previousCount);
        return;
      }
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(name);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
      await refreshAfterCircleChange();
    } finally {
      setActionBusy(false);
    }
  }

  async function respondToIncoming(action: "accept" | "reject") {
    if (!myName || respondBusy) return;
    setRespondBusy(true);
    const prevHasIncoming = hasIncomingRequest;
    const prevStatus = circleStatus;
    setHasIncomingRequest(false);
    if (action === "accept") setCircleStatus("one_way");

    try {
      const res = await fetch("/api/circle/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: name, action }),
      });
      if (!res.ok) {
        setHasIncomingRequest(prevHasIncoming);
        setCircleStatus(prevStatus);
        return;
      }
      await refreshAfterCircleChange();
    } finally {
      setRespondBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* ── Header ── */}
      <div style={{ padding: "20px", position: "relative" }}>
        <div style={{ position: "absolute", top: "20px", right: "20px" }}>
          <Link href="/explore" style={{ textDecoration: "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
            </div>
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
            {avatarInitials(displayName || name)}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>{displayName || name}</p>
              {!relationshipReady && !isOwnProfile && (
                <span
                  aria-hidden
                  style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "999px", width: "48px", height: "22px", opacity: 0.55 }}
                />
              )}
              {relationshipReady && !isOwnProfile && commonRestaurantCount !== null && circleStatus === "one_way" && (
                <span
                  aria-label={`${commonRestaurantCount} common restaurant${commonRestaurantCount !== 1 ? "s" : ""}`}
                  title={`${commonRestaurantCount} common restaurant${commonRestaurantCount !== 1 ? "s" : ""}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: "3px", border: "1px solid rgba(240,96,48,0.28)", background: "rgba(240,96,48,0.12)", borderRadius: "999px", padding: "2px 7px", fontSize: "12px", lineHeight: 1.35, color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}
                >
                  {commonRestaurantCount} <ChefHat size={12} strokeWidth={2.2} />
                </span>
              )}
            </div>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              @{name}
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
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "24px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
                  {relationshipReady ? theirCircleCount : "—"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>Circle</div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* ── Circle action button ── */}
      {!isOwnProfile && (
        <div style={{ padding: "0 20px 20px" }}>
          {!relationshipReady && (
            <div style={{ width: "100%", height: "48px", background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: "14px", opacity: 0.55 }} />
          )}
          {circleStatus === "one_way" && (
            <button onClick={() => setConfirmAction("leave_circle")} style={{ width: "100%", background: "rgba(61,214,140,0.12)", border: "1.5px solid rgba(61,214,140,0.35)", borderRadius: "14px", padding: "13px", color: "var(--green)", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              In Circle
            </button>
          )}
          {relationshipReady && circleStatus === "sent" && (
            <button onClick={() => setConfirmAction("cancel_request")} style={{ width: "100%", background: "rgba(240,96,48,0.12)", border: "1.5px solid rgba(240,96,48,0.35)", borderRadius: "14px", padding: "13px", color: "var(--orange)", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              Requested
            </button>
          )}
          {relationshipReady && circleStatus === "none" && (
            <button onClick={sendRequest} style={{ width: "100%", background: "rgba(240,96,48,0.12)", border: "1.5px solid rgba(240,96,48,0.35)", borderRadius: "14px", padding: "13px", color: "var(--orange)", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              Request
            </button>
          )}
          {relationshipReady && hasIncomingRequest && circleStatus !== "one_way" && (
            <div style={{ marginTop: "10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px" }}>
              <p style={{ margin: 0, color: "var(--cream)", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                {displayName || name} requested to join your circle.
              </p>
              <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <button
                  onClick={() => respondToIncoming("reject")}
                  disabled={respondBusy}
                  style={{ width: "100%", background: "transparent", border: "1.5px solid var(--border)", borderRadius: "11px", padding: "10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700, cursor: respondBusy ? "default" : "pointer", opacity: respondBusy ? 0.65 : 1 }}
                >
                  Reject
                </button>
                <button
                  onClick={() => respondToIncoming("accept")}
                  disabled={respondBusy}
                  style={{ width: "100%", background: "var(--orange)", border: "1.5px solid var(--orange)", borderRadius: "11px", padding: "10px", color: "white", fontFamily: "'Syne', sans-serif", fontSize: "12px", fontWeight: 700, cursor: respondBusy ? "default" : "pointer", opacity: respondBusy ? 0.75 : 1 }}
                >
                  Accept
                </button>
              </div>
            </div>
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
                Circle-only posts
              </p>
              <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: "12px", lineHeight: 1.45, fontFamily: "'DM Sans', sans-serif" }}>
                This account has circle-only posts. Only circle members can view them.
              </p>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmAction !== null}
        title={confirmAction === "leave_circle" ? "Leave circle?" : "Cancel request?"}
        message={
          confirmAction === "leave_circle"
            ? `Do you no longer want to be in ${displayName || name}'s circle?`
            : `Cancel request to join ${displayName || name}'s circle?`
        }
        confirmText={confirmAction === "leave_circle" ? "Leave" : "Cancel request"}
        confirmVariant={confirmAction === "leave_circle" ? "danger" : "primary"}
        disabled={actionBusy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action === "leave_circle") {
            await removeFromCircle();
            return;
          }
          await cancelRequest();
        }}
      />

      {/* ── Ranked List ── */}
      <div style={{ padding: "0 20px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>
          {(displayName || name).split(" ")[0]}&apos;s List
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
