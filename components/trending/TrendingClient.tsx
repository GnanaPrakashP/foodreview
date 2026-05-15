"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import type { TrendingRestaurant, TrendingWindow, CircleReviewItem, TrendingPeopleCounts } from "@/lib/trending";
import { avatarGradient, avatarInitials } from "@/lib/profile";
import {
  locationBucketFromCoords,
  normalizeLocationLabel,
  parseLocationBucket,
  TRENDING_LOCATION_LABEL_COOKIE,
  TRENDING_LOCATION_LABEL_STORAGE_KEY,
  TRENDING_LOCATION_LAT_STORAGE_KEY,
  TRENDING_LOCATION_LNG_STORAGE_KEY,
} from "@/lib/trending-location";

// ── Location helpers ────────────────────────────────────────────────────────

const LS_ASKED = "trending_loc_asked";
const LOCATION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

type UserLocation = { lat: number; lng: number; label: string };
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function loadSavedLocation(): UserLocation | null {
  try {
    const lat = parseFloat(localStorage.getItem(TRENDING_LOCATION_LAT_STORAGE_KEY) ?? "");
    const lng = parseFloat(localStorage.getItem(TRENDING_LOCATION_LNG_STORAGE_KEY) ?? "");
    const label = localStorage.getItem(TRENDING_LOCATION_LABEL_STORAGE_KEY) ?? "";
    if (!isNaN(lat) && !isNaN(lng) && label) return { lat, lng, label };
  } catch { /* SSR or blocked */ }
  return null;
}

function saveLocation(loc: UserLocation) {
  try {
    localStorage.setItem(TRENDING_LOCATION_LAT_STORAGE_KEY, String(loc.lat));
    localStorage.setItem(TRENDING_LOCATION_LNG_STORAGE_KEY, String(loc.lng));
    localStorage.setItem(TRENDING_LOCATION_LABEL_STORAGE_KEY, loc.label);
    document.cookie = `${TRENDING_LOCATION_LABEL_COOKIE}=${encodeURIComponent(loc.label)}; Max-Age=${LOCATION_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  } catch { /* blocked */ }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function starRating(avgScore: number): number {
  return Math.round((avgScore / 2) * 10) / 10;
}

// ── Small components ────────────────────────────────────────────────────────

function Stars({ rating, size = 10 }: { rating: number; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 12 12"
          fill={i <= Math.round(rating) ? "#F59E0B" : "none"} stroke="#F59E0B" strokeWidth="1.5">
          <polygon points="6,1 7.5,4.5 11,5 8.5,7.5 9,11 6,9.5 3,11 3.5,7.5 1,5 4.5,4.5" />
        </svg>
      ))}
      <span style={{ fontSize: size, color: "var(--muted)", marginLeft: 3 }}>{rating.toFixed(1)}</span>
    </div>
  );
}

function CircleBadge({ reviews }: { reviews: CircleReviewItem[] }) {
  if (!reviews || reviews.length === 0) return null;
  const shown = reviews.slice(0, 3);
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex" }}>
        {shown.map((r, i) => (
          <div key={i} style={{
            width: 20, height: 20, borderRadius: "50%",
            background: avatarGradient(r.friend_name),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 7, fontWeight: 700, color: "white",
            marginLeft: i > 0 ? -5 : 0, position: "relative", zIndex: shown.length - i,
            border: "1.5px solid var(--bg)",
          }}>{avatarInitials(r.friend_name)}</div>
        ))}
      </div>
      <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 500 }}>
        ✦ {shown.length === 1
          ? `${shown[0].friend_name.split(/[\s_]+/)[0]} visited this`
          : `${reviews.length} from your Circle`}
      </span>
    </div>
  );
}

// ── Location Picker Sheet ────────────────────────────────────────────────────

type AutocompleteItem = { placeId: string; text: string; mainText: string; secondaryText: string };

function LocationPickerSheet({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (loc: UserLocation) => void;
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
    if (!query.trim()) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ input: query.trim(), sessionToken: sessionToken.current });
        const res = await fetch(`/api/places/autocomplete?${params}`);
        const json = await res.json();
        setSuggestions(json.suggestions ?? []);
      } catch { setSuggestions([]); }
      finally { setLoading(false); }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function handleSuggestion(item: AutocompleteItem) {
    try {
      const params = new URLSearchParams({ placeId: item.placeId, sessionToken: sessionToken.current });
      const res = await fetch(`/api/places/details?${params}`);
      const json = await res.json();
      const details = json.details;
      if (details?.latitude != null && details?.longitude != null) {
        const label = item.mainText || item.text;
        onSelect({ lat: details.latitude, lng: details.longitude, label });
      }
    } catch { /* ignore */ }
    sessionToken.current = crypto.randomUUID();
  }

  async function resolveLabel(lat: number, lng: number): Promise<string> {
    try {
      const res = await fetch(`/api/places/reverse-geocode?lat=${lat}&lng=${lng}`);
      const json = await res.json();
      if (json.label) return json.label as string;
    } catch { /* ignore */ }
    return "Current Location";
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }
    setGpsLoading(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try { localStorage.setItem(LS_ASKED, "1"); } catch { /* blocked */ }
        const { latitude: lat, longitude: lng } = pos.coords;
        const label = await resolveLabel(lat, lng);
        setGpsLoading(false);
        onSelect({ lat, lng, label });
      },
      () => {
        setGpsLoading(false);
        setGpsError("Location access was denied. Please allow it in your browser settings.");
      },
      { timeout: 10000 },
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60 }}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 480,
        background: "var(--card)", borderRadius: "20px 20px 0 0",
        zIndex: 61, padding: "16px 20px 32px",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.4)",
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 99, background: "var(--border)", margin: "0 auto 20px" }} />

        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, color: "var(--cream)", marginBottom: 18 }}>
          Set Location
        </div>

        {/* Use current location */}
        <button
          onClick={handleUseCurrentLocation}
          disabled={gpsLoading}
          style={{
            width: "100%", padding: "13px 16px", borderRadius: 12,
            background: "var(--surface)", border: "1px solid var(--border)",
            color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 14,
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
            opacity: gpsLoading ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: 18 }}>📍</span>
          <span style={{ fontWeight: 500 }}>{gpsLoading ? "Getting location…" : "Use my current location"}</span>
        </button>

        {gpsError && (
          <p style={{ fontSize: 12, color: "#F87171", marginTop: 8, textAlign: "center" }}>{gpsError}</p>
        )}

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {/* Search input */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 14px", display: "flex", gap: 9, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 15 }}>⌕</span>
          <input
            autoFocus
            placeholder="Search area or city…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}
          />
          {loading && <span style={{ fontSize: 11, color: "var(--muted)" }}>…</span>}
          {query && !loading && (
            <button onClick={() => { setQuery(""); setSuggestions([]); }} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
          )}
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div style={{ marginTop: 8, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
            {suggestions.map((s, i) => (
              <button
                key={s.placeId}
                onClick={() => handleSuggestion(s)}
                style={{
                  width: "100%", padding: "11px 14px", textAlign: "left", cursor: "pointer",
                  background: "var(--surface)", border: "none",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  display: "flex", flexDirection: "column", gap: 2,
                }}
              >
                <span style={{ fontSize: 13, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{s.mainText}</span>
                {s.secondaryText && <span style={{ fontSize: 11, color: "var(--muted)" }}>{s.secondaryText}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Restaurants tab ─────────────────────────────────────────────────────────

function RestaurantsTab({
  week,
  month,
  alltime,
  circleReviews,
  timeFilter,
  onTimeFilterChange,
}: {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  circleReviews: Record<string, CircleReviewItem[]>;
  timeFilter: TrendingWindow;
  onTimeFilterChange: (timeFilter: TrendingWindow) => void;
}) {
  const [search, setSearch] = useState("");

  const list = timeFilter === "week" ? week : timeFilter === "month" ? month : alltime;

  const filtered = list.filter(
    (r) =>
      search === "" ||
      r.restaurant_name.toLowerCase().includes(search.toLowerCase()) ||
      r.top_dishes.some((d) => d.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div style={{ padding: "14px 20px 10px" }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 14px", display: "flex", gap: 9, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 15 }}>⌕</span>
          <input
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}
            placeholder="Search restaurant or dish…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Time filter pills */}
      <div style={{ padding: "0 20px 14px", display: "flex", gap: 7 }}>
        {(["week", "month", "alltime"] as TrendingWindow[]).map((t) => (
          <button key={t} onClick={() => onTimeFilterChange(t)}
            style={{
              padding: "4px 14px", borderRadius: 99, fontSize: 11, fontWeight: 500, cursor: "pointer",
              background: timeFilter === t ? "#F59E0B" : "transparent",
              border: `1px solid ${timeFilter === t ? "#F59E0B" : "var(--border)"}`,
              color: timeFilter === t ? "#0D0D0D" : "var(--muted)",
              fontFamily: "'DM Sans',sans-serif",
            }}>
            {t === "week" ? "This Week" : t === "month" ? "This Month" : "All Time"}
          </button>
        ))}
      </div>


      <div style={{ padding: "0 20px" }}>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>Nothing matches</p>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Try a different search or filter</p>
          </div>
        ) : (
          filtered.map((r) => {
            const cReviews = circleReviews[r.restaurant_name] ?? [];
            const stars = starRating(r.avg_score);

            return (
              <Link key={r.restaurant_name} href={`/trending/${encodeURIComponent(r.restaurant_name)}`} style={{ textDecoration: "none", display: "block", marginBottom: 10 }}>
              <div
                style={{
                  background: "var(--card)",
                  border: `1px solid ${cReviews.length > 0 ? "#F59E0B22" : "var(--border)"}`,
                  borderRadius: 14, padding: 16, cursor: "pointer",
                }}>

                <div style={{ display: "flex", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <div>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 600, color: "var(--cream)", lineHeight: 1.2 }}>{r.restaurant_name}</div>
                        {r.area && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, }}>{r.area}</div>}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      {r.avg_score > 0 && <Stars rating={stars} size={10} />}
                      {r.avg_score > 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>·</span>}
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{r.users_all_time} visit{r.users_all_time !== 1 ? "s" : ""}</span>
                    </div>


                    {r.top_dishes.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {r.top_dishes.map((t) => (
                          <span key={t} style={{ fontSize: 10, color: "var(--cream)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 7px" }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <CircleBadge reviews={cReviews} />
              </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Circle Picks tab ─────────────────────────────────────────────────────────

function CirclePicksTab({
  week,
  month,
  alltime,
  circleReviews,
  timeFilter,
  onTimeFilterChange,
}: {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  circleReviews: Record<string, CircleReviewItem[]>;
  timeFilter: TrendingWindow;
  onTimeFilterChange: (timeFilter: TrendingWindow) => void;
}) {
  const [search, setSearch] = useState("");

  const list = timeFilter === "week" ? week : timeFilter === "month" ? month : alltime;
  const picks = list.filter((r) =>
    search === "" || r.restaurant_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ padding: "14px 20px 10px" }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 14px", display: "flex", gap: 9, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 15 }}>⌕</span>
          <input
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}
            placeholder="Search restaurant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ padding: "0 20px 14px", display: "flex", gap: 7 }}>
        {(["week", "month", "alltime"] as TrendingWindow[]).map((t) => (
          <button key={t} onClick={() => onTimeFilterChange(t)}
            style={{
              padding: "4px 14px", borderRadius: 99, fontSize: 11, fontWeight: 500, cursor: "pointer",
              background: timeFilter === t ? "#F59E0B" : "transparent",
              border: `1px solid ${timeFilter === t ? "#F59E0B" : "var(--border)"}`,
              color: timeFilter === t ? "#0D0D0D" : "var(--muted)",
              fontFamily: "'DM Sans',sans-serif",
            }}>
            {t === "week" ? "This Week" : t === "month" ? "This Month" : "All Time"}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 20px" }}>
        {picks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>No circle picks</p>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Try a different time range or add more friends.</p>
          </div>
        ) : picks.map((r) => {
          const cReviews = circleReviews[r.restaurant_name] ?? [];
          const stars = starRating(r.avg_score);
          return (
            <Link key={r.restaurant_name} href={`/trending/${encodeURIComponent(r.restaurant_name)}?circle=1`} style={{ textDecoration: "none", display: "block", marginBottom: 10 }}>
              <div style={{ background: "var(--card)", border: "1px solid #F59E0B22", borderRadius: 14, padding: 16, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 600, color: "var(--cream)", lineHeight: 1.2 }}>{r.restaurant_name}</div>
                      {r.area && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{r.area}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      {r.avg_score > 0 && <Stars rating={stars} size={10} />}
                      {r.avg_score > 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>·</span>}
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{r.users_all_time} visit{r.users_all_time !== 1 ? "s" : ""}</span>
                    </div>
                    {r.top_dishes.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {r.top_dishes.map((t) => (
                          <span key={t} style={{ fontSize: 10, color: "var(--cream)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 7px" }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <CircleBadge reviews={cReviews} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  peopleCounts: TrendingPeopleCounts;
  circleReviews: Record<string, CircleReviewItem[]>;
  circleWeek: TrendingRestaurant[];
  circleMonth: TrendingRestaurant[];
  circleAlltime: TrendingRestaurant[];
  circlePeopleCounts: TrendingPeopleCounts;
  initialLocationBucket?: string;
  initialLocationLabel?: string | null;
  onLocationBucketChange?: (locationBucket: string) => void;
}

function timeLabel(timeFilter: TrendingWindow): string {
  if (timeFilter === "week") return "this week";
  if (timeFilter === "month") return "this month";
  return "all time";
}

function peopleSummary(tab: "restaurants" | "circle", count: number, timeFilter: TrendingWindow): string {
  const people = count === 1 ? "person" : "people";
  if (tab === "circle") return `${count} ${people} from your Circle eating out ${timeLabel(timeFilter)}`;
  return `${count} ${people} eating out ${timeLabel(timeFilter)}`;
}

export default function TrendingClient({
  week,
  month,
  alltime,
  peopleCounts,
  circleReviews,
  circleWeek,
  circleMonth,
  circleAlltime,
  circlePeopleCounts,
  initialLocationBucket,
  initialLocationLabel,
  onLocationBucketChange,
}: Props) {
  const initialParsedLocation = initialLocationLabel ? parseLocationBucket(initialLocationBucket ?? "") : null;
  const [tab, setTab] = useState<"restaurants" | "circle">("restaurants");
  const [timeFilters, setTimeFilters] = useState<Record<"restaurants" | "circle", TrendingWindow>>({
    restaurants: "week",
    circle: "week",
  });
  const [userLocation, setUserLocation] = useState<UserLocation | null>(() => {
    const label = normalizeLocationLabel(initialLocationLabel);
    if (!label || !initialParsedLocation) return null;
    return { ...initialParsedLocation, label };
  });
  const [checkedSavedLocation, setCheckedSavedLocation] = useState(() => Boolean(initialParsedLocation && initialLocationLabel));
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Apply saved location before paint so the location label and location-bucketed
  // list do not briefly disagree on navigation or refresh.
  useIsomorphicLayoutEffect(() => {
    const saved = loadSavedLocation();
    if (saved) {
      setUserLocation(saved);
      saveLocation(saved);
      onLocationBucketChange?.(locationBucketFromCoords(saved.lat, saved.lng));
    }
    setCheckedSavedLocation(true);
  }, [onLocationBucketChange]);

  // Only prompt for GPS after we know there is no saved location.
  useEffect(() => {
    if (loadSavedLocation()) return;

    // First visit — ask browser once
    try {
      const alreadyAsked = localStorage.getItem(LS_ASKED);
      if (!alreadyAsked && navigator.geolocation) {
        localStorage.setItem(LS_ASKED, "1");
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            try {
              const res = await fetch(`/api/places/reverse-geocode?lat=${lat}&lng=${lng}`);
              const json = await res.json();
              const label: string = json.label ?? "Current Location";
              const loc: UserLocation = { lat, lng, label };
              setUserLocation(loc);
              saveLocation(loc);
              onLocationBucketChange?.(locationBucketFromCoords(lat, lng));
            } catch {
              const loc: UserLocation = { lat, lng, label: "Current Location" };
              setUserLocation(loc);
              saveLocation(loc);
              onLocationBucketChange?.(locationBucketFromCoords(lat, lng));
            }
          },
          () => { /* denied — don't ask again */ },
          { timeout: 10000 },
        );
      }
    } catch { /* SSR or blocked */ }
  }, [onLocationBucketChange]);

  function handleLocationSelect(loc: UserLocation) {
    setUserLocation(loc);
    saveLocation(loc);
    setShowLocationPicker(false);
    onLocationBucketChange?.(locationBucketFromCoords(loc.lat, loc.lng));
  }

  const activeTimeFilter = timeFilters[tab];
  const activePeopleCounts = tab === "restaurants" ? peopleCounts : circlePeopleCounts;
  const activePeopleCount = activePeopleCounts[activeTimeFilter];

  function updateTimeFilter(timeFilter: TrendingWindow) {
    setTimeFilters((prev) => ({ ...prev, [tab]: timeFilter }));
  }

  const locationLabel = userLocation
    ? (userLocation.label.length > 18 ? userLocation.label.slice(0, 16) + "…" : userLocation.label)
    : checkedSavedLocation ? "Set location" : "Location";

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", fontFamily: "'DM Sans',sans-serif", color: "var(--cream)" }}>

      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ padding: "18px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 30, fontWeight: 700, color: "var(--cream)", letterSpacing: "-0.5px", lineHeight: 1 }}>Trending</h1>
            {activePeopleCount > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {peopleSummary(tab, activePeopleCount, activeTimeFilter)}
              </div>
            )}
          </div>

          {/* Location button */}
          <button
            onClick={() => setShowLocationPicker(true)}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "6px 11px", borderRadius: 99,
              background: userLocation ? "#F59E0B18" : "var(--surface)",
              border: `1px solid ${userLocation ? "#F59E0B55" : "var(--border)"}`,
              color: userLocation ? "#F59E0B" : "var(--muted)",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
              cursor: "pointer", marginTop: 4, flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13 }}>📍</span>
            <span>{locationLabel}</span>
            <span style={{ fontSize: 12, opacity: 0.7, lineHeight: 1 }}>▾</span>
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", padding: "13px 20px 0" }}>
          {(["restaurants", "circle"] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              style={{
                flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 500, cursor: "pointer",
                color: tab === k ? "#F59E0B" : "var(--muted)",
                background: "none", border: "none",
                borderBottom: `2px solid ${tab === k ? "#F59E0B" : "transparent"}`,
                fontFamily: "'DM Sans',sans-serif",
              }}>
              {k === "restaurants" ? "Restaurants" : "Circle Picks"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ paddingBottom: 100 }}>
        {tab === "restaurants" && (
          <RestaurantsTab
            week={week}
            month={month}
            alltime={alltime}
            circleReviews={circleReviews}
            timeFilter={timeFilters.restaurants}
            onTimeFilterChange={updateTimeFilter}
          />
        )}
        {tab === "circle" && (
          <CirclePicksTab
            week={circleWeek}
            month={circleMonth}
            alltime={circleAlltime}
            circleReviews={circleReviews}
            timeFilter={timeFilters.circle}
            onTimeFilterChange={updateTimeFilter}
          />
        )}
      </div>

      {showLocationPicker && (
        <LocationPickerSheet
          onClose={() => setShowLocationPicker(false)}
          onSelect={handleLocationSelect}
        />
      )}
    </div>
  );
}
