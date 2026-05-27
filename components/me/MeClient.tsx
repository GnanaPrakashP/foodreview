"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import ProfileDishesList from "@/components/profile/ProfileDishesList";
import ProfileReputationSection from "@/components/reputation/ProfileReputationSection";
import { DEFAULT_TASTE_TRUST_SUMMARY, type TasteTrustSummary } from "@/lib/taste-trust";
import { EMPTY_REPUTATION, type UserProfileReputation } from "@/lib/reputation";

type EngagementMaps = {
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
};
import { avatarGradient, avatarInitials } from "@/lib/profile";
import { restaurantLocationLabel } from "@/lib/location";
import { CalendarDays, Settings } from "lucide-react";
import { cachedCircleStatus } from "@/lib/browser-circle-status";
import { resolveActorName, resolveDisplayName } from "@/lib/browser-actor";
import { uniqueDishRestaurantPairs } from "@/lib/profile-dishes";
import { readFeedState, writeFeedState } from "@/lib/browser-feed-state";

type MeTab = "reviews" | "dishes" | "timeline";
type MeCursor = { id: string; createdAt: string };

const ME_POST_PAGE_SIZE = 24;
const ME_FEED_STATE_TTL_MS = 30 * 60 * 1000;
const MAX_PERSISTED_REVIEWS = 120;

type MeFeedSnapshot = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  hasMore: boolean;
  nextCursor: MeCursor | null;
  activeTab: MeTab;
};

function meFeedStateKey(viewerName: string) {
  return `/api/me?viewer=${encodeURIComponent(viewerName || "anonymous")}`;
}

function StatSkeleton() {
  return (
    <div className="animate-pulse" style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center" }}>
      <div style={{ height: "28px", background: "var(--surface)", borderRadius: "6px", width: "36px", margin: "0 auto 8px" }} />
      <div style={{ height: "11px", background: "var(--surface)", borderRadius: "4px", width: "48px", margin: "0 auto" }} />
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

function MeTabs({ activeTab, onChange }: { activeTab: MeTab; onChange: (tab: MeTab) => void }) {
  const tabs: Array<{ id: MeTab; label: string }> = [
    { id: "reviews", label: "Posts" },
    { id: "dishes", label: "Dishes" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div style={{ display: "flex", padding: "0 16px 16px" }}>
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
    if (lastGroup?.month === month) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ month, entries: [entry] });
    }
    return groups;
  }, []);

  return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {groupedEntries.map((group) => (
          <section key={group.month}>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, color: "var(--cream)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.2 }}>
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
                        <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, color: "var(--cream)", margin: 0, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
    <div style={{ padding: "0 16px 110px", display: "flex", flexDirection: "column", gap: 0 }}>
      {sorted.map((review) => (
        <CircleFeedCard
          key={review.id}
          review={review}
          initialLikeCount={engagement.likeCountMap[review.id] ?? 0}
          initialCommentCount={engagement.commentMap[review.id]?.count ?? 0}
          initialLiked={engagement.likedByMeMap[review.id] ?? false}
          initialBookmarked={engagement.bookmarkedPostMap[review.id] ?? false}
          initialMyName={myName}
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
            margin: "16px 0 0",
            width: "100%",
            fontFamily: "'Syne', sans-serif",
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

export default function MeClient({
  allReviews,
  publicBestReviews = [],
  initialMyName = "",
  initialDisplayName = "",
  initialBio = "",
  joinedAt = "",
  initialCircle = [],
  likeCountMap = {},
  commentMap = {},
  likedByMeMap = {},
  bookmarkedPostMap = {},
  tasteTrust = DEFAULT_TASTE_TRUST_SUMMARY,
  reputation = EMPTY_REPUTATION,
  initialHasMore = false,
  initialNextCursor = null,
  stats,
}: {
  allReviews: Review[];
  publicBestReviews?: Review[];
  initialMyName?: string;
  initialDisplayName?: string;
  initialBio?: string;
  joinedAt?: string;
  initialCircle?: string[];
  likeCountMap?: Record<string, number>;
  commentMap?: Record<string, { count: number; top: Comment }>;
  likedByMeMap?: Record<string, boolean>;
  bookmarkedPostMap?: Record<string, boolean>;
  tasteTrust?: TasteTrustSummary;
  reputation?: UserProfileReputation;
  initialHasMore?: boolean;
  initialNextCursor?: MeCursor | null;
  stats?: {
    totalVisits: number;
    uniquePlaces: number;
    uniqueDishes: number;
  };
}) {
  const feedStateKey = meFeedStateKey(initialMyName);
  const [persistedSnapshot] = useState(() => readFeedState<MeFeedSnapshot>(feedStateKey));
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const [myName, setMyName] = useState(initialMyName);
  const [displayName, setDisplayName] = useState(initialDisplayName || initialMyName);
  const [bio, setBio] = useState(initialBio);
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [activeTab, setActiveTab] = useState<MeTab>(persistedSnapshot?.activeTab ?? "reviews");
  const [nearbyPublicReviews, setNearbyPublicReviews] = useState<Review[]>([]);
  const [loadingNearbyDishes, setLoadingNearbyDishes] = useState(false);
  const [reviews, setReviews] = useState<Review[]>(persistedSnapshot?.reviews ?? allReviews);
  const [reviewLikeCountMap, setReviewLikeCountMap] = useState(persistedSnapshot?.likeCountMap ?? likeCountMap);
  const [reviewCommentMap, setReviewCommentMap] = useState(persistedSnapshot?.commentMap ?? commentMap);
  const [reviewLikedByMeMap, setReviewLikedByMeMap] = useState(persistedSnapshot?.likedByMeMap ?? likedByMeMap);
  const [reviewBookmarkedPostMap, setReviewBookmarkedPostMap] = useState(persistedSnapshot?.bookmarkedPostMap ?? bookmarkedPostMap);
  const [hasMore, setHasMore] = useState(persistedSnapshot?.hasMore ?? initialHasMore);
  const [nextCursor, setNextCursor] = useState<MeCursor | null>(persistedSnapshot?.nextCursor ?? initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");

  useEffect(() => {
    const snapshot = readFeedState<MeFeedSnapshot>(feedStateKey);
    if (snapshot && snapshot.reviews.length > allReviews.length) {
      setReviews(snapshot.reviews);
      setReviewLikeCountMap(snapshot.likeCountMap);
      setReviewCommentMap(snapshot.commentMap);
      setReviewLikedByMeMap(snapshot.likedByMeMap);
      setReviewBookmarkedPostMap(snapshot.bookmarkedPostMap);
      setHasMore(snapshot.hasMore);
      setNextCursor(snapshot.nextCursor);
      setActiveTab(snapshot.activeTab);
    } else {
      setReviews(allReviews);
      setReviewLikeCountMap(likeCountMap);
      setReviewCommentMap(commentMap);
      setReviewLikedByMeMap(likedByMeMap);
      setReviewBookmarkedPostMap(bookmarkedPostMap);
      setHasMore(initialHasMore);
      setNextCursor(initialNextCursor);
    }
  }, [
    allReviews,
    likeCountMap,
    commentMap,
    likedByMeMap,
    bookmarkedPostMap,
    initialHasMore,
    initialNextCursor,
    feedStateKey,
  ]);

  useEffect(() => {
    writeFeedState<MeFeedSnapshot>(feedStateKey, {
      reviews: reviews.slice(0, MAX_PERSISTED_REVIEWS),
      likeCountMap: reviewLikeCountMap,
      commentMap: reviewCommentMap,
      likedByMeMap: reviewLikedByMeMap,
      bookmarkedPostMap: reviewBookmarkedPostMap,
      hasMore,
      nextCursor,
      activeTab,
    }, ME_FEED_STATE_TTL_MS);
  }, [
    activeTab,
    hasMore,
    nextCursor,
    reviewBookmarkedPostMap,
    reviewCommentMap,
    reviewLikedByMeMap,
    reviewLikeCountMap,
    reviews,
    feedStateKey,
  ]);

  const myReviews = useMemo(() => reviews.filter(r => r.reviewer_name === myName), [reviews, myName]);
  const uniquePlaces = stats?.uniquePlaces ?? new Set(myReviews.map(r => r.restaurant_name)).size;
  const uniqueDishes = stats?.uniqueDishes ?? uniqueDishRestaurantPairs(myReviews);
  const totalVisits = stats?.totalVisits ?? myReviews.length;

  useEffect(() => {
    const name = resolveActorName(initialMyName);
    const dName = resolveDisplayName(initialDisplayName, name);
    setMyName(name);
    setDisplayName(dName || name);
    setBio(initialBio.trim());
    setMounted(true);
    if (name) {
      cachedCircleStatus(name)
        .then((data) => setCircle(data.displayMembers ?? data.members ?? []))
        .catch(() => {});
    }
  }, [initialMyName, initialDisplayName, initialBio]);

  useEffect(() => {
    if (!myName || publicBestReviews.length > 0) return;

    let cancelled = false;
    async function loadNearbyPublicReviews() {
      setLoadingNearbyDishes(true);
      try {
        const params = new URLSearchParams({ limit: "40" });
        const response = await fetch(`/api/feed/public?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as { reviews?: Review[] };
        if (!cancelled) setNearbyPublicReviews(payload.reviews ?? []);
      } catch {
        if (!cancelled) setNearbyPublicReviews([]);
      } finally {
        if (!cancelled) setLoadingNearbyDishes(false);
      }
    }

    loadNearbyPublicReviews();
    return () => {
      cancelled = true;
    };
  }, [myName, publicBestReviews.length]);

  async function loadMoreReviews() {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const params = new URLSearchParams({
        limit: String(ME_POST_PAGE_SIZE),
        cursor: JSON.stringify(nextCursor),
      });
      const response = await fetch(`/api/me?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to load more posts");

      setReviews((current) => {
        const seen = new Set(current.map((review) => review.id));
        const fresh = ((payload.reviews ?? []) as Review[]).filter((review) => !seen.has(review.id));
        return [...current, ...fresh];
      });
      setReviewLikeCountMap((current) => ({ ...current, ...(payload.likeCountMap ?? {}) }));
      setReviewCommentMap((current) => ({ ...current, ...(payload.commentMap ?? {}) }));
      setReviewLikedByMeMap((current) => ({ ...current, ...(payload.likedByMeMap ?? {}) }));
      setReviewBookmarkedPostMap((current) => ({ ...current, ...(payload.bookmarkedPostMap ?? {}) }));
      setHasMore(Boolean(payload.hasMore));
      setNextCursor(payload.nextCursor ?? null);
    } catch {
      setLoadMoreError("Could not load more posts. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const tabContent =
    activeTab === "timeline" ? <TimelineTab reviews={myReviews} /> :
    activeTab === "dishes" ? (
      <ProfileDishesList
        triedReviews={myReviews}
        publicReviews={publicBestReviews.length ? publicBestReviews : nearbyPublicReviews}
        triedLabel="Your best"
        emptyText={loadingNearbyDishes && !publicBestReviews.length ? "Checking public picks..." : "No dishes yet"}
      />
    ) :
    <ReviewsTab
      reviews={myReviews}
      engagement={{
        likeCountMap: reviewLikeCountMap,
        commentMap: reviewCommentMap,
        likedByMeMap: reviewLikedByMeMap,
        bookmarkedPostMap: reviewBookmarkedPostMap,
      }}
      myName={myName}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      onLoadMore={loadMoreReviews}
    />;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
      <div style={{ padding: "20px 20px 16px", position: "relative" }}>
        <div style={{ position: "absolute", top: "20px", right: "20px", display: "flex", gap: "8px" }}>
          <Link href="/me/settings" style={{ textDecoration: "none" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Settings size={15} strokeWidth={2} color="var(--muted)" />
            </div>
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: myName ? avatarGradient(myName) : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
            {myName ? avatarInitials(displayName || myName) : "?"}
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)" }}>
              {displayName || myName || "Set your name"}
            </p>
            <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "3px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.6 }}>@{myName || "you"}</p>
            <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "3px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.6 }}>{totalVisits} visit{totalVisits !== 1 ? "s" : ""}</p>
          </div>
        </div>
        {bio?.trim() && (
          <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "12px", lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.85 }}>
            {bio.trim()}
          </p>
        )}
        {joinedAt && (
          <p style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--muted)", marginTop: "12px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
            <CalendarDays size={13} strokeWidth={2} />
            <span>Joined {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(joinedAt))}</span>
          </p>
        )}
      </div>

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px", alignItems: "start" }}>
          {/* Taste Trust */}
          <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {Math.round(tasteTrust.trust_score)}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, lineHeight: 1.1 }}>
              Trust
            </div>
          </div>
          {/* Places */}
          <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {uniquePlaces}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>
              Places
            </div>
          </div>
          {/* Dishes */}
          <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {uniqueDishes}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>
              Dishes
            </div>
          </div>
          {/* Circle */}
          <Link href="/me/circle" style={{ textDecoration: "none", display: "block" }}>
            <div style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: "23px", fontWeight: 700, color: "var(--cream)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {circle.length}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>
                Circle
              </div>
            </div>
          </Link>
        </div>
      </div>

      <ProfileReputationSection reputation={reputation} />

      <MeTabs activeTab={activeTab} onChange={setActiveTab} />
      {tabContent}
    </div>
  );
}
