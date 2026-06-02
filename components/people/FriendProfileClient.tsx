"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType, Comment, Review } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import { avatarGradient, avatarInitials } from "@/lib/profile";
import { restaurantLocationLabel } from "@/lib/location";
import { normalizeVisibility } from "@/lib/visibility";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ProfileDishesList from "@/components/profile/ProfileDishesList";
import ProfileReputationSection from "@/components/reputation/ProfileReputationSection";
import TrustScoreSheet from "@/components/taste-trust/TrustScoreSheet";
import { ArrowLeft, ChefHat, Lock } from "lucide-react";
import { freshCircleStatus, invalidateCircleStatusCache, type CircleStatusPayload } from "@/lib/browser-circle-status";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { resolveActorName } from "@/lib/browser-actor";
import { DEFAULT_TASTE_TRUST_SUMMARY, formatTrustScore, type TasteTrustSummary } from "@/lib/taste-trust";
import { uniqueDishRestaurantPairs } from "@/lib/profile-dishes";
import { EMPTY_REPUTATION, type UserProfileReputation } from "@/lib/reputation";

/* ─── helpers ─────────────────────────────────────── */

type CircleStatus = "one_way" | "sent" | "none";
type ProfileTab = "reviews" | "dishes" | "timeline";
type ProfileCursor = { createdAt: string; id: string };

type EngagementMaps = {
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
};

async function fetchCircleStatusPayload(personName: string): Promise<CircleStatusPayload> {
  try {
    return await freshCircleStatus(personName);
  } catch {
    return {};
  }
}

function ProfileTabs({ activeTab, onChange }: { activeTab: ProfileTab; onChange: (tab: ProfileTab) => void }) {
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "reviews", label: "Posts" },
    { id: "dishes", label: "Dishes" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div style={{ display: "flex", padding: "0 20px 16px" }}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "10px 0 9px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              color: active ? "var(--orange)" : "var(--muted)",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${active ? "var(--orange)" : "var(--border)"}`,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function timelineDateParts(value: string): { day: string; month: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "--", month: "" };
  return {
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
  };
}

function timelineMonthLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function timelineLocationLabel(review: Review): string {
  const label = (restaurantLocationLabel(review) ?? "Location not added").replace(/\s+/g, " ").trim();
  if (label.length <= 30) return label;
  const firstPart = label.split(",")[0]?.trim();
  if (firstPart && firstPart.length <= 30) return firstPart;
  return `${label.slice(0, 28).trimEnd()}...`;
}

function TimelineTab({ reviews }: { reviews: Review[] }) {
  const entries = reviews.length > 0
    ? [...reviews]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 12)
    : [];

  if (entries.length === 0) {
    return (
      <div style={{ padding: "60px 20px 110px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>No timeline yet</p>
      </div>
    );
  }

  const groupedEntries = entries.reduce<Array<{ month: string; entries: Review[] }>>((groups, entry) => {
    const month = timelineMonthLabel(entry.created_at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.month === month) lastGroup.entries.push(entry);
    else groups.push({ month, entries: [entry] });
    return groups;
  }, []);

  return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {groupedEntries.map((group) => (
          <section key={group.month}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: "var(--cream)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.2 }}>
              {group.month}
            </h2>
            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ position: "absolute", left: 6.5, top: 10, bottom: 10, width: 1, background: "linear-gradient(180deg, rgba(240,96,48,0.55), rgba(255,255,255,0.08))" }} />
              {group.entries.map((entry, index) => {
                const date = timelineDateParts(entry.created_at);
                const location = timelineLocationLabel(entry);
                return (
                  <div key={`${entry.restaurant_name}-${entry.created_at}-${index}`} style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr)", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 999, background: "var(--orange)", border: "4px solid var(--bg)", flexShrink: 0, position: "relative", zIndex: 1, boxSizing: "border-box" }} />
                    <div style={{ flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px", display: "grid", gridTemplateColumns: "38px 1px minmax(0, 1fr)", alignItems: "center", gap: 12 }}>
                      <div style={{ color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontWeight: 800, lineHeight: 1, textAlign: "center" }}>
                        <span style={{ display: "block", fontSize: 14 }}>{date.day}</span>
                        <span style={{ display: "block", marginTop: 3, fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>{date.month}</span>
                      </div>
                      <div style={{ alignSelf: "stretch", background: "rgba(255,255,255,0.18)" }} />
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: "var(--cream)", margin: 0, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {entry.restaurant_name}
                        </h3>
                        <p style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {location}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ReviewsTab({
  reviews,
  engagement,
  myName,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: {
  reviews: Review[];
  engagement: EngagementMaps;
  myName: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string;
  onLoadMore: () => void;
}) {
  const sorted = [...reviews].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (sorted.length === 0) {
    return (
      <div style={{ padding: "60px 20px 110px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>No reviews yet</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 0 110px", display: "flex", flexDirection: "column", gap: 0 }}>
      {sorted.map((review) => (
        <CircleFeedCard
          key={review.id}
          review={review}
          initialLikeCount={engagement.likeCountMap[review.id] ?? 0}
          initialCommentCount={engagement.commentMap[review.id]?.count ?? 0}
          initialLiked={engagement.likedByMeMap[review.id] ?? false}
          initialBookmarked={engagement.bookmarkedPostMap[review.id] ?? false}
          initialMyName={myName}
          profileMap={engagement.profileMap}
        />
      ))}
      {loadMoreError && (
        <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", margin: "12px 0 0" }}>
          {loadMoreError}
        </p>
      )}
      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          style={{
            background: loadingMore ? "var(--surface)" : "var(--orange)",
            color: loadingMore ? "var(--muted)" : "white",
            border: "none",
            borderRadius: "14px",
            padding: "13px",
            margin: "16px 20px 0",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13px",
            fontWeight: 700,
            cursor: loadingMore ? "default" : "pointer",
          }}
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}

/* ─── main component ──────────────────────────────── */

export default function FriendProfileClient({
  name,
  displayName,
  bio = "",
  accountType,
  reviews,
  publicBestReviews = [],
  hasHiddenCirclePosts = false,
  initialMyName = "",
  initialCircleStatus = "none",
  initialTheirCircleCount = 0,
  initialCommonRestaurantCount = null,
  initialHasIncomingRequest = false,
  tasteTrust = DEFAULT_TASTE_TRUST_SUMMARY,
  reputation = EMPTY_REPUTATION,
  initialHasMore = false,
  initialNextCursor = null,
  likeCountMap = {},
  commentMap = {},
  likedByMeMap = {},
  bookmarkedPostMap = {},
  profileMap = {},
}: {
  name: string;
  displayName?: string;
  bio?: string;
  accountType: AccountType;
  reviews: Review[];
  publicBestReviews?: Review[];
  hasHiddenCirclePosts?: boolean;
  initialMyName?: string;
  initialCircleStatus?: "one_way" | "sent" | "none";
  initialTheirCircleCount?: number;
  initialCommonRestaurantCount?: number | null;
  initialHasIncomingRequest?: boolean;
  tasteTrust?: TasteTrustSummary;
  reputation?: UserProfileReputation;
  initialHasMore?: boolean;
  initialNextCursor?: ProfileCursor | null;
  likeCountMap?: Record<string, number>;
  commentMap?: Record<string, { count: number; top: Comment }>;
  likedByMeMap?: Record<string, boolean>;
  bookmarkedPostMap?: Record<string, boolean>;
  profileMap?: Record<string, string>;
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
  const [activeTab, setActiveTab] = useState<ProfileTab>("reviews");
  const [profileReviews, setProfileReviews] = useState(reviews);
  const [reviewLikeCountMap, setReviewLikeCountMap] = useState(likeCountMap);
  const [reviewCommentMap, setReviewCommentMap] = useState(commentMap);
  const [reviewLikedByMeMap, setReviewLikedByMeMap] = useState(likedByMeMap);
  const [reviewBookmarkedPostMap, setReviewBookmarkedPostMap] = useState(bookmarkedPostMap);
  const [reviewProfileMap, setReviewProfileMap] = useState(profileMap);
  const [hasMoreReviews, setHasMoreReviews] = useState(initialHasMore);
  const [nextReviewsCursor, setNextReviewsCursor] = useState<ProfileCursor | null>(initialNextCursor);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [loadMoreReviewsError, setLoadMoreReviewsError] = useState("");
  const [showTrustSheet, setShowTrustSheet] = useState(false);
  // If the server already supplied relationship data we can show the button immediately.
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const loadSeqRef = useRef(0);
  const relationshipReady = mounted;

  const isOwnProfile = myName === name;
  const isPrivateLocked = false;
  const isCheckingPrivateAccess = false;

  const visibleReviews = useMemo(() => {
    return profileReviews;
  }, [profileReviews]);

  useEffect(() => {
    setProfileReviews(reviews);
    setReviewLikeCountMap(likeCountMap);
    setReviewCommentMap(commentMap);
    setReviewLikedByMeMap(likedByMeMap);
    setReviewBookmarkedPostMap(bookmarkedPostMap);
    setReviewProfileMap(profileMap);
    setHasMoreReviews(initialHasMore);
    setNextReviewsCursor(initialNextCursor);
  }, [reviews, likeCountMap, commentMap, likedByMeMap, bookmarkedPostMap, profileMap, initialHasMore, initialNextCursor]);

  const uniquePlaces = useMemo(() => new Set(profileReviews.map((r) => r.restaurant_name)).size, [profileReviews]);

  const uniqueDishes = useMemo(() => {
    return uniqueDishRestaurantPairs(profileReviews);
  }, [profileReviews]);

  const totalVisits = useMemo(() => profileReviews.length, [profileReviews]);

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

  async function loadMoreReviews() {
    if (loadingMoreReviews || !hasMoreReviews || !nextReviewsCursor) return;
    setLoadingMoreReviews(true);
    setLoadMoreReviewsError("");
    try {
      const params = new URLSearchParams({
        limit: "24",
        cursor: JSON.stringify(nextReviewsCursor),
      });
      const response = await fetch(`/api/users/${encodeURIComponent(name)}/reviews?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to load more reviews");
      setProfileReviews((current) => {
        const seen = new Set(current.map((review) => review.id));
        const fresh = ((payload.reviews ?? []) as Review[]).filter((review) => !seen.has(review.id));
        return [...current, ...fresh];
      });
      setReviewLikeCountMap((current) => ({ ...current, ...(payload.likeCountMap ?? {}) }));
      setReviewCommentMap((current) => ({ ...current, ...(payload.commentMap ?? {}) }));
      setReviewLikedByMeMap((current) => ({ ...current, ...(payload.likedByMeMap ?? {}) }));
      setReviewBookmarkedPostMap((current) => ({ ...current, ...(payload.bookmarkedPostMap ?? {}) }));
      setReviewProfileMap((current) => ({ ...current, ...(payload.profileMap ?? {}) }));
      setHasMoreReviews(Boolean(payload.hasMore));
      setNextReviewsCursor(payload.nextCursor ?? null);
    } catch {
      setLoadMoreReviewsError("Could not load more posts. Please try again.");
    } finally {
      setLoadingMoreReviews(false);
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
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: avatarGradient(displayName || name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
            {avatarInitials(displayName || name)}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>{displayName || name}</p>
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
        {bio.trim() && (
          <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "12px", lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.85 }}>
            {bio.trim()}
          </p>
        )}
      </div>

      {/* ── Stats Row ── */}
      <div style={{ padding: "0 20px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px", alignItems: "start" }}>
          <button
            type="button"
            onClick={() => setShowTrustSheet(true)}
            aria-label="View trust score details"
            style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center", background: "none", border: "none", cursor: "pointer" }}
          >
            <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{formatTrustScore(tasteTrust.trust_score)}</div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, lineHeight: 1.1 }}>Trust</div>
          </button>
          <Link href={`/people/${encodeURIComponent(name)}/places`} style={{ textDecoration: "none", display: "block" }}>
            <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center", cursor: "pointer" }}>
              <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{uniquePlaces}</div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Places</div>
            </div>
          </Link>
          <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{uniqueDishes}</div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Dishes</div>
          </div>
          {isPrivateLocked ? (
            <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{theirCircleCount}</div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Circle</div>
            </div>
          ) : (
            <Link href={`/people/${encodeURIComponent(name)}/circle`} style={{ textDecoration: "none", display: "block" }}>
              <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {relationshipReady ? theirCircleCount : "—"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Circle</div>
              </div>
            </Link>
          )}
        </div>
      </div>

      <ProfileReputationSection reputation={reputation} />
      {showTrustSheet && (
        <TrustScoreSheet
          summary={tasteTrust}
          reviews={visibleReviews}
          onClose={() => setShowTrustSheet(false)}
        />
      )}

      {/* ── Circle action button ── */}
      {!isOwnProfile && (
        <div style={{ padding: "0 20px 20px" }}>
          {!relationshipReady && (
            <div style={{ width: "100%", height: "48px", background: "var(--card)", border: "1.5px solid var(--border)", borderRadius: "14px", opacity: 0.55 }} />
          )}
          {circleStatus === "one_way" && (
            <button onClick={() => setConfirmAction("leave_circle")} style={{ width: "100%", background: "rgba(61,214,140,0.12)", border: "1.5px solid rgba(61,214,140,0.35)", borderRadius: "14px", padding: "13px", color: "var(--green)", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              In Circle
            </button>
          )}
          {relationshipReady && circleStatus === "sent" && (
            <button onClick={() => setConfirmAction("cancel_request")} style={{ width: "100%", background: "rgba(240,96,48,0.12)", border: "1.5px solid rgba(240,96,48,0.35)", borderRadius: "14px", padding: "13px", color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
              Requested
            </button>
          )}
          {relationshipReady && circleStatus === "none" && (
            <button onClick={sendRequest} style={{ width: "100%", background: "rgba(240,96,48,0.12)", border: "1.5px solid rgba(240,96,48,0.35)", borderRadius: "14px", padding: "13px", color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.2px" }}>
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
                  style={{ width: "100%", background: "var(--orange)", border: "1.5px solid var(--orange)", borderRadius: "11px", padding: "10px", color: "white", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700, cursor: respondBusy ? "default" : "pointer", opacity: respondBusy ? 0.75 : 1 }}
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
              <p style={{ margin: 0, color: "var(--cream)", fontSize: "13px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
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

      {!isPrivateLocked && <ProfileTabs activeTab={activeTab} onChange={setActiveTab} />}

      {/* ── Profile Lists ── */}
      {isPrivateLocked ? (
        <div style={{ padding: "0 20px" }}>
          <div style={{ textAlign: "center", padding: "48px 20px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px" }}>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
              This is a private account
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5, margin: "8px auto 0", maxWidth: "260px" }}>
              Add them to see their meal list and Circle.
            </p>
          </div>
        </div>
      ) : isCheckingPrivateAccess ? (
        <div style={{ padding: "0 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse"
                style={{ height: "70px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", opacity: 0.55 }}
              />
            ))}
          </div>
        </div>
      ) : activeTab === "timeline" ? (
        <TimelineTab reviews={visibleReviews} />
      ) : activeTab === "dishes" ? (
        <ProfileDishesList
          triedReviews={visibleReviews}
          publicReviews={publicBestReviews}
          triedLabel={`${(displayName || name).split(" ")[0]}'s Best`}
          emptyText="No dishes yet"
          bottomPadding={110}
        />
      ) : (
        <ReviewsTab
          reviews={visibleReviews}
          engagement={{
            likeCountMap: reviewLikeCountMap,
            commentMap: reviewCommentMap,
            likedByMeMap: reviewLikedByMeMap,
            bookmarkedPostMap: reviewBookmarkedPostMap,
            profileMap: reviewProfileMap,
          }}
          myName={myName}
          hasMore={hasMoreReviews}
          loadingMore={loadingMoreReviews}
          loadMoreError={loadMoreReviewsError}
          onLoadMore={loadMoreReviews}
        />
      )}
    </div>
  );
}
