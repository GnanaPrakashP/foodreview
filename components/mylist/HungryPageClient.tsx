"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { ChevronDown, LocateFixed, Search } from "lucide-react";
import type { Comment, Review } from "@/lib/types";
import type { CircleFeedCursor } from "@/lib/circle-feed";
import { getStoredActorName } from "@/lib/browser-actor";
import { cachedJson, invalidateCachedJson, readCachedJson } from "@/lib/browser-api-cache";
import { readFeedState, writeFeedState } from "@/lib/browser-feed-state";
import { cachedCircleStatus, invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import {
  addName,
  isAcceptedCircleResponse,
  isOneWayCircleResponse,
  personStatusFor,
  removeName,
} from "@/lib/people-circle-state";
import {
  TRENDING_LOCATION_LABEL_COOKIE,
  TRENDING_LOCATION_LABEL_STORAGE_KEY,
  TRENDING_LOCATION_LAT_STORAGE_KEY,
  TRENDING_LOCATION_LNG_STORAGE_KEY,
  normalizeLocationLabel,
} from "@/lib/trending-location";
import SwipeStack from "./SwipeStack";

const SWIPE_PAGE_SIZE = 40;
const SWIPE_TTL_MS = 2 * 60 * 1000;
const SWIPE_STATE_TTL_MS = 30 * 60 * 1000;
const MAX_PERSISTED_POSTS = 120;
const LOCATION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

type UserLocation = { lat: number; lng: number; label: string };
type AutocompleteItem = { placeId: string; text: string; mainText: string; secondaryText: string };

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

type HungryFeedSnapshot = PublicFeedResponse & {
  locationLabel: string | null;
};

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
    if (!isNaN(lat) && !isNaN(lng) && label) return { lat, lng, label };
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
    // Storage can be blocked; the in-memory label still updates for this view.
  }
}

function swipeFeedUrl(viewerName: string, loc: UserLocation | null, cursor: CircleFeedCursor | null = null) {
  const params = new URLSearchParams({ limit: String(SWIPE_PAGE_SIZE), excludeSynthetic: "1" });
  if (viewerName) params.set("viewer", viewerName);
  if (loc) {
    params.set("lat", String(loc.lat));
    params.set("lng", String(loc.lng));
  }
  if (cursor) params.set("cursor", JSON.stringify(cursor));
  return `/api/feed/public?${params.toString()}`;
}

function isDocumentReload() {
  try {
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return navigation?.type === "reload";
  } catch {
    return false;
  }
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
        const label = details.shortFormattedAddress || item.mainText || item.text;
        onSelect({ lat: details.latitude, lng: details.longitude, label });
      }
    } catch {
      // Leave the sheet open so the user can choose another result.
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
      <div style={{ position: "fixed", top: anchorBottom ?? 60, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "32rem", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, zIndex: 61, padding: "14px 16px", boxSizing: "border-box" }}>
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

export default function HungryPageClient() {
  const [initialFeedKey] = useState(() => swipeFeedUrl(getStoredActorName(), loadSavedLocation()));
  const [persistedFeed] = useState(() => isDocumentReload() ? null : readFeedState<HungryFeedSnapshot>(initialFeedKey));
  const [posts, setPosts] = useState<Review[]>(persistedFeed?.reviews ?? []);
  const [loading, setLoading] = useState(!persistedFeed);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(persistedFeed?.hasMore ?? true);
  const [nextCursor, setNextCursor] = useState<CircleFeedCursor | null>(persistedFeed?.nextCursor ?? null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [myName, setMyName] = useState("");
  const [circleMembers, setCircleMembers] = useState<Set<string>>(new Set());
  const [pendingSent, setPendingSent] = useState<Set<string>>(new Set());
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>(persistedFeed?.likeCountMap ?? {});
  const [commentMap, setCommentMap] = useState<Record<string, { count: number; top: Comment }>>(persistedFeed?.commentMap ?? {});
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>(persistedFeed?.likedByMeMap ?? {});
  const [bookmarkedMap, setBookmarkedMap] = useState<Record<string, boolean>>(persistedFeed?.bookmarkedPostMap ?? {});
  const [profileMap, setProfileMap] = useState<Record<string, string>>(persistedFeed?.profileMap ?? {});
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [dropdownTop, setDropdownTop] = useState(0);
  const locationWrapperRef = useRef<HTMLDivElement>(null);
  const firstPageLoadingRef = useRef(false);
  const [feedStateKey, setFeedStateKey] = useState(initialFeedKey);

  const loadPosts = useCallback(async (cursor: CircleFeedCursor | null = null, viewerName = myName, feedLocation = location) => {
    if (cursor ? loadingMore : firstPageLoadingRef.current) return;
    if (cursor && !hasMore) return;

    if (cursor) setLoadingMore(true);
    else {
      firstPageLoadingRef.current = true;
      setLoading(true);
    }

    try {
      const url = swipeFeedUrl(viewerName, feedLocation, cursor);
      const applyData = (data: PublicFeedResponse) => {
        setPosts((current) => {
          if (!cursor) return data.reviews ?? [];
          const seen = new Set(current.map((post) => post.id));
          return [...current, ...(data.reviews ?? []).filter((post) => !seen.has(post.id))];
        });
        setLikeCountMap((current) => cursor ? { ...current, ...(data.likeCountMap ?? {}) } : (data.likeCountMap ?? {}));
        setCommentMap((current) => cursor ? { ...current, ...(data.commentMap ?? {}) } : (data.commentMap ?? {}));
        setLikedMap((current) => cursor ? { ...current, ...(data.likedByMeMap ?? {}) } : (data.likedByMeMap ?? {}));
        setBookmarkedMap((current) => cursor ? { ...current, ...(data.bookmarkedPostMap ?? {}) } : (data.bookmarkedPostMap ?? {}));
        setProfileMap((current) => cursor ? { ...current, ...(data.profileMap ?? {}) } : (data.profileMap ?? {}));
        setHasMore(Boolean(data.hasMore));
        setNextCursor(data.nextCursor ?? null);
      };

      if (!cursor) {
        setFeedStateKey(swipeFeedUrl(viewerName, feedLocation));
        const cached = isDocumentReload() ? null : readCachedJson<PublicFeedResponse>(url);
        if (cached) {
          applyData(cached);
          setLoading(false);
          return;
        }
        const data = await cachedJson<PublicFeedResponse>(url, SWIPE_TTL_MS, { bypassOnReload: true });
        if (data.error) throw new Error(data.error);
        applyData(data);
      } else {
        const response = await fetch(url, { cache: "no-store" });
        const data = await response.json() as PublicFeedResponse;
        if (!response.ok || data.error) throw new Error(data.error || "Unable to load hungry picks");
        applyData(data);
      }
    } catch {
      if (!cursor && posts.length === 0) setPosts([]);
    } finally {
      if (cursor) setLoadingMore(false);
      else {
        firstPageLoadingRef.current = false;
        setLoading(false);
      }
    }
  }, [hasMore, loadingMore, location, myName, posts.length]);

  useEffect(() => {
    const actor = getStoredActorName();
    const savedLocation = loadSavedLocation();
    setMyName(actor);
    setLocation(savedLocation);
    if (persistedFeed && !isDocumentReload()) {
      setFeedStateKey(initialFeedKey);
      setLoading(false);
    } else {
      loadPosts(null, actor, savedLocation);
    }
    if (actor) {
      cachedCircleStatus(actor)
        .then((data) => {
          setCircleMembers(new Set(data.members ?? []));
          setPendingSent(new Set(data.pendingSent ?? []));
        })
        .catch(() => {});
    }
    // Initial fetch only; subsequent pages are pulled by the swipe stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading && posts.length === 0) return;
    writeFeedState<HungryFeedSnapshot>(feedStateKey, {
      reviews: posts.slice(0, MAX_PERSISTED_POSTS),
      likeCountMap,
      commentMap,
      likedByMeMap: likedMap,
      bookmarkedPostMap: bookmarkedMap,
      profileMap,
      hasMore,
      nextCursor,
      locationLabel: location?.label ?? null,
    }, SWIPE_STATE_TTL_MS);
  }, [
    bookmarkedMap,
    commentMap,
    feedStateKey,
    hasMore,
    likedMap,
    likeCountMap,
    loading,
    location,
    nextCursor,
    posts,
    profileMap,
  ]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, []);

  function handleLocationSelect(nextLocation: UserLocation) {
    setLocation(nextLocation);
    saveLocation(nextLocation);
    setShowLocationPicker(false);
    loadPosts(null, myName, nextLocation);
  }

  const loadMoreIfNeeded = useCallback(() => {
    if (!loading && !loadingMore && hasMore && nextCursor) {
      loadPosts(nextCursor);
    }
  }, [hasMore, loadPosts, loading, loadingMore, nextCursor]);

  const savePost = useCallback((post: Review) => {
    setSavedIds((current) => new Set(current).add(post.id));
    fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantName: post.restaurant_name, postId: post.id }),
    }).then((response) => {
      if (!response.ok) {
        setSavedIds((current) => {
          const next = new Set(current);
          next.delete(post.id);
          return next;
        });
      }
    }).catch(() => {
      setSavedIds((current) => {
        const next = new Set(current);
        next.delete(post.id);
        return next;
      });
    });
  }, []);

  function requestStatusFor(name: string) {
    const status = personStatusFor(name, { circleMembers, pendingSent });
    return status === "one_way" ? "joined" : status === "sent" ? "pending" : "idle";
  }

  async function requestPostAuthor(receiverName: string) {
    if (!myName || myName === receiverName || personStatusFor(receiverName, { circleMembers, pendingSent }) !== "none") return;
    setPendingSent((prev) => addName(prev, receiverName));
    const res = await fetch("/api/circle/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: myName, receiverName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPendingSent((prev) => removeName(prev, receiverName));
      return;
    }
    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(receiverName);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");
    if (isAcceptedCircleResponse(data) || isOneWayCircleResponse(data)) {
      setPendingSent((prev) => removeName(prev, receiverName));
      setCircleMembers((prev) => addName(prev, receiverName));
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "32rem", background: "var(--bg)", overflow: "hidden", boxSizing: "border-box", paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 0", flexShrink: 0 }}>
        <div ref={locationWrapperRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <button
            onClick={() => {
              if (!showLocationPicker && locationWrapperRef.current) {
                setDropdownTop(locationWrapperRef.current.getBoundingClientRect().bottom + 8);
              }
              setShowLocationPicker(v => !v);
            }}
            style={{ width: "100%", background: "transparent", border: "none", padding: "9px 0", display: "flex", alignItems: "center", gap: 8, color: "var(--cream)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>🧭</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 }}>
              {location ? shortLocationLabel(location.label) : "Set location"}
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
        <div
          aria-label="Bucket"
          style={{ position: "relative", minWidth: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--cream)" }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>🥡</span>
          {savedIds.size > 0 && (
            <span style={{ position: "absolute", top: -3, right: -5, minWidth: 17, height: 17, padding: "0 5px", borderRadius: 999, background: "var(--orange)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 800, border: "2px solid var(--bg)" }}>
              {savedIds.size}
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <SwipeStack
          posts={posts}
          loading={loading || loadingMore}
          onSavePost={savePost}
          onNeedMore={loadMoreIfNeeded}
          likeCountMap={likeCountMap}
          commentMap={commentMap}
          likedMap={likedMap}
          bookmarkedMap={bookmarkedMap}
          profileMap={profileMap}
          myName={myName}
          requestStatusFor={requestStatusFor}
          onRequestPostAuthor={requestPostAuthor}
        />
      </div>

    </div>
  );
}
