"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import { DEFAULT_TASTE_TRUST_SUMMARY, type TasteTrustSummary } from "@/lib/taste-trust";

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
import { normalizeDishDisplayName } from "@/lib/dish-normalizer";
import {
  TRENDING_LOCATION_LAT_STORAGE_KEY,
  TRENDING_LOCATION_LNG_STORAGE_KEY,
} from "@/lib/trending-location";

type MeTab = "reviews" | "dishes" | "timeline";

type DishRestaurantPick = {
  restaurantName: string;
  restaurantId: string | null;
  rating: number;
  mentions: number;
};

type DishComparison = {
  dishName: string;
  yourBest: DishRestaurantPick;
  nearbyBest: DishRestaurantPick | null;
};

function StatSkeleton() {
  return (
    <div className="animate-pulse" style={{ minHeight: "58px", padding: "8px 2px", textAlign: "center" }}>
      <div style={{ height: "28px", background: "var(--surface)", borderRadius: "6px", width: "36px", margin: "0 auto 8px" }} />
      <div style={{ height: "11px", background: "var(--surface)", borderRadius: "4px", width: "48px", margin: "0 auto" }} />
    </div>
  );
}


function uniqueDishesFor(reviews: Review[]): number {
  const pairs = new Set<string>();
  for (const review of reviews) {
    for (const item of review.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (dishName) pairs.add(`${dishName.toLowerCase()}\x00${review.restaurant_name.toLowerCase()}`);
    }
  }
  return pairs.size;
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

function formatScore(value: number): string {
  const score = Math.round(value * 2 * 10) / 10;
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function restaurantHref(name: string, id: string | null): string {
  if (!id) return `/trending/${encodeURIComponent(name)}`;
  const params = new URLSearchParams({ name });
  return `/restaurants/${encodeURIComponent(id)}?${params.toString()}`;
}

function bestDishPicks(reviews: Review[]): Map<string, DishRestaurantPick> {
  const grouped = new Map<string, {
    dishName: string;
    restaurantName: string;
    restaurantId: string | null;
    ratingTotal: number;
    ratingCount: number;
    mentions: number;
    latest: number;
  }>();

  for (const review of reviews) {
    const latest = new Date(review.created_at).getTime();
    for (const item of review.items) {
      if (!item.name.trim() || item.rating <= 0) continue;
      const dishName = normalizeDishDisplayName(item.name);
      const key = `${dishName.toLowerCase()}\x00${(review.restaurant_id || review.restaurant_name).toLowerCase()}`;
      const existing = grouped.get(key) ?? {
        dishName,
        restaurantName: review.restaurant_name,
        restaurantId: review.restaurant_id,
        ratingTotal: 0,
        ratingCount: 0,
        mentions: 0,
        latest: 0,
      };
      existing.ratingTotal += item.rating;
      existing.ratingCount += 1;
      existing.mentions += 1;
      existing.latest = Math.max(existing.latest, latest);
      grouped.set(key, existing);
    }
  }

  const bestByDish = new Map<string, DishRestaurantPick & { latest: number }>();
  for (const item of grouped.values()) {
    const rating = item.ratingCount > 0 ? item.ratingTotal / item.ratingCount : 0;
    const current = bestByDish.get(item.dishName);
    if (
      !current ||
      rating > current.rating ||
      (rating === current.rating && item.mentions > current.mentions) ||
      (rating === current.rating && item.mentions === current.mentions && item.latest > current.latest)
    ) {
      bestByDish.set(item.dishName, {
        restaurantName: item.restaurantName,
        restaurantId: item.restaurantId,
        rating,
        mentions: item.mentions,
        latest: item.latest,
      });
    }
  }

  return new Map(
    Array.from(bestByDish.entries()).map(([dishName, pick]) => [
      dishName,
      {
        restaurantName: pick.restaurantName,
        restaurantId: pick.restaurantId,
        rating: pick.rating,
        mentions: pick.mentions,
      },
    ])
  );
}

function buildDishComparisons(myReviews: Review[], publicReviews: Review[]): DishComparison[] {
  const yourBest = bestDishPicks(myReviews);
  const nearbyBest = bestDishPicks(publicReviews);

  return Array.from(yourBest.entries())
    .map(([dishName, pick]) => ({
      dishName,
      yourBest: pick,
      nearbyBest: nearbyBest.get(dishName) ?? null,
    }))
    .sort((a, b) => b.yourBest.rating - a.yourBest.rating || a.dishName.localeCompare(b.dishName));
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
            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, paddingLeft: 8 }}>
              <div style={{ position: "absolute", left: 10.5, top: 10, bottom: 10, width: 1, background: "linear-gradient(180deg, rgba(240,96,48,0.55), rgba(255,255,255,0.08))" }} />
              {group.entries.map((entry, index) => {
                const date = timelineDateParts(entry.created_at);
                const location = timelineLocationLabel(entry);
                return (
                  <div key={`${entry.restaurant_name}-${entry.created_at}-${index}`} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 999, background: "var(--orange)", border: "4px solid var(--bg)", flexShrink: 0, position: "relative", zIndex: 1, boxSizing: "content-box" }} />
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

function ReviewsTab({ reviews, engagement, myName }: { reviews: Review[]; engagement: EngagementMaps; myName: string }) {
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
    </div>
  );
}

function PickLine({ label, pick }: { label: string; pick: DishRestaurantPick | null }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: 10, alignItems: "baseline" }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>
        {label}
      </span>
      {pick ? (
        <Link href={restaurantHref(pick.restaurantName, pick.restaurantId)} style={{ minWidth: 0, textDecoration: "none" }}>
          <span style={{ fontSize: 13, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
            {pick.restaurantName} · {formatScore(pick.rating)}/10
          </span>
        </Link>
      ) : (
        <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
          Not enough nearby posts yet
        </span>
      )}
    </div>
  );
}

function DishesTab({ myReviews, publicReviews, loadingNearby }: { myReviews: Review[]; publicReviews: Review[]; loadingNearby: boolean }) {
  const comparisons = useMemo(() => buildDishComparisons(myReviews, publicReviews), [myReviews, publicReviews]);

  if (myReviews.length === 0) {
    return (
      <div style={{ padding: "60px 20px 110px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>No dishes yet</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 110px", display: "flex", flexDirection: "column", gap: 10 }}>
      {comparisons.map((item) => (
        <div key={item.dishName} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px" }}>
          <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, color: "var(--cream)", fontWeight: 800, marginBottom: 11, lineHeight: 1.2 }}>
            {item.dishName}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <PickLine label="Your best" pick={item.yourBest} />
            <PickLine label="Near you" pick={item.nearbyBest} />
          </div>
        </div>
      ))}
      {loadingNearby && (
        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, fontFamily: "'DM Sans', sans-serif", marginTop: 4 }}>
          Checking nearby public picks...
        </p>
      )}
    </div>
  );
}

export default function MeClient({
  allReviews,
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
}: {
  allReviews: Review[];
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
}) {
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const [myName, setMyName] = useState(initialMyName);
  const [displayName, setDisplayName] = useState(initialDisplayName || initialMyName);
  const [bio, setBio] = useState(initialBio);
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [activeTab, setActiveTab] = useState<MeTab>("reviews");
  const [nearbyPublicReviews, setNearbyPublicReviews] = useState<Review[]>([]);
  const [loadingNearbyDishes, setLoadingNearbyDishes] = useState(false);

  const myReviews = useMemo(() => allReviews.filter(r => r.reviewer_name === myName), [allReviews, myName]);
  const uniquePlaces = useMemo(() => new Set(myReviews.map(r => r.restaurant_name)).size, [myReviews]);
  const uniqueDishes = useMemo(() => uniqueDishesFor(myReviews), [myReviews]);
  const totalVisits = useMemo(() => myReviews.length, [myReviews]);

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
    if (!myName) return;

    let cancelled = false;
    async function loadNearbyPublicReviews() {
      setLoadingNearbyDishes(true);
      try {
        const params = new URLSearchParams({ limit: "40" });
        try {
          const lat = parseFloat(localStorage.getItem(TRENDING_LOCATION_LAT_STORAGE_KEY) ?? "");
          const lng = parseFloat(localStorage.getItem(TRENDING_LOCATION_LNG_STORAGE_KEY) ?? "");
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            params.set("lat", String(lat));
            params.set("lng", String(lng));
          }
        } catch {
          // Local storage can be unavailable; global public picks are still useful.
        }

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
  }, [myName]);

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
    activeTab === "dishes" ? <DishesTab myReviews={myReviews} publicReviews={nearbyPublicReviews} loadingNearby={loadingNearbyDishes} /> :
    <ReviewsTab reviews={myReviews} engagement={{ likeCountMap, commentMap, likedByMeMap, bookmarkedPostMap }} myName={myName} />;

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

      <MeTabs activeTab={activeTab} onChange={setActiveTab} />
      {tabContent}
    </div>
  );
}
