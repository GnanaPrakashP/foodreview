"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { CircleMember } from "@/lib/people-page-data";
import type { Comment, Review } from "@/lib/types";
import type { CircleFeedCursor } from "@/lib/circle-feed";
import {
  addName,
  isAcceptedCircleResponse,
  isOneWayCircleResponse,
  personStatusFor,
  removeName,
  type PersonStatus,
} from "@/lib/people-circle-state";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Check, MessageCircle, Search, Star, Store, Utensils, Users, X } from "lucide-react";
import { cachedCircleStatus, invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { profileDisplayName } from "@/lib/profile-names";
import { getStoredActorName } from "@/lib/browser-actor";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";

const FEED_PAGE_SIZE = 24;

/* ─── Categories ─────────────────────────────────── */

const CATEGORIES = [
  { id: "all",      label: "All",      emoji: "✦",  keywords: [] },
  { id: "burgers",  label: "Burgers",  emoji: "🍔", keywords: ["burger", "smash", "patty", "bun"] },
  { id: "pizza",    label: "Pizza",    emoji: "🍕", keywords: ["pizza", "margherita", "pepperoni"] },
  { id: "biryani",  label: "Biryani",  emoji: "🍛", keywords: ["biryani", "rice", "curry", "dal", "butter chicken", "masala"] },
  { id: "desserts", label: "Desserts", emoji: "🧁", keywords: ["cake", "ice cream", "dessert", "brownie", "cookie", "waffle", "gelato", "pastry", "pudding"] },
  { id: "cafe",     label: "Café",     emoji: "☕", keywords: ["coffee", "latte", "espresso", "cappuccino", "cold brew", "chai", "tea"] },
  { id: "shakes",   label: "Shakes",   emoji: "🥤", keywords: ["milkshake", "shake", "smoothie", "frappe"] },
  { id: "fried",    label: "Fried",    emoji: "🍟", keywords: ["fries", "fried chicken", "nuggets", "wings", "crispy"] },
  { id: "noodles",  label: "Noodles",  emoji: "🍜", keywords: ["noodles", "ramen", "pho", "pasta", "spaghetti", "udon"] },
  { id: "wraps",    label: "Wraps",    emoji: "🌮", keywords: ["wrap", "taco", "roll", "kathi", "shawarma", "burrito"] },
] as const;

type CategoryId = typeof CATEGORIES[number]["id"];

/* ─── Types ─────────────────────────────────────── */

type ProfileSearchRow = { username: string; first_name: string; last_name: string };

type PeopleResult   = { name: string; displayName: string; totalPlaces: number };
type RestaurantResult = { name: string; reviewerCount: number };
type DishResult     = { itemName: string; rating: number; restaurantName: string; reviewerName: string; reviewerDisplayName: string };

type ExploreTab = "posts" | "restaurants" | "dishes" | "people";
type TimeFilter = "week" | "month" | "alltime";

type RestaurantSpotlight = {
  name: string;
  reviewerCount: number;
  averageRating: number;
  topDish: string;
  topDishes: string[];
  area: string | null;
  photo: string | null;
  weekUsers: number;
  monthUsers: number;
};

type DishSpotlight = {
  key: string;
  name: string;
  rating: number;
  restaurantName: string;
  photo: string | null;
};

type PublicFeedResponse = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  hasMore: boolean;
  nextCursor: CircleFeedCursor | null;
};

/* ─── Helpers ────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function avatarColor(name: string): string {
  const gradients = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
    "linear-gradient(135deg,#14B8A6,#0F766E)",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return gradients[hash % gradients.length];
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0]! + parts[1][0]!).toUpperCase()
    : (parts[0]?.[0] ?? "?").toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: "14px", background: avatarColor(name), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.34, color: "white", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
      {initials || "?"}
    </div>
  );
}

function toHandle(username: string): string { return "@" + username; }

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ padding: "0 16px 8px", fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "'DM Sans', sans-serif" }}>
      {children}
    </p>
  );
}

function matchesCategory(items: Array<{ name: string; rating: number }>, categoryId: CategoryId): boolean {
  if (categoryId === "all") return true;
  const cat = CATEGORIES.find(c => c.id === categoryId);
  if (!cat || cat.keywords.length === 0) return true;
  return items.some(item =>
    cat.keywords.some(kw => item.name.toLowerCase().includes(kw))
  );
}

function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function topRestaurantsFromFeed(feed: Review[], timeFilter: TimeFilter): RestaurantSpotlight[] {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const restaurants = new Map<string, {
    reviewers: Set<string>;
    weekReviewers: Set<string>;
    monthReviewers: Set<string>;
    ratingTotal: number;
    ratingCount: number;
    topDish: string;
    topDishRating: number;
    dishCounts: Map<string, number>;
    areaCounts: Map<string, number>;
    photo: string | null;
    latest: number;
  }>();

  for (const review of feed) {
    const photo = review.photo_urls?.[0] ?? review.photo_url;
    const existing = restaurants.get(review.restaurant_name) ?? {
      reviewers: new Set<string>(),
      weekReviewers: new Set<string>(),
      monthReviewers: new Set<string>(),
      ratingTotal: 0,
      ratingCount: 0,
      topDish: "",
      topDishRating: 0,
      dishCounts: new Map<string, number>(),
      areaCounts: new Map<string, number>(),
      photo: null,
      latest: 0,
    };
    const ts = new Date(review.created_at).getTime();
    existing.reviewers.add(review.reviewer_name);
    if (ts > weekAgo) existing.weekReviewers.add(review.reviewer_name);
    if (ts > monthAgo) existing.monthReviewers.add(review.reviewer_name);
    existing.latest = Math.max(existing.latest, ts);
    if (!existing.photo && photo) existing.photo = photo;
    if (review.area) existing.areaCounts.set(review.area, (existing.areaCounts.get(review.area) ?? 0) + 1);

    for (const item of review.items ?? []) {
      existing.ratingTotal += item.rating;
      existing.ratingCount += 1;
      if (item.name.trim()) existing.dishCounts.set(item.name, (existing.dishCounts.get(item.name) ?? 0) + 1);
      if (item.rating > existing.topDishRating) {
        existing.topDish = item.name;
        existing.topDishRating = item.rating;
      }
    }
    restaurants.set(review.restaurant_name, existing);
  }

  return Array.from(restaurants.entries())
    .map(([name, data]) => {
      const averageRating = data.ratingCount > 0 ? data.ratingTotal / data.ratingCount : 0;
      const topDishes = Array.from(data.dishCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([dish]) => dish);
      const area = data.areaCounts.size > 0
        ? Array.from(data.areaCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
        : null;
      const activeUsers =
        timeFilter === "week" ? data.weekReviewers.size :
        timeFilter === "month" ? data.monthReviewers.size :
        data.reviewers.size;
      return {
        name,
        reviewerCount: data.reviewers.size,
        averageRating,
        topDish: data.topDish,
        topDishes,
        area,
        photo: data.photo,
        weekUsers: data.weekReviewers.size,
        monthUsers: data.monthReviewers.size,
        score: activeUsers * 100 + averageRating + data.latest / 1_000_000_000_000,
      };
    })
    .filter((restaurant) => timeFilter === "alltime" || (timeFilter === "week" ? restaurant.weekUsers > 0 : restaurant.monthUsers > 0))
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...restaurant }) => restaurant);
}

function bestDishesFromFeed(feed: Review[]): DishSpotlight[] {
  const dishes = new Map<string, DishSpotlight & { latest: number }>();

  for (const review of feed) {
    const photo = review.photo_urls?.[0] ?? review.photo_url;
    const latest = new Date(review.created_at).getTime();
    for (const item of review.items ?? []) {
      const key = `${item.name.toLowerCase()}|${review.restaurant_name.toLowerCase()}`;
      const existing = dishes.get(key);
      if (!existing || item.rating > existing.rating || (item.rating === existing.rating && latest > existing.latest)) {
        dishes.set(key, {
          key,
          name: item.name,
          rating: item.rating,
          restaurantName: review.restaurant_name,
          photo,
          latest,
        });
      }
    }
  }

  return Array.from(dishes.values())
    .sort((a, b) => b.rating - a.rating || b.latest - a.latest)
    .map(({ latest: _latest, ...dish }) => dish);
}

/* ─── Feed card ──────────────────────────────────── */

function FeedCard({ item }: { item: Review }) {
  const topDish = item.items?.length > 0
    ? item.items.reduce((a, b) => b.rating > a.rating ? b : a)
    : null;
  const photo = item.photo_urls?.[0] ?? item.photo_url;

  return (
    <Link
      href={`/trending/${encodeURIComponent(item.restaurant_name)}`}
      style={{ textDecoration: "none", display: "block", margin: "0 16px 10px" }}
    >
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", overflow: "hidden", display: "flex", alignItems: "stretch", gap: 0 }}>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            style={{ width: "90px", height: "90px", objectFit: "cover", flexShrink: 0 }}
          />
        )}
        <div style={{ padding: "12px 14px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "3px" }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.restaurant_name}
          </p>
          {topDish && (
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--orange)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {topDish.name}
              <span style={{ color: "var(--muted)", marginLeft: "6px" }}>★ {topDish.rating}</span>
            </p>
          )}
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", margin: 0 }}>
            by {item.reviewer_name} · {timeAgo(item.created_at)}
          </p>
        </div>
      </div>
    </Link>
  );
}

/* ─── Person card ────────────────────────────────── */

function PersonCard({
  name,
  displayName,
  sub,
  status,
  onAdd,
  onInCircleClick,
}: {
  name: string;
  displayName?: string;
  sub: string;
  status: PersonStatus;
  onAdd?: () => void;
  onInCircleClick?: () => void;
}) {
  const shownName = displayName || name;
  return (
    <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
      <Link href={`/people/${encodeURIComponent(name)}`} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
        <Avatar name={shownName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif" }}>{shownName}</p>
          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>{sub}</p>
        </div>
      </Link>
      {status === "one_way" ? (
        <button onClick={onInCircleClick} style={{ background: "rgba(61,214,140,0.12)", border: "1.5px solid rgba(61,214,140,0.35)", color: "var(--green)", fontSize: "11px", fontWeight: 600, padding: "6px 12px", borderRadius: "100px", cursor: onInCircleClick ? "pointer" : "default", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
          In Circle
        </button>
      ) : status === "sent" ? (
        <button onClick={onAdd} style={{ background: "rgba(240,96,48,0.12)", border: "1.5px solid rgba(240,96,48,0.35)", color: "var(--orange)", fontSize: "11px", fontWeight: 600, padding: "6px 12px", borderRadius: "100px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
          Requested
        </button>
      ) : (
        <button onClick={onAdd} style={{ background: "rgba(240,96,48,0.12)", border: "1.5px solid rgba(240,96,48,0.35)", color: "var(--orange)", fontSize: "11px", fontWeight: 600, padding: "6px 12px", borderRadius: "100px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
          Request
        </button>
      )}
    </div>
  );
}

/* ─── Request card ───────────────────────────────── */

function RequestCard({ name, displayName, onAccept, onReject }: { name: string; displayName?: string; onAccept: () => void; onReject: () => void }) {
  const shownName = displayName || name;
  return (
    <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid rgba(240,96,48,0.25)", borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
      <Link href={`/people/${encodeURIComponent(name)}`} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
        <Avatar name={shownName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif" }}>{shownName}</p>
          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>wants to join your circle</p>
        </div>
      </Link>
      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
        <button onClick={onReject} style={{ width: "32px", height: "32px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "100px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={14} strokeWidth={2.5} color="var(--muted)" />
        </button>
        <button onClick={onAccept} style={{ width: "32px", height: "32px", background: "var(--orange)", border: "none", borderRadius: "100px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Check size={14} strokeWidth={2.5} color="white" />
        </button>
      </div>
    </div>
  );
}

function DiscoveryHeader({
  title,
  subtitle,
  Icon,
}: {
  title: string;
  subtitle?: string;
  Icon: typeof Store;
}) {
  return (
    <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon size={16} strokeWidth={2.2} color="var(--orange)" />
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
            {title}
          </h2>
        </div>
        {subtitle && (
          <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "3px", fontFamily: "'DM Sans', sans-serif" }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function PhotoTile({ photo, label, height = 86 }: { photo: string | null; label: string; height?: number }) {
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        style={{ width: "100%", height, objectFit: "cover", display: "block", background: "var(--surface)" }}
      />
    );
  }

  return (
    <div style={{ width: "100%", height, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontWeight: 700, fontSize: "24px", fontFamily: "'Syne', sans-serif" }}>
      {label[0]?.toUpperCase() ?? "F"}
    </div>
  );
}

function ExploreTabs({ activeTab, onChange }: { activeTab: ExploreTab; onChange: (tab: ExploreTab) => void }) {
  const tabs: Array<{ id: ExploreTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "restaurants", label: "Restaurants" },
    { id: "dishes", label: "Dishes" },
    { id: "people", label: "People" },
  ];

  return (
    <div style={{ display: "flex", padding: "0 16px 14px" }}>
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

function Stars({ rating, size = 10 }: { rating: number; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 12 12"
          fill={i <= Math.round(rating) ? "#F59E0B" : "none"}
          stroke="#F59E0B"
          strokeWidth="1.5"
        >
          <polygon points="6,1 7.5,4.5 11,5 8.5,7.5 9,11 6,9.5 3,11 3.5,7.5 1,5 4.5,4.5" />
        </svg>
      ))}
      <span style={{ fontSize: size, color: "var(--muted)", marginLeft: 3 }}>{rating.toFixed(1)}</span>
    </div>
  );
}

function RestaurantList({
  restaurants,
  timeFilter,
  onTimeFilterChange,
  loading,
}: {
  restaurants: RestaurantSpotlight[];
  timeFilter: TimeFilter;
  onTimeFilterChange: (timeFilter: TimeFilter) => void;
  loading: boolean;
}) {
  return (
    <div style={{ paddingBottom: "100px" }}>
      <div style={{ padding: "0 16px 14px", display: "flex", gap: 7 }}>
        {(["week", "month", "alltime"] as TimeFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => onTimeFilterChange(t)}
            style={{
              padding: "4px 14px",
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              background: timeFilter === t ? "#F59E0B" : "transparent",
              border: `1px solid ${timeFilter === t ? "#F59E0B" : "var(--border)"}`,
              color: timeFilter === t ? "#0D0D0D" : "var(--muted)",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {t === "week" ? "This Week" : t === "month" ? "This Month" : "All Time"}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 16px" }}>
        {loading && restaurants.length === 0 ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 118, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 10, opacity: 0.5 }} />
          ))
        ) : restaurants.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>No restaurants yet</p>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Public posts will shape this list.</p>
          </div>
        ) : (
          restaurants.map((restaurant) => {
            const activeVisits =
              timeFilter === "week" ? restaurant.weekUsers :
              timeFilter === "month" ? restaurant.monthUsers :
              restaurant.reviewerCount;
            return (
              <Link key={restaurant.name} href={`/trending/${encodeURIComponent(restaurant.name)}`} style={{ textDecoration: "none", display: "block", marginBottom: 10 }}>
                <div
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 16,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                        <div>
                          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 600, color: "var(--cream)", lineHeight: 1.2 }}>{restaurant.name}</div>
                          {restaurant.area && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{restaurant.area}</div>}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        {restaurant.averageRating > 0 && <Stars rating={restaurant.averageRating} size={10} />}
                        {restaurant.averageRating > 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>·</span>}
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{activeVisits} visit{activeVisits !== 1 ? "s" : ""}</span>
                      </div>

                      {restaurant.topDishes.length > 0 && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {restaurant.topDishes.map((dish) => (
                            <span key={dish} style={{ fontSize: 10, color: "var(--cream)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 7px" }}>
                              {dish}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

function DishRail({ dishes }: { dishes: DishSpotlight[] }) {
  if (dishes.length === 0) return null;

  return (
    <section style={{ margin: "4px 0 18px" }}>
      <DiscoveryHeader title="Best rated dishes" subtitle="Dish-first picks from recent reviews" Icon={Utensils} />
      <div style={{ padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
        {dishes.slice(0, 4).map((dish) => (
          <Link
            key={dish.key}
            href={`/trending/${encodeURIComponent(dish.restaurantName)}`}
            style={{ textDecoration: "none", minWidth: 0 }}
          >
            <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", minHeight: "174px" }}>
              <PhotoTile photo={dish.photo} label={dish.name} height={86} />
              <div style={{ padding: "10px 11px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--gold)", fontSize: "12px", fontWeight: 700, marginBottom: "5px" }}>
                  <Star size={13} fill="currentColor" strokeWidth={0} />
                  {formatRating(dish.rating)}
                </div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", lineHeight: 1.15, fontWeight: 700, color: "var(--cream)", margin: 0, minHeight: "32px", overflow: "hidden" }}>
                  {dish.name}
                </p>
                <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {dish.restaurantName}
                </p>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </section>
  );
}

function PeopleStrip({
  people,
  statusFor,
  onAdd,
  onInCircleClick,
}: {
  people: CircleMember[];
  statusFor: (name: string) => PersonStatus;
  onAdd: (name: string) => void;
  onInCircleClick: (name: string) => void;
}) {
  if (people.length === 0) return null;

  return (
    <section style={{ margin: "4px 0 18px" }}>
      <DiscoveryHeader title="People to discover" subtitle="Find taste matches before you search" Icon={Users} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {people.slice(0, 4).map((person) => (
          <PersonCard
            key={person.name}
            name={person.name}
            displayName={person.displayName}
            sub={person.lastPlace ? `${person.totalPlaces} places · latest at ${person.lastPlace}` : `${person.totalPlaces} place${person.totalPlaces !== 1 ? "s" : ""}`}
            status={statusFor(person.name)}
            onInCircleClick={statusFor(person.name) === "one_way" ? () => onInCircleClick(person.name) : undefined}
            onAdd={() => onAdd(person.name)}
          />
        ))}
      </div>
    </section>
  );
}

/* ─── Main Component ─────────────────────────────── */

export default function PeopleTab({ initialCircle }: { initialCircle: CircleMember[] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [peopleResults, setPeopleResults] = useState<PeopleResult[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<RestaurantResult[]>([]);
  const [dishResults, setDishResults] = useState<DishResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [activeTab, setActiveTab] = useState<ExploreTab>("posts");
  const [restaurantTimeFilter, setRestaurantTimeFilter] = useState<TimeFilter>("week");
  const [selectedCategory] = useState<CategoryId>("all");
  const [feed, setFeed] = useState<Review[]>([]);
  const [feedLikeCountMap, setFeedLikeCountMap] = useState<Record<string, number>>({});
  const [feedCommentMap, setFeedCommentMap] = useState<Record<string, { count: number; top: Comment }>>({});
  const [feedLikedMap, setFeedLikedMap] = useState<Record<string, boolean>>({});
  const [feedBookmarkedMap, setFeedBookmarkedMap] = useState<Record<string, boolean>>({});
  const [feedProfileMap, setFeedProfileMap] = useState<Record<string, string>>({});
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedNextCursor, setFeedNextCursor] = useState<CircleFeedCursor | null>(null);
  const [feedError, setFeedError] = useState("");
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const [myName, setMyName] = useState("");
  const [circleMembers, setCircleMembers] = useState<Set<string>>(new Set());
  const [pendingSent, setPendingSent] = useState<Set<string>>(new Set());
  const [pendingIncoming, setPendingIncoming] = useState<string[]>([]);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [confirmCancelName, setConfirmCancelName] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmLeaveName, setConfirmLeaveName] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);

  /* ── Load circle status ── */

  const loadCircleStatus = useCallback(async (name: string) => {
    if (!name) { setStatusLoaded(true); return; }
    const data = await cachedCircleStatus(name);
    setCircleMembers(new Set(data.members ?? []));
    setPendingSent(new Set(data.pendingSent ?? []));
    setPendingIncoming(data.pendingIncoming ?? []);
    setStatusLoaded(true);
  }, []);

  useEffect(() => {
    const me = getStoredActorName();
    setMyName(me);
    loadCircleStatus(me);
  }, [loadCircleStatus]);

  /* ── Load discovery feed ── */

  const loadFeedPage = useCallback(async (cursor: CircleFeedCursor | null = null, viewerName = myName) => {
    if (!cursor) {
      setFeedLoading(true);
      setFeedError("");
    }
    else setFeedLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(FEED_PAGE_SIZE) });
      if (viewerName) params.set("viewer", viewerName);
      if (cursor) params.set("cursor", JSON.stringify(cursor));
      const response = await fetch(`/api/feed/public?${params}`, { cache: "no-store" });
      const data = await response.json() as PublicFeedResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Unable to load public posts");

      const rows = data.reviews ?? [];
      setFeed((current) => {
        if (!cursor) return rows;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...rows.filter((item) => !seen.has(item.id))];
      });
      setFeedLikeCountMap((current) => cursor ? { ...current, ...(data.likeCountMap ?? {}) } : (data.likeCountMap ?? {}));
      setFeedCommentMap((current) => cursor ? { ...current, ...(data.commentMap ?? {}) } : (data.commentMap ?? {}));
      setFeedLikedMap((current) => cursor ? { ...current, ...(data.likedByMeMap ?? {}) } : (data.likedByMeMap ?? {}));
      setFeedBookmarkedMap((current) => cursor ? { ...current, ...(data.bookmarkedPostMap ?? {}) } : (data.bookmarkedPostMap ?? {}));
      setFeedProfileMap((current) => cursor ? { ...current, ...(data.profileMap ?? {}) } : (data.profileMap ?? {}));
      setFeedHasMore(Boolean(data.hasMore));
      setFeedNextCursor(data.nextCursor ?? null);
    } catch {
      setFeedError("Could not load public posts. Please try again.");
    } finally {
      if (!cursor) setFeedLoading(false);
      else setFeedLoadingMore(false);
    }
  }, [myName]);

  useEffect(() => {
    const me = getStoredActorName();
    loadFeedPage(null, me);
  }, [loadFeedPage]);

  useEffect(() => {
    if (activeTab !== "posts" || searchQuery.trim() || feedLoading || feedLoadingMore || !feedHasMore) return;
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadFeedPage(feedNextCursor);
        }
      },
      { rootMargin: "420px 0px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [activeTab, feedHasMore, feedLoading, feedLoadingMore, feedNextCursor, loadFeedPage, searchQuery]);

  /* ── Circle actions ── */

  async function sendRequest(receiverName: string) {
    if (!myName || myName === receiverName) return;
    const isPublicAccount = initialCircle.find((m) => m.name === receiverName)?.accountType === "public";
    if (isPublicAccount) {
      setCircleMembers((prev) => addName(prev, receiverName));
    } else {
      setPendingSent((prev) => addName(prev, receiverName));
    }
    const res = await fetch("/api/circle/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: myName, receiverName }) });
    const data = await res.json();
    if (!res.ok) {
      if (isPublicAccount) setCircleMembers((prev) => removeName(prev, receiverName));
      else setPendingSent((prev) => removeName(prev, receiverName));
      return;
    }
    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(receiverName);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");
    if (!isPublicAccount && (isAcceptedCircleResponse(data) || isOneWayCircleResponse(data))) {
      setPendingSent((prev) => removeName(prev, receiverName));
      setCircleMembers((prev) => addName(prev, receiverName));
    }
  }

  async function respondToRequest(senderName: string, action: "accept" | "reject") {
    if (!myName) return;
    setPendingIncoming((prev) => prev.filter((n) => n !== senderName));
    if (action === "accept") setCircleMembers((prev) => addName(prev, senderName));
    const res = await fetch("/api/circle/respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ myName, senderName, action }) });
    if (!res.ok) {
      setPendingIncoming((prev) => [...prev, senderName]);
      if (action === "accept") setCircleMembers((prev) => removeName(prev, senderName));
      return;
    }
    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(senderName);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");
  }

  async function cancelRequest(receiverName: string) {
    if (!myName || cancelBusy) return;
    setCancelBusy(true);
    setPendingSent((prev) => removeName(prev, receiverName));
    try {
      const res = await fetch("/api/circle/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: myName, receiverName }) });
      if (!res.ok) { setPendingSent((prev) => addName(prev, receiverName)); return; }
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(receiverName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } finally {
      setCancelBusy(false);
    }
  }

  async function leaveCircle(otherName: string) {
    if (!myName || leaveBusy) return;
    setLeaveBusy(true);
    setCircleMembers((prev) => removeName(prev, otherName));
    try {
      const res = await fetch("/api/circle/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ myName, otherName }) });
      if (!res.ok) { setCircleMembers((prev) => addName(prev, otherName)); return; }
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(otherName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } finally {
      setLeaveBusy(false);
    }
  }

  /* ── Unified search ── */

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setPeopleResults([]);
      setRestaurantResults([]);
      setDishResults([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    const supabase = createClient();
    const trimmed = q.trim();

    const [
      { data: reviewerData },
      { data: profileData },
      { data: restaurantData },
      { data: dishData },
    ] = await Promise.all([
      supabase.from("reviews").select("reviewer_name").eq("visibility", "public").ilike("reviewer_name", `%${trimmed}%`).returns<{ reviewer_name: string }[]>(),
      supabase.from("profiles").select("username, first_name, last_name").or(`username.ilike.%${trimmed}%,first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%`).returns<ProfileSearchRow[]>(),
      supabase.from("reviews").select("restaurant_name, reviewer_name").eq("visibility", "public").eq("status", "active").ilike("restaurant_name", `%${trimmed}%`).limit(30).returns<{ restaurant_name: string; reviewer_name: string }[]>(),
      supabase.from("reviews").select("reviewer_name, restaurant_name, items").eq("visibility", "public").eq("status", "active").filter("items::text", "ilike", `%${trimmed}%`).limit(20).returns<{ reviewer_name: string; restaurant_name: string; items: Array<{ name: string; rating: number }> }[]>(),
    ]);

    // People
    const displayNameByUsername = new Map<string, string>();
    for (const p of profileData ?? []) {
      if (p.username) displayNameByUsername.set(p.username, profileDisplayName(p, p.username));
    }
    const peopleMap = new Map<string, number>();
    for (const r of reviewerData ?? []) {
      if (r.reviewer_name) peopleMap.set(r.reviewer_name, (peopleMap.get(r.reviewer_name) ?? 0) + 1);
    }
    for (const p of profileData ?? []) {
      if (p.username && !peopleMap.has(p.username)) peopleMap.set(p.username, 0);
    }
    setPeopleResults(
      Array.from(peopleMap.entries())
        .filter(([name]) => name !== myName)
        .map(([name, totalPlaces]) => ({ name, displayName: displayNameByUsername.get(name) || name, totalPlaces }))
    );

    // Restaurants
    const restaurantMap = new Map<string, Set<string>>();
    for (const r of restaurantData ?? []) {
      if (r.restaurant_name) {
        if (!restaurantMap.has(r.restaurant_name)) restaurantMap.set(r.restaurant_name, new Set());
        if (r.reviewer_name) restaurantMap.get(r.restaurant_name)!.add(r.reviewer_name);
      }
    }
    setRestaurantResults(
      Array.from(restaurantMap.entries()).map(([name, reviewers]) => ({ name, reviewerCount: reviewers.size }))
    );

    // Dishes
    const seen = new Set<string>();
    const dishes: DishResult[] = [];
    for (const r of dishData ?? []) {
      for (const item of (r.items as Array<{ name: string; rating: number }> ?? [])) {
        if (item.name.toLowerCase().includes(trimmed.toLowerCase())) {
          const key = `${item.name}|${r.restaurant_name}`;
          if (!seen.has(key)) {
            seen.add(key);
            dishes.push({
              itemName: item.name,
              rating: item.rating,
              restaurantName: r.restaurant_name,
              reviewerName: r.reviewer_name,
              reviewerDisplayName: displayNameByUsername.get(r.reviewer_name) || r.reviewer_name,
            });
          }
        }
      }
    }
    setDishResults(dishes);
    setHasSearched(true);
    setSearching(false);
  }, [myName]);

  useEffect(() => {
    const t = setTimeout(() => search(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery, search]);

  /* ── Derived ── */

  function personStatus(name: string): PersonStatus {
    return personStatusFor(name, { circleMembers, pendingSent });
  }

  const filteredFeed = selectedCategory === "all"
    ? feed
    : feed.filter(item => matchesCategory(item.items ?? [], selectedCategory));

  const isSearching = searchQuery.trim() !== "";
  const topRestaurants = useMemo(() => topRestaurantsFromFeed(filteredFeed, restaurantTimeFilter), [filteredFeed, restaurantTimeFilter]);
  const bestDishes = useMemo(() => bestDishesFromFeed(filteredFeed).slice(0, 8), [filteredFeed]);
  const suggestedPeople = useMemo(
    () => initialCircle
      .filter((person) => person.name !== myName)
      .filter((person) => !circleMembers.has(person.name))
      .filter((person) => !pendingIncoming.includes(person.name))
      .slice(0, 6),
    [circleMembers, initialCircle, myName, pendingIncoming]
  );

  function handlePeopleAction(name: string) {
    if (personStatus(name) === "sent") setConfirmCancelName(name);
    else sendRequest(name);
  }

  /* ── Render ── */

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Search bar */}
      <div style={{ padding: "16px 16px 12px" }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Search size={17} strokeWidth={2.2} color="var(--muted)" style={{ flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search people, dishes or restaurants…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontSize: "14px", fontFamily: "'DM Sans', sans-serif" }}
          />
          {searchQuery && (
            <button aria-label="Clear search" onClick={() => setSearchQuery("")} style={{ width: "24px", height: "24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "999px", color: "var(--muted)", cursor: "pointer", lineHeight: 1, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={13} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>

      {/* ── Search mode ── */}
      {isSearching && (
        <div style={{ paddingBottom: "100px" }}>
          {searching && (
            <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse" style={{ height: "64px", background: "var(--card)", borderRadius: "16px", opacity: 0.5 }} />
              ))}
            </div>
          )}

          {!searching && hasSearched && (
            <>
              {/* People */}
              {peopleResults.length > 0 && (
                <>
                  <SectionLabel>People</SectionLabel>
                  {peopleResults.map((r) => (
                    <PersonCard
                      key={r.name}
                      name={r.name}
                      displayName={r.displayName}
                      sub={`${toHandle(r.name)} · ${r.totalPlaces} place${r.totalPlaces !== 1 ? "s" : ""}`}
                      status={personStatus(r.name)}
                      onInCircleClick={personStatus(r.name) === "one_way" ? () => setConfirmLeaveName(r.name) : undefined}
                      onAdd={personStatus(r.name) === "sent" ? () => setConfirmCancelName(r.name) : () => sendRequest(r.name)}
                    />
                  ))}
                </>
              )}

              {/* Restaurants */}
              {restaurantResults.length > 0 && (
                <>
                  {peopleResults.length > 0 && <div style={{ height: "8px" }} />}
                  <SectionLabel>Restaurants</SectionLabel>
                  {restaurantResults.map((r) => (
                    <Link key={r.name} href={`/trending/${encodeURIComponent(r.name)}`} style={{ textDecoration: "none", display: "block", margin: "0 16px 10px" }}>
                      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>
                          🍽️
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.name}
                          </p>
                          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
                            {r.reviewerCount} {r.reviewerCount === 1 ? "review" : "reviews"}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </>
              )}

              {/* Dishes */}
              {dishResults.length > 0 && (
                <>
                  {(peopleResults.length > 0 || restaurantResults.length > 0) && <div style={{ height: "8px" }} />}
                  <SectionLabel>Dishes</SectionLabel>
                  {dishResults.map((d) => (
                    <Link key={`${d.itemName}|${d.restaurantName}`} href={`/trending/${encodeURIComponent(d.restaurantName)}`} style={{ textDecoration: "none", display: "block", margin: "0 16px 10px" }}>
                      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>
                          🍴
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {d.itemName}
                            <span style={{ color: "var(--orange)", fontWeight: 400, marginLeft: "6px" }}>★ {d.rating}</span>
                          </p>
                          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {d.restaurantName} · by {d.reviewerDisplayName}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </>
              )}

              {/* Empty state */}
              {peopleResults.length === 0 && restaurantResults.length === 0 && dishResults.length === 0 && (
                <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "32px 0", fontFamily: "'DM Sans', sans-serif" }}>
                  No results for &ldquo;{searchQuery}&rdquo;
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Idle mode ── */}
      {!isSearching && (
        <>
          <ExploreTabs activeTab={activeTab} onChange={setActiveTab} />

          {/* Circle requests */}
          {activeTab === "people" && pendingIncoming.length > 0 && (
            <>
              <DiscoveryHeader title={`Circle requests · ${pendingIncoming.length}`} subtitle="People waiting to join your taste circle" Icon={MessageCircle} />
              {pendingIncoming.map((name) => {
                const member = initialCircle.find((m) => m.name === name);
                return (
                  <RequestCard
                    key={name}
                    name={name}
                    displayName={member?.displayName}
                    onAccept={() => respondToRequest(name, "accept")}
                    onReject={() => respondToRequest(name, "reject")}
                  />
                );
              })}
              <div style={{ height: "6px" }} />
            </>
          )}

          {activeTab === "posts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, paddingBottom: "100px" }}>
              {feedLoading && feed.length === 0 && (
                [1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse" style={{ height: "360px", background: "var(--card)", borderBottom: "1px solid var(--border)", opacity: 0.5 }} />
                ))
              )}

              {!feedLoading && filteredFeed.length === 0 && (
                <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "48px 24px", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}>
                  No public posts yet.<br />Be the first to share one.
                </p>
              )}

              {filteredFeed.map((review, index) => {
                const eng = feedCommentMap[review.id];
                const status = personStatus(review.reviewer_name);
                return (
                  <CircleFeedCard
                    key={review.id}
                    review={review}
                    initialLikeCount={feedLikeCountMap[review.id] ?? 0}
                    initialCommentCount={eng?.count ?? 0}
                    initialLiked={feedLikedMap[review.id] ?? false}
                    initialBookmarked={feedBookmarkedMap[review.id] ?? false}
                    initialMyName={myName}
                    profileMap={feedProfileMap}
                    priorityImage={index === 0}
                    requestStatus={status === "one_way" ? "joined" : status === "sent" ? "pending" : "idle"}
                    onRequestClick={() => handlePeopleAction(review.reviewer_name)}
                  />
                );
              })}

              {feedError && (
                <p style={{ color: "#F87171", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", margin: "12px 12px 0" }}>
                  {feedError}
                </p>
              )}

              <div ref={loadMoreRef} style={{ height: "1px" }} />

              {!feedLoading && feedLoadingMore && (
                [1, 2].map((i) => (
                  <div key={i} className="animate-pulse" style={{ height: "260px", background: "var(--card)", borderBottom: "1px solid var(--border)", opacity: 0.45 }} />
                ))
              )}

              {!feedLoading && !feedHasMore && filteredFeed.length > 8 && (
                <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "10px 0 20px", fontFamily: "'DM Sans', sans-serif" }}>
                  You are caught up for now.
                </p>
              )}
            </div>
          )}

          {activeTab === "restaurants" && (
            <RestaurantList
              restaurants={topRestaurants}
              timeFilter={restaurantTimeFilter}
              onTimeFilterChange={setRestaurantTimeFilter}
              loading={feedLoading}
            />
          )}

          {activeTab === "dishes" && (
            <>
              <DishRail dishes={bestDishes} />
              <div style={{ height: "100px" }} />
            </>
          )}

          {activeTab === "people" && (
            <>
              <PeopleStrip
                people={suggestedPeople}
                statusFor={personStatus}
                onAdd={handlePeopleAction}
                onInCircleClick={setConfirmLeaveName}
              />
              <div style={{ height: "100px" }} />
            </>
          )}
        </>
      )}

      <ConfirmModal
        open={Boolean(confirmCancelName)}
        title="Cancel request?"
        message={confirmCancelName ? `Cancel request to join ${initialCircle.find(m => m.name === confirmCancelName)?.displayName || confirmCancelName}'s circle?` : ""}
        confirmText="Cancel request"
        disabled={cancelBusy}
        onCancel={() => setConfirmCancelName(null)}
        onConfirm={async () => {
          const target = confirmCancelName;
          if (!target) return;
          setConfirmCancelName(null);
          await cancelRequest(target);
        }}
      />
      <ConfirmModal
        open={Boolean(confirmLeaveName)}
        title="Leave circle?"
        message={confirmLeaveName ? `Do you no longer want to be in ${initialCircle.find(m => m.name === confirmLeaveName)?.displayName || confirmLeaveName}'s circle?` : ""}
        confirmText="Leave"
        confirmVariant="danger"
        disabled={leaveBusy}
        onCancel={() => setConfirmLeaveName(null)}
        onConfirm={async () => {
          const target = confirmLeaveName;
          if (!target) return;
          setConfirmLeaveName(null);
          await leaveCircle(target);
        }}
      />
    </div>
  );
}
