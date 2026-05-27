"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
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
import {
  Check,
  ChevronDown,
  LocateFixed,
  MessageCircle,
  Search,
  Store,
  Utensils,
  Users,
  X,
} from "lucide-react";
import { cachedCircleStatus, invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import { invalidateCachedJson, readCachedJson, refreshCachedJson } from "@/lib/browser-api-cache";
import { readFeedState, writeFeedState } from "@/lib/browser-feed-state";
import { profileDisplayName } from "@/lib/profile-names";
import { getStoredActorName } from "@/lib/browser-actor";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import {
  normalizeLocationLabel,
  TRENDING_LOCATION_LABEL_COOKIE,
  TRENDING_LOCATION_LABEL_STORAGE_KEY,
  TRENDING_LOCATION_LAT_STORAGE_KEY,
  TRENDING_LOCATION_LNG_STORAGE_KEY,
} from "@/lib/trending-location";
import { reviewMediaItems } from "@/lib/review-media";
import { CANONICAL_DISHES, dishSearchMatches, normalizeDishDisplayName } from "@/lib/dish-normalizer";
import {
  DISH_CATEGORIES,
  PLACE_CATEGORIES,
  dishCategoryImagePath,
  dishCategoryLabel,
  dishMatchesCategory,
  inferDishClusters,
  inferPlaceCategories,
  parseDishCategory,
  parsePlaceCategory,
  placeCategoryImagePath,
  placeCategoryLabel,
  placeMatchesCategory,
  type DishClusterId,
  type ExploreCategory,
  type PlaceCategoryId,
} from "@/lib/explore-categories";

const FEED_PAGE_SIZE = 24;
const FEED_TTL_MS = 2 * 60 * 1000;
const FEED_STATE_TTL_MS = 30 * 60 * 1000;
const MAX_PERSISTED_FEED_POSTS = 120;
const LOCATION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const EXPLORE_NEARBY_RADIUS_KM = 30;
const RESTAURANT_CARD_DISH_LIMIT = 3;

/* ─── Types ─────────────────────────────────────── */

type ProfileSearchRow = { username: string; first_name: string; last_name: string };

type PeopleResult   = { name: string; displayName: string; totalPlaces: number };
type RestaurantResult = AutocompleteItem;
type DishResult = { canonicalName: string; mentionCount: number };

type ExploreTab = "posts" | "restaurants" | "dishes" | "people";
type UserLocation = { lat: number; lng: number; label: string };
type AutocompleteItem = { placeId: string; text: string; mainText: string; secondaryText: string };

type RestaurantSpotlight = {
  name: string;
  reviewers: string[];
  reviewerCount: number;
  averageRating: number;
  topDish: string;
  topDishes: string[];
  tags: PlaceCategoryId[];
  area: string | null;
  photo: string | null;
  distanceKm: number | null;
};

type DishSpotlight = {
  key: string;
  name: string;
  averageRating: number;
  bestRating: number;
  mentionCount: number;
  reviewerCount: number;
  topRestaurantName: string;
  restaurants: string[];
  tags: string[];
  photo: string | null;
  topReviewSnippet: string | null;
  distanceKm: number | null;
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
  error?: string;
};

type ExploreFeedSnapshot = PublicFeedResponse & {
  activeTab: ExploreTab;
  locationLabel: string | null;
};

/* ─── Helpers ────────────────────────────────────── */

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

function shortLocationLabel(label: string): string {
  const normalized = normalizeLocationLabel(label) ?? "Set location";
  if (normalized.length <= 24) return normalized;
  const firstPart = normalized.split(",")[0]?.trim();
  if (firstPart && firstPart.length <= 24) return firstPart;
  return normalized.slice(0, 22).trimEnd() + "...";
}

function loadSavedLocation(): UserLocation | null {
  try {
    const lat = parseFloat(localStorage.getItem(TRENDING_LOCATION_LAT_STORAGE_KEY) ?? "");
    const lng = parseFloat(localStorage.getItem(TRENDING_LOCATION_LNG_STORAGE_KEY) ?? "");
    const label = normalizeLocationLabel(localStorage.getItem(TRENDING_LOCATION_LABEL_STORAGE_KEY));
    if (Number.isFinite(lat) && Number.isFinite(lng) && label) return { lat, lng, label };
  } catch {
    return null;
  }
  return null;
}

function saveLocation(loc: UserLocation) {
  try {
    localStorage.setItem(TRENDING_LOCATION_LAT_STORAGE_KEY, String(loc.lat));
    localStorage.setItem(TRENDING_LOCATION_LNG_STORAGE_KEY, String(loc.lng));
    localStorage.setItem(TRENDING_LOCATION_LABEL_STORAGE_KEY, loc.label);
    document.cookie = `${TRENDING_LOCATION_LABEL_COOKIE}=${encodeURIComponent(loc.label)}; Max-Age=${LOCATION_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  } catch {
    // Storage may be blocked; the in-memory Explore state still updates.
  }
}

function publicFeedUrl(viewerName: string, loc: UserLocation | null, cursor: CircleFeedCursor | null = null) {
  const params = new URLSearchParams({ limit: String(FEED_PAGE_SIZE), excludeSynthetic: "1" });
  if (viewerName) params.set("viewer", viewerName);
  if (loc) {
    params.set("lat", String(loc.lat));
    params.set("lng", String(loc.lng));
  }
  if (cursor) params.set("cursor", JSON.stringify(cursor));
  return `/api/feed/public?${params.toString()}`;
}

function locationBounds(loc: UserLocation, radiusKm = EXPLORE_NEARBY_RADIUS_KM) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((loc.lat * Math.PI) / 180)));
  return {
    minLat: loc.lat - latDelta,
    maxLat: loc.lat + latDelta,
    minLng: loc.lng - lngDelta,
    maxLng: loc.lng + lngDelta,
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ padding: "0 16px 8px", fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "'DM Sans', sans-serif" }}>
      {children}
    </p>
  );
}

function LocationPickerSheet({
  currentLocation,
  onClose,
  onSelect,
  anchorBottom,
}: {
  currentLocation: UserLocation | null;
  onClose: () => void;
  onSelect: (loc: UserLocation) => void;
  anchorBottom?: number;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const sessionToken = useRef(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ input: query.trim(), sessionToken: sessionToken.current });
        if (currentLocation) {
          params.set("lat", String(currentLocation.lat));
          params.set("lng", String(currentLocation.lng));
        }
        const res = await fetch(`/api/places/autocomplete?${params}`);
        const json = await res.json();
        setSuggestions(json.suggestions ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentLocation, query]);

  async function selectSuggestion(item: AutocompleteItem) {
    try {
      const params = new URLSearchParams({ placeId: item.placeId, sessionToken: sessionToken.current });
      const res = await fetch(`/api/places/details?${params}`);
      const json = await res.json();
      const details = json.details;
      if (details?.latitude != null && details?.longitude != null) {
        onSelect({
          lat: details.latitude,
          lng: details.longitude,
          label: details.shortFormattedAddress || item.mainText || item.text,
        });
      }
    } catch {
      // Leave the sheet open so the user can pick another result.
    }
    sessionToken.current = crypto.randomUUID();
  }

  async function resolveLabel(lat: number, lng: number): Promise<string> {
    try {
      const res = await fetch(`/api/places/reverse-geocode?lat=${lat}&lng=${lng}`);
      const json = await res.json();
      if (json.label) return json.label as string;
    } catch {
      // Fall through to generic label.
    }
    return "Current location";
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setGpsError("Location is not supported by this browser.");
      return;
    }
    setGpsLoading(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const label = await resolveLabel(latitude, longitude);
        setGpsLoading(false);
        onSelect({ lat: latitude, lng: longitude, label });
      },
      () => {
        setGpsLoading(false);
        setGpsError("Location access was denied.");
      },
      { timeout: 10000 }
    );
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.6)" }} />
      <div style={{ position: "fixed", top: anchorBottom ?? 72, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "32rem", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, zIndex: 61, padding: "14px 16px", boxSizing: "border-box" }}>
        <button
          onClick={useCurrentLocation}
          disabled={gpsLoading}
          style={{ width: "100%", padding: "11px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 13, display: "flex", alignItems: "center", gap: 10, cursor: gpsLoading ? "default" : "pointer", opacity: gpsLoading ? 0.7 : 1 }}
        >
          <LocateFixed size={16} strokeWidth={2.2} color="var(--orange)" />
          <span style={{ fontWeight: 700 }}>{gpsLoading ? "Getting location..." : "Use current location"}</span>
        </button>

        {gpsError && <p style={{ fontSize: 12, color: "#F87171", marginTop: 8, textAlign: "center" }}>{gpsError}</p>}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", display: "flex", gap: 9, alignItems: "center" }}>
          <Search size={15} strokeWidth={2.2} color="var(--muted)" />
          <input
            autoFocus
            placeholder="Search area or city..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}
          />
          {loading && <span style={{ fontSize: 11, color: "var(--muted)" }}>...</span>}
        </div>

        {suggestions.length > 0 && (
          <div style={{ marginTop: 8, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.placeId}
                onClick={() => selectSuggestion(suggestion)}
                style={{ width: "100%", padding: "10px 12px", textAlign: "left", cursor: "pointer", background: "var(--surface)", border: "none", borderTop: index > 0 ? "1px solid var(--border)" : "none", display: "flex", flexDirection: "column", gap: 2 }}
              >
                <span style={{ fontSize: 13, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>{suggestion.mainText}</span>
                {suggestion.secondaryText && <span style={{ fontSize: 11, color: "var(--muted)" }}>{suggestion.secondaryText}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function score10FromRating(value: number): number {
  return Math.round(value * 2 * 10) / 10;
}

function RatingScore({ rating }: { rating: number }) {
  if (rating <= 0) return null;

  return (
    <div style={{ minWidth: "46px", height: "38px", borderRadius: "13px", background: "linear-gradient(180deg, rgba(232,168,48,0.18), rgba(232,168,48,0.07))", border: "1px solid rgba(232,168,48,0.28)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>
      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--gold)" }}>{formatRating(score10FromRating(rating))}</span>
      <span style={{ marginTop: "2px", fontSize: "8px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontWeight: 800 }}>/10</span>
    </div>
  );
}

function distanceKmBetween(a: UserLocation, lat: number, lng: number): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat - a.lat) * Math.PI) / 180;
  const dLng = ((lng - a.lng) * Math.PI) / 180;
  const originLat = (a.lat * Math.PI) / 180;
  const destLat = (lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destLat) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(distanceKm: number | null, fallback: string | null): string {
  if (distanceKm != null) {
    if (distanceKm < 1) return `${Math.max(1, Math.round(distanceKm * 1000))} m`;
    return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
  }
  return fallback || "Nearby";
}

function tagsFromIds<T extends string>(ids: T[], labelFor: (id: T) => string, limit = 3): string[] {
  return ids
    .filter((id) => id !== "all")
    .slice(0, limit)
    .map(labelFor);
}


function PlaceCategoryImage({ category, size = 24 }: { category: PlaceCategoryId; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.34)),
        overflow: "hidden",
        flexShrink: 0,
        display: "inline-flex",
        background: "rgba(255,255,255,0.12)",
        backgroundImage: `url(${placeCategoryImagePath(category)})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    />
  );
}

function ImageCategoryGrid<T extends string>({
  ariaLabel,
  categories,
  selected,
  onChange,
  imagePathFor,
  imageSize = "clamp(76px, 22vw, 88px)",
}: {
  ariaLabel: string;
  categories: readonly ExploreCategory<T>[];
  selected: T;
  onChange: (category: T) => void;
  imagePathFor: (category: T) => string;
  imageSize?: string;
}) {
  return (
    <div
      className="hide-scrollbar"
      aria-label={ariaLabel}
      style={{
        overflowX: "auto",
        overscrollBehaviorX: "contain",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        padding: "0 16px 14px",
      }}
    >
      <div
        style={{
          width: "max(100%, 344px)",
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "16px 8px",
        }}
      >
        {categories.map((category) => {
          const active = category.id === selected;
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(category.id)}
              style={{
                minWidth: 0,
                border: "none",
                background: "transparent",
                color: active ? "var(--cream)" : "var(--muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: active ? 900 : 800,
                lineHeight: 1.2,
                textAlign: "center",
                cursor: "pointer",
                padding: "2px 0 0",
              }}
            >
              <Image
                src={category.imagePath ?? imagePathFor(category.id)}
                alt=""
                width={88}
                height={88}
                unoptimized
                style={{
                  width: imageSize,
                  height: imageSize,
                  maxWidth: "100%",
                  margin: "0 auto 8px",
                  display: "block",
                  objectFit: "contain",
                  transform: active ? "translateY(-2px)" : "translateY(0)",
                  transition: "transform 160ms ease, filter 160ms ease",
                  filter: active
                    ? "saturate(1.12) brightness(1.05)"
                    : "saturate(0.96) brightness(0.96)",
                }}
              />
              <span
                style={{
                  display: "block",
                  color: active ? "var(--orange)" : "var(--muted)",
                  textShadow: active ? "0 0 16px rgba(240,96,48,0.30)" : "none",
                }}
              >
                {category.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlaceCategoryGrid({
  selected,
  onChange,
}: {
  selected: PlaceCategoryId;
  onChange: (category: PlaceCategoryId) => void;
}) {
  return (
    <ImageCategoryGrid
      ariaLabel="places categories"
      categories={PLACE_CATEGORIES}
      selected={selected}
      onChange={onChange}
      imagePathFor={placeCategoryImagePath}
    />
  );
}

function DishCategoryGrid({
  selected,
  onChange,
}: {
  selected: DishClusterId;
  onChange: (category: DishClusterId) => void;
}) {
  return (
    <ImageCategoryGrid
      ariaLabel="dish categories"
      categories={DISH_CATEGORIES}
      selected={selected}
      onChange={onChange}
      imagePathFor={dishCategoryImagePath}
      imageSize="clamp(72px, 20vw, 82px)"
    />
  );
}

function PlaceTagBadge({ category, featured }: { category: PlaceCategoryId; featured: boolean }) {
  const label = placeCategoryLabel(category);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 28,
        maxWidth: "100%",
        color: featured ? "white" : "var(--cream)",
        background: featured
          ? "linear-gradient(135deg, rgba(240,96,48,0.88), rgba(18,14,10,0.92))"
          : "rgba(255,255,255,0.045)",
        border: featured ? "1px solid rgba(255,255,255,0.20)" : "1px solid var(--border)",
        borderRadius: 999,
        padding: "3px 9px 3px 3px",
        fontSize: 10,
        fontWeight: 850,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <PlaceCategoryImage category={category} size={22} />
      {label}
    </span>
  );
}

function topRestaurantsFromFeed(feed: Review[], location: UserLocation | null): RestaurantSpotlight[] {
  const restaurants = new Map<string, {
    reviewers: Set<string>;
    ratingTotal: number;
    ratingCount: number;
    topDish: string;
    topDishRating: number;
    dishCounts: Map<string, number>;
    areaCounts: Map<string, number>;
    photo: string | null;
    lat: number | null;
    lng: number | null;
    latest: number;
  }>();

  for (const review of feed) {
    const photo = reviewMediaItems(review).find((item) => item.media_type === "image")?.public_url ?? null;
    const existing = restaurants.get(review.restaurant_name) ?? {
      reviewers: new Set<string>(),
      ratingTotal: 0,
      ratingCount: 0,
      topDish: "",
      topDishRating: 0,
      dishCounts: new Map<string, number>(),
      areaCounts: new Map<string, number>(),
      photo: null,
      lat: null,
      lng: null,
      latest: 0,
    };
    const ts = new Date(review.created_at).getTime();
    existing.reviewers.add(review.reviewer_name);
    existing.latest = Math.max(existing.latest, ts);
    if (!existing.photo && photo) existing.photo = photo;
    if (review.area) existing.areaCounts.set(review.area, (existing.areaCounts.get(review.area) ?? 0) + 1);
    if (existing.lat == null && typeof review.restaurant_lat === "number") existing.lat = review.restaurant_lat;
    if (existing.lng == null && typeof review.restaurant_lng === "number") existing.lng = review.restaurant_lng;

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
      const distanceKm =
        location && data.lat != null && data.lng != null
          ? Math.round(distanceKmBetween(location, data.lat, data.lng) * 10) / 10
          : null;
      const categoryIds = inferPlaceCategories({ name, area, topDishes });
      return {
        name,
        reviewers: Array.from(data.reviewers),
        reviewerCount: data.reviewers.size,
        averageRating,
        topDish: data.topDish,
        topDishes,
        tags: categoryIds.filter((id) => id !== "all").slice(0, 3),
        area,
        photo: data.photo,
        distanceKm,
        score: data.reviewers.size * 100 + averageRating + data.latest / 1_000_000_000_000,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...restaurant }) => restaurant);
}

function bestDishesFromFeed(feed: Review[], location: UserLocation | null): DishSpotlight[] {
  const dishes = new Map<string, {
    name: string;
    ratingTotal: number;
    ratingCount: number;
    bestRating: number;
    reviewers: Set<string>;
    restaurantCounts: Map<string, number>;
    restaurantBestRatings: Map<string, number>;
    restaurantDistances: Map<string, number | null>;
    photo: string | null;
    topReviewSnippet: string | null;
    latest: number;
  }>();

  for (const review of feed) {
    const latest = new Date(review.created_at).getTime();
    const photo = reviewMediaItems(review).find((item) => item.media_type === "image")?.public_url ?? null;
    for (const item of review.items ?? []) {
      const dishName = item.name.trim();
      if (!dishName) continue;
      const key = dishName.toLowerCase();
      const existing = dishes.get(key) ?? {
        name: dishName,
        ratingTotal: 0,
        ratingCount: 0,
        bestRating: 0,
        reviewers: new Set<string>(),
        restaurantCounts: new Map<string, number>(),
        restaurantBestRatings: new Map<string, number>(),
        restaurantDistances: new Map<string, number | null>(),
        photo: null,
        topReviewSnippet: null,
        latest: 0,
      };

      existing.ratingTotal += item.rating;
      existing.ratingCount += 1;
      existing.bestRating = Math.max(existing.bestRating, item.rating);
      existing.reviewers.add(review.reviewer_name);
      existing.latest = Math.max(existing.latest, latest);
      if (!existing.photo && photo) existing.photo = photo;
      if (!existing.topReviewSnippet && review.body) existing.topReviewSnippet = review.body;
      existing.restaurantCounts.set(
        review.restaurant_name,
        (existing.restaurantCounts.get(review.restaurant_name) ?? 0) + 1
      );
      existing.restaurantBestRatings.set(
        review.restaurant_name,
        Math.max(existing.restaurantBestRatings.get(review.restaurant_name) ?? 0, item.rating)
      );
      existing.restaurantDistances.set(
        review.restaurant_name,
        typeof review.restaurant_lat === "number" && typeof review.restaurant_lng === "number" && location
          ? Math.round(distanceKmBetween(location, review.restaurant_lat, review.restaurant_lng) * 10) / 10
          : null
      );
      dishes.set(key, existing);
    }
  }

  return Array.from(dishes.entries())
    .map(([key, data]) => {
      const restaurants = Array.from(data.restaurantCounts.entries())
        .sort((a, b) => {
          const countDiff = b[1] - a[1];
          if (countDiff !== 0) return countDiff;
          return (data.restaurantBestRatings.get(b[0]) ?? 0) - (data.restaurantBestRatings.get(a[0]) ?? 0);
        })
        .map(([restaurant]) => restaurant);
      const averageRating = data.ratingCount > 0 ? data.ratingTotal / data.ratingCount : 0;
      const topRestaurantName = restaurants[0] ?? "";
      const categoryIds = inferDishClusters({ name: data.name });
      return {
        key,
        name: data.name,
        averageRating,
        bestRating: data.bestRating,
        mentionCount: data.ratingCount,
        reviewerCount: data.reviewers.size,
        topRestaurantName,
        restaurants: restaurants.slice(0, 3),
        tags: tagsFromIds(categoryIds, dishCategoryLabel),
        photo: data.photo,
        topReviewSnippet: data.topReviewSnippet,
        distanceKm: data.restaurantDistances.get(topRestaurantName) ?? null,
        score: averageRating * 100 + data.reviewers.size * 10 + data.ratingCount + data.latest / 1_000_000_000_000,
      };
    })
    .filter((dish) => dish.topRestaurantName)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(({ score: _score, ...dish }) => dish);
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
    <div style={{ padding: "10px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
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

function ExploreTabs({ activeTab, onChange }: { activeTab: ExploreTab; onChange: (tab: ExploreTab) => void }) {
  const tabs: Array<{ id: ExploreTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "restaurants", label: "Places" },
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

function RestaurantList({
  restaurants,
  loading,
  profileMap,
  selectedCategory,
  circleMembers,
}: {
  restaurants: RestaurantSpotlight[];
  loading: boolean;
  profileMap: Record<string, string>;
  selectedCategory: PlaceCategoryId;
  circleMembers: Set<string>;
}) {
  const visibleRestaurants = restaurants;
  const emptyLabel = placeCategoryLabel(selectedCategory).toLowerCase();

  function displayPersonName(username: string): string {
    const displayName = profileMap[username] || username;
    return displayName.split(/\s+/).filter(Boolean)[0] || displayName;
  }

  function socialProof(reviewers: string[]): string {
    if (reviewers.length === 0) return "";
    const sorted = [...reviewers].sort((a, b) =>
      (circleMembers.has(b) ? 1 : 0) - (circleMembers.has(a) ? 1 : 0)
    );
    const first = displayPersonName(sorted[0]);
    if (sorted.length === 1) return `${first} has been here`;
    const others = sorted.length - 1;
    return `${first} + ${others} other${others === 1 ? "" : "s"} have been here`;
  }

  return (
    <div style={{ paddingBottom: "100px" }}>
      <DiscoveryHeader title="Top places near you" Icon={Store} />
      <div style={{ padding: "0 16px" }}>
        {loading && visibleRestaurants.length === 0 ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 148, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 10, opacity: 0.5 }} />
          ))
        ) : visibleRestaurants.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>
              {selectedCategory === "all" ? "No places yet" : `No ${emptyLabel} places nearby`}
            </p>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Public posts will shape this list.</p>
          </div>
        ) : (
          visibleRestaurants.map((restaurant) => (
              <Link
                key={restaurant.name}
                href={`/trending/${encodeURIComponent(restaurant.name)}`}
                style={{
                  textDecoration: "none",
                  display: "grid",
                  gridTemplateColumns: "88px 1fr",
                  minHeight: 146,
                  color: "inherit",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  overflow: "hidden",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    background: restaurant.photo ? undefined : "linear-gradient(135deg, rgba(240,96,48,0.18), rgba(232,168,48,0.10))",
                    backgroundImage: restaurant.photo ? `url(${restaurant.photo})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    minHeight: 146,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {!restaurant.photo && <Store size={24} strokeWidth={2.1} color="var(--orange)" />}
                </div>
                <div style={{ padding: 14, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700, color: "var(--cream)", lineHeight: 1.2 }}>{restaurant.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                        {formatDistance(restaurant.distanceKm, restaurant.area)}
                      </div>
                    </div>
                    <RatingScore rating={restaurant.averageRating} />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{restaurant.reviewerCount} visit{restaurant.reviewerCount !== 1 ? "s" : ""}</span>
                  </div>

                  {restaurant.topDishes.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: restaurant.tags.length ? 8 : 0 }}>
                      {restaurant.topDishes.slice(0, RESTAURANT_CARD_DISH_LIMIT).map((dish) => (
                        <span key={dish} style={{ fontSize: 10, color: "var(--cream)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 8px" }}>
                          {dish}
                        </span>
                      ))}
                    </div>
                  )}

                  {restaurant.tags.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {restaurant.tags.map((tag) => (
                        <PlaceTagBadge key={tag} category={tag} featured />
                      ))}
                    </div>
                  )}

                  {restaurant.reviewers.length > 0 && (
                    <div style={{ marginTop: 11, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
                      <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
                        {socialProof(restaurant.reviewers)}
                      </p>
                    </div>
                  )}
                </div>
              </Link>
          ))
        )}
      </div>
    </div>
  );
}

function DishList({
  dishes,
  loading,
  selectedCategory,
}: {
  dishes: DishSpotlight[];
  loading: boolean;
  selectedCategory: DishClusterId;
}) {
  const visibleDishes = dishes;
  const emptyLabel = dishCategoryLabel(selectedCategory).toLowerCase();

  return (
    <div style={{ paddingBottom: "100px" }}>
      <DiscoveryHeader title="Top dishes near you" Icon={Utensils} />
      <div style={{ padding: "0 16px" }}>
        {loading && visibleDishes.length === 0 ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 148, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 10, opacity: 0.5 }} />
          ))
        ) : visibleDishes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>
              {selectedCategory === "all" ? "No dishes yet" : `No ${emptyLabel} spots found`}
            </p>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Public posts with dish ratings will shape this list.</p>
          </div>
        ) : (
          visibleDishes.map((dish) => (
              <Link
                key={dish.key}
                href={`/trending/${encodeURIComponent(dish.topRestaurantName)}`}
                style={{
                  textDecoration: "none",
                  display: "grid",
                  gridTemplateColumns: "88px 1fr",
                  minHeight: 146,
                  color: "inherit",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  overflow: "hidden",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    background: dish.photo ? undefined : "linear-gradient(135deg, rgba(61,214,140,0.18), rgba(232,168,48,0.10))",
                    backgroundImage: dish.photo ? `url(${dish.photo})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    minHeight: 146,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {!dish.photo && <Utensils size={24} strokeWidth={2.1} color="var(--green)" />}
                </div>
                <div style={{ padding: 14, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700, color: "var(--cream)", lineHeight: 1.2 }}>{dish.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                        {dish.topRestaurantName} · {formatDistance(dish.distanceKm, null)}
                      </div>
                    </div>
                    <RatingScore rating={dish.averageRating} />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {dish.mentionCount} review{dish.mentionCount !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {dish.tags.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: dish.topReviewSnippet ? 9 : 0 }}>
                      {dish.tags.map((tag) => (
                        <span key={tag} style={{ fontSize: 10, color: "var(--green)", background: "rgba(61,214,140,0.11)", borderRadius: 999, padding: "3px 8px", fontWeight: 800 }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {dish.topReviewSnippet && (
                    <p style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45, margin: 0 }}>
                      {dish.topReviewSnippet.length > 92 ? `${dish.topReviewSnippet.slice(0, 89)}...` : dish.topReviewSnippet}
                    </p>
                  )}
                </div>
              </Link>
          ))
        )}
      </div>
    </div>
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
  return (
    <section style={{ margin: "4px 0 18px" }}>
      <DiscoveryHeader title="People to discover" Icon={Users} />
      {people.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "28px 24px", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}>
          No more people to discover right now.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {people.map((person) => (
            <PersonCard
              key={person.name}
              name={person.name}
              displayName={person.displayName}
              sub={`${toHandle(person.name)} · ${person.totalPlaces} place${person.totalPlaces !== 1 ? "s" : ""}`}
              status={statusFor(person.name)}
              onInCircleClick={statusFor(person.name) === "one_way" ? () => onInCircleClick(person.name) : undefined}
              onAdd={() => onAdd(person.name)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Main Component ─────────────────────────────── */

export default function PeopleTab({ initialCircle }: { initialCircle: CircleMember[] }) {
  const [initialFeedKey] = useState(() => publicFeedUrl(getStoredActorName(), loadSavedLocation()));
  const [persistedFeed] = useState(() => readFeedState<ExploreFeedSnapshot>(initialFeedKey));
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [peopleResults, setPeopleResults] = useState<PeopleResult[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<RestaurantResult[]>([]);
  const [dishResults, setDishResults] = useState<DishResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [activeTab, setActiveTab] = useState<ExploreTab>(persistedFeed?.activeTab ?? "posts");
  const [placeCategory, setPlaceCategory] = useState<PlaceCategoryId>("all");
  const [dishCategory, setDishCategory] = useState<DishClusterId>("all");
  const [feed, setFeed] = useState<Review[]>(persistedFeed?.reviews ?? []);
  const [feedLikeCountMap, setFeedLikeCountMap] = useState<Record<string, number>>(persistedFeed?.likeCountMap ?? {});
  const [feedCommentMap, setFeedCommentMap] = useState<Record<string, { count: number; top: Comment }>>(persistedFeed?.commentMap ?? {});
  const [feedLikedMap, setFeedLikedMap] = useState<Record<string, boolean>>(persistedFeed?.likedByMeMap ?? {});
  const [feedBookmarkedMap, setFeedBookmarkedMap] = useState<Record<string, boolean>>(persistedFeed?.bookmarkedPostMap ?? {});
  const [feedProfileMap, setFeedProfileMap] = useState<Record<string, string>>(persistedFeed?.profileMap ?? {});
  const [feedLoading, setFeedLoading] = useState(!persistedFeed);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(persistedFeed?.hasMore ?? true);
  const [feedNextCursor, setFeedNextCursor] = useState<CircleFeedCursor | null>(persistedFeed?.nextCursor ?? null);
  const [feedError, setFeedError] = useState("");
  const [feedStateKey, setFeedStateKey] = useState(initialFeedKey);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const feedLocationRef = useRef<UserLocation | null>(null);

  const [myName, setMyName] = useState("");
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [locationLabel, setLocationLabel] = useState("Set location");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [dropdownTop, setDropdownTop] = useState(0);
  const locationWrapperRef = useRef<HTMLDivElement>(null);
  const [circleMembers, setCircleMembers] = useState<Set<string>>(new Set());
  const [pendingSent, setPendingSent] = useState<Set<string>>(new Set());
  const [pendingIncoming, setPendingIncoming] = useState<string[]>([]);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [confirmCancelName, setConfirmCancelName] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmLeaveName, setConfirmLeaveName] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "places" || tab === "restaurants") setActiveTab("restaurants");
    else if (tab === "dishes") setActiveTab("dishes");
    else if (tab === "people") setActiveTab("people");
    else if (tab === "posts") setActiveTab("posts");

    setPlaceCategory(parsePlaceCategory(params.get("placeCategory") ?? (tab === "places" || tab === "restaurants" ? params.get("category") : null)));
    setDishCategory(parseDishCategory(params.get("dishCategory") ?? (tab === "dishes" ? params.get("category") : null)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", activeTab === "restaurants" ? "places" : activeTab);
    if (activeTab === "restaurants") {
      if (placeCategory === "all") params.delete("category");
      else params.set("category", placeCategory);
      params.delete("placeCategory");
      params.delete("dishCategory");
    } else if (activeTab === "dishes") {
      if (dishCategory === "all") params.delete("category");
      else params.set("category", dishCategory);
      params.delete("placeCategory");
      params.delete("dishCategory");
    } else {
      params.delete("category");
      params.delete("placeCategory");
      params.delete("dishCategory");
    }

    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [activeTab, dishCategory, placeCategory]);

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

  useEffect(() => {
    function readLocationLabel() {
      try {
        const savedLocation = loadSavedLocation();
        setLocation(savedLocation);
        setLocationLabel(savedLocation ? shortLocationLabel(savedLocation.label) : "Set location");
      } catch {
        setLocation(null);
        setLocationLabel("Set location");
      }
    }

    readLocationLabel();
    window.addEventListener("storage", readLocationLabel);
    return () => window.removeEventListener("storage", readLocationLabel);
  }, []);

  /* ── Load discovery feed ── */

  const loadFeedPage = useCallback(async (cursor: CircleFeedCursor | null = null, viewerName = myName, loc?: UserLocation | null) => {
    const requestedLocation = loc === undefined ? (cursor ? feedLocationRef.current : location) : loc;
    if (!cursor) {
      setFeedLoading(true);
      setFeedError("");
    }
    else setFeedLoadingMore(true);
    try {
      const applyFeedData = (data: PublicFeedResponse, pageCursor: CircleFeedCursor | null) => {
        const rows = data.reviews ?? [];
        setFeed((current) => {
          if (!pageCursor) return rows;
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...rows.filter((item) => !seen.has(item.id))];
        });
        setFeedLikeCountMap((current) => pageCursor ? { ...current, ...(data.likeCountMap ?? {}) } : (data.likeCountMap ?? {}));
        setFeedCommentMap((current) => pageCursor ? { ...current, ...(data.commentMap ?? {}) } : (data.commentMap ?? {}));
        setFeedLikedMap((current) => pageCursor ? { ...current, ...(data.likedByMeMap ?? {}) } : (data.likedByMeMap ?? {}));
        setFeedBookmarkedMap((current) => pageCursor ? { ...current, ...(data.bookmarkedPostMap ?? {}) } : (data.bookmarkedPostMap ?? {}));
        setFeedProfileMap((current) => pageCursor ? { ...current, ...(data.profileMap ?? {}) } : (data.profileMap ?? {}));
        setFeedHasMore(Boolean(data.hasMore));
        setFeedNextCursor(data.nextCursor ?? null);
      };

      const fetchPage = async (feedLocation: UserLocation | null) => {
        const url = publicFeedUrl(viewerName, feedLocation, cursor);
        if (!cursor) {
          const cached = readCachedJson<PublicFeedResponse>(url, { allowStale: true });
          if (cached) {
            applyFeedData(cached, null);
            setFeedLoading(false);
          }
          const data = await refreshCachedJson<PublicFeedResponse>(url, FEED_TTL_MS);
          if (data.error) throw new Error(data.error);
          return data;
        }
        const response = await fetch(url, { cache: "no-store" });
        const data = await response.json() as PublicFeedResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error || "Unable to load public posts");
        return data;
      };

      let data = await fetchPage(requestedLocation ?? null);
      let feedLocation = requestedLocation ?? null;
      if (!cursor && requestedLocation && (data.reviews ?? []).length === 0) {
        data = await fetchPage(null);
        feedLocation = null;
      }
      if (!cursor) feedLocationRef.current = feedLocation;
      if (!cursor) setFeedStateKey(publicFeedUrl(viewerName, feedLocation));
      applyFeedData(data, cursor);
    } catch {
      setFeedError("Could not load public posts. Please try again.");
    } finally {
      if (!cursor) setFeedLoading(false);
      else setFeedLoadingMore(false);
    }
  }, [location, myName]);

  useEffect(() => {
    if (feedLoading && feed.length === 0) return;
    writeFeedState<ExploreFeedSnapshot>(feedStateKey, {
      reviews: feed.slice(0, MAX_PERSISTED_FEED_POSTS),
      likeCountMap: feedLikeCountMap,
      commentMap: feedCommentMap,
      likedByMeMap: feedLikedMap,
      bookmarkedPostMap: feedBookmarkedMap,
      profileMap: feedProfileMap,
      hasMore: feedHasMore,
      nextCursor: feedNextCursor,
      activeTab,
      locationLabel: feedLocationRef.current?.label ?? null,
    }, FEED_STATE_TTL_MS);
  }, [
    activeTab,
    feed,
    feedBookmarkedMap,
    feedCommentMap,
    feedHasMore,
    feedLikedMap,
    feedLoading,
    feedLikeCountMap,
    feedNextCursor,
    feedProfileMap,
    feedStateKey,
  ]);

  useEffect(() => {
    const me = getStoredActorName();
    const savedLocation = loadSavedLocation();
    setLocation(savedLocation);
    setLocationLabel(savedLocation ? shortLocationLabel(savedLocation.label) : "Set location");
    loadFeedPage(null, me, savedLocation);
    // Initial feed load only; location changes are handled by the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const bounds = location ? locationBounds(location) : null;
    let dishQuery = supabase
      .from("reviews")
      .select("items, restaurant_lat, restaurant_lng")
      .eq("visibility", "public")
      .eq("status", "active")
      .limit(500);

    if (bounds) {
      dishQuery = dishQuery
        .gte("restaurant_lat", bounds.minLat)
        .lte("restaurant_lat", bounds.maxLat)
        .gte("restaurant_lng", bounds.minLng)
        .lte("restaurant_lng", bounds.maxLng);
    }

    const [
      { data: reviewerData },
      { data: profileData },
      { data: dishData },
      restaurantsResponse,
    ] = await Promise.all([
      supabase.from("reviews").select("reviewer_name, restaurant_name").eq("visibility", "public").ilike("reviewer_name", `%${trimmed}%`).returns<{ reviewer_name: string; restaurant_name: string }[]>(),
      supabase.from("profiles").select("username, first_name, last_name").or(`username.ilike.%${trimmed}%,first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%`).returns<ProfileSearchRow[]>(),
      dishQuery.returns<{ items: Array<{ name: string; rating: number }> }[]>(),
      fetch(`/api/places/autocomplete?${new URLSearchParams({
        input: trimmed,
        ...(location ? { lat: String(location.lat), lng: String(location.lng) } : {}),
      }).toString()}`, { cache: "no-store" })
        .then((res) => res.json() as Promise<{ suggestions?: RestaurantResult[] }>)
        .catch(() => ({ suggestions: [] as RestaurantResult[] })),
    ]);

    // People
    const displayNameByUsername = new Map<string, string>();
    for (const p of profileData ?? []) {
      if (p.username) displayNameByUsername.set(p.username, profileDisplayName(p, p.username));
    }
    const peopleMap = new Map<string, number>();
    for (const r of reviewerData ?? []) {
      if (r.reviewer_name) peopleMap.set(r.reviewer_name, (peopleMap.get(r.reviewer_name) ?? 0) + (r.restaurant_name ? 1 : 0));
    }
    for (const p of profileData ?? []) {
      if (p.username && !peopleMap.has(p.username)) peopleMap.set(p.username, 0);
    }
    setPeopleResults(
      Array.from(peopleMap.entries())
        .filter(([name]) => name !== myName)
        .map(([name, totalPlaces]) => ({ name, displayName: displayNameByUsername.get(name) || name, totalPlaces }))
    );

    // Places
    setRestaurantResults((restaurantsResponse.suggestions ?? []).slice(0, 5));

    // Dishes
    const canonicalByName = new Map(CANONICAL_DISHES.map((dish) => [dish.displayName, 0]));
    const canonicalQuery = normalizeDishDisplayName(trimmed);
    if (canonicalQuery && canonicalQuery !== trimmed) canonicalByName.set(canonicalQuery, 0);

    for (const r of dishData ?? []) {
      for (const item of (r.items as Array<{ name: string; rating: number }> ?? [])) {
        const canonical = normalizeDishDisplayName(item.name);
        if (dishSearchMatches(canonical, trimmed) || canonical.toLowerCase().includes(trimmed.toLowerCase())) {
          canonicalByName.set(canonical, (canonicalByName.get(canonical) ?? 0) + 1);
        }
      }
    }
    setDishResults(
      Array.from(canonicalByName.entries())
        .filter(([name, count]) => count > 0 || dishSearchMatches(name, trimmed) || name.toLowerCase().includes(trimmed.toLowerCase()))
        .map(([canonicalName, mentionCount]) => ({ canonicalName, mentionCount }))
        .sort((a, b) => b.mentionCount - a.mentionCount || a.canonicalName.localeCompare(b.canonicalName))
        .slice(0, 5)
    );
    setHasSearched(true);
    setSearching(false);
  }, [location, myName]);

  useEffect(() => {
    const t = setTimeout(() => search(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery, search]);

  /* ── Derived ── */

  function personStatus(name: string): PersonStatus {
    return personStatusFor(name, { circleMembers, pendingSent });
  }

  const isSearching = searchQuery.trim() !== "";
  const topRestaurants = useMemo(() => topRestaurantsFromFeed(feed, location), [feed, location]);
  const filteredRestaurants = useMemo(
    () => topRestaurants.filter((restaurant) => placeMatchesCategory(restaurant, placeCategory)),
    [placeCategory, topRestaurants]
  );
  const bestDishes = useMemo(() => bestDishesFromFeed(feed, location), [feed, location]);
  const filteredDishes = useMemo(
    () => bestDishes.filter((dish) => dishMatchesCategory(dish, dishCategory)),
    [bestDishes, dishCategory]
  );
  const discoverablePeople = useMemo(
    () => initialCircle
      .filter((person) => person.name !== myName)
      .filter((person) => !circleMembers.has(person.name))
      .filter((person) => !pendingIncoming.includes(person.name)),
    [circleMembers, initialCircle, myName, pendingIncoming]
  );

  function handlePeopleAction(name: string) {
    if (personStatus(name) === "sent") setConfirmCancelName(name);
    else sendRequest(name);
  }

  function handleLocationSelect(nextLocation: UserLocation) {
    setLocation(nextLocation);
    setLocationLabel(shortLocationLabel(nextLocation.label));
    saveLocation(nextLocation);
    setShowLocationPicker(false);
    loadFeedPage(null, myName, nextLocation);
  }

  function dishHref(dishName: string): string {
    const params = new URLSearchParams();
    if (location) {
      params.set("lat", String(location.lat));
      params.set("lng", String(location.lng));
    }
    const query = params.toString();
    return `/dishes/${encodeURIComponent(dishName)}${query ? `?${query}` : ""}`;
  }

  function restaurantHref(restaurant: RestaurantResult): string {
    const params = new URLSearchParams();
    if (restaurant.mainText) params.set("name", restaurant.mainText);
    if (restaurant.secondaryText) params.set("address", restaurant.secondaryText);
    const query = params.toString();
    return `/restaurants/${encodeURIComponent(restaurant.placeId)}${query ? `?${query}` : ""}`;
  }

  /* ── Render ── */

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "22px 16px 8px" }}>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", lineHeight: 1.15, color: "var(--cream)", margin: 0 }}>
          Explore
        </h1>
        <div ref={locationWrapperRef} style={{ position: "relative", minWidth: 0, maxWidth: "52%" }}>
          <button
            type="button"
            onClick={() => {
              if (!showLocationPicker && locationWrapperRef.current) {
                setDropdownTop(locationWrapperRef.current.getBoundingClientRect().bottom + 8);
              }
              setShowLocationPicker(v => !v);
            }}
            aria-label="Location"
            style={{
              width: "100%",
              padding: "9px 0",
              background: "transparent",
              border: "none",
              color: "var(--cream)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "13px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>🧭</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {locationLabel}
            </span>
            <ChevronDown size={14} strokeWidth={2.2} color="var(--muted)" style={{ flexShrink: 0 }} />
          </button>
          {showLocationPicker && (
            <LocationPickerSheet
              currentLocation={location}
              onClose={() => setShowLocationPicker(false)}
              onSelect={handleLocationSelect}
              anchorBottom={dropdownTop}
            />
          )}
        </div>
      </div>

      {/* Search bar */}
      <div style={{ padding: "8px 16px 12px" }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Search size={17} strokeWidth={2.2} color="var(--muted)" style={{ flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search people, dishes or places..."
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

              {/* Places */}
              {restaurantResults.length > 0 && (
                <>
                  {peopleResults.length > 0 && <div style={{ height: "8px" }} />}
                  <SectionLabel>Places</SectionLabel>
	                  {restaurantResults.map((r) => (
	                    <Link key={r.placeId} href={restaurantHref(r)} style={{ textDecoration: "none", display: "block", margin: "0 16px 10px" }}>
	                      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
	                        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
	                          <Store size={19} strokeWidth={2.1} color="var(--orange)" />
	                        </div>
	                        <div style={{ flex: 1, minWidth: 0 }}>
	                          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
	                            {r.mainText}
	                          </p>
	                          {r.secondaryText && (
	                            <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
	                              {r.secondaryText}
	                            </p>
	                          )}
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
	                    <Link key={d.canonicalName} href={dishHref(d.canonicalName)} style={{ textDecoration: "none", display: "block", margin: "0 16px 10px" }}>
	                      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
	                        <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
	                          <Utensils size={19} strokeWidth={2.1} color="var(--green)" />
	                        </div>
	                        <div style={{ flex: 1, minWidth: 0 }}>
	                          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
	                            {d.canonicalName}
	                          </p>
	                          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
	                            Find top restaurants nearby
	                          </p>
	                        </div>
	                        {d.mentionCount > 0 && (
	                          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
	                            {d.mentionCount}
	                          </span>
	                        )}
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
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              background: "var(--bg)",
            }}
          >
            <ExploreTabs activeTab={activeTab} onChange={setActiveTab} />
          </div>

          {activeTab === "restaurants" && (
            <PlaceCategoryGrid selected={placeCategory} onChange={setPlaceCategory} />
          )}
          {activeTab === "dishes" && (
            <DishCategoryGrid selected={dishCategory} onChange={setDishCategory} />
          )}
          {(activeTab === "restaurants" || activeTab === "dishes") && (
            <div style={{ height: 1, background: "var(--border)", margin: "0 16px" }} />
          )}

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

              {!feedLoading && feed.length === 0 && (
                <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "48px 24px", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}>
                  No public posts yet.<br />Be the first to share one.
                </p>
              )}

              {feed.map((review, index) => {
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

              {!feedLoading && !feedHasMore && feed.length > 8 && (
                <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "10px 0 20px", fontFamily: "'DM Sans', sans-serif" }}>
                  You are caught up for now.
                </p>
              )}
            </div>
          )}

          {activeTab === "restaurants" && (
            <RestaurantList
              restaurants={filteredRestaurants}
              loading={feedLoading}
              profileMap={feedProfileMap}
              selectedCategory={placeCategory}
              circleMembers={circleMembers}
            />
          )}

          {activeTab === "dishes" && (
            <DishList
              dishes={filteredDishes}
              loading={feedLoading}
              selectedCategory={dishCategory}
            />
          )}

          {activeTab === "people" && (
            <>
              <PeopleStrip
                people={discoverablePeople}
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
