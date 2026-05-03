"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import type { TrendingRestaurant, TrendingWindow } from "@/lib/trending";
import { searchDishes, getPopularDishes, type SlimReview, type DishResult } from "@/lib/dishes";

/* ─── helpers ────────────────────────────────────── */

function restaurantEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("idli") || n.includes("dosa") || n.includes("tiffin") || n.includes("murugan")) return "🥘";
  if (n.includes("biryani") || n.includes("mughal") || n.includes("dum")) return "🍛";
  if (n.includes("ramen") || n.includes("nagi") || n.includes("japanese") || n.includes("sushi")) return "🍜";
  if (n.includes("chinese") || n.includes("noodle")) return "🍜";
  if (n.includes("pizza") || n.includes("italiano") || n.includes("pasta")) return "🍕";
  if (n.includes("burger") || n.includes("grill")) return "🍔";
  if (n.includes("shawarma") || n.includes("arabic")) return "🥙";
  if (n.includes("cafe") || n.includes("coffee")) return "☕";
  if (n.includes("mess") || n.includes("madurai") || n.includes("mutton") || n.includes("chicken")) return "🍖";
  return "🍽️";
}

/* ─── shared pill ────────────────────────────────── */

function Pill({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: "gold" | "orange";
}) {
  const accentColor = accent === "gold" ? "var(--gold)" : "var(--orange)";
  return (
    <button
      onClick={onClick}
      style={{
        background: active
          ? accent === "gold" ? "rgba(232,168,48,0.15)" : "var(--orange-dim)"
          : "var(--card)",
        border: `1px solid ${active ? accentColor : "var(--border)"}`,
        borderRadius: "20px",
        padding: "6px 14px",
        color: active ? accentColor : "var(--muted)",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

/* ─── Mode toggle ────────────────────────────────── */

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "places" | "dishes";
  onChange: (m: "places" | "dishes") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "14px",
        padding: "4px",
        gap: "4px",
      }}
    >
      {(["places", "dishes"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            flex: 1,
            background: mode === m ? "var(--orange)" : "transparent",
            border: "none",
            borderRadius: "10px",
            padding: "9px 0",
            color: mode === m ? "white" : "var(--muted)",
            fontSize: "13px",
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.15s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          {m === "places" ? "🏪" : "🍽️"}
          {m === "places" ? "Places" : "Dishes"}
        </button>
      ))}
    </div>
  );
}

/* ─── Trending card ──────────────────────────────── */

function TrendingCard({ r, rank }: { r: TrendingRestaurant; rank: number }) {
  return (
    <Link href="/circle" className="block">
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          overflow: "hidden",
        }}
      >
        {/* Hero */}
        <div
          style={{
            height: "160px",
            background: "linear-gradient(160deg, #2A1008 0%, #6B3318 50%, #A04020 100%)",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {r.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.photo_url} alt={r.restaurant_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: "56px", filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))" }}>
              {restaurantEmoji(r.restaurant_name)}
            </span>
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)" }} />

          {/* Cuisine badge */}
          <span
            style={{
              position: "absolute", top: "10px", left: "10px",
              background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.9)",
              fontSize: "10px", fontWeight: 600, padding: "3px 9px", borderRadius: "20px",
            }}
          >
            {r.cuisine_type}
          </span>

          {/* Velocity badge */}
          <span
            style={{
              position: "absolute", top: "10px", right: "10px",
              background: "rgba(232,168,48,0.2)", border: "1px solid rgba(232,168,48,0.4)",
              color: "var(--gold)", fontSize: "10px", fontWeight: 700,
              padding: "3px 9px", borderRadius: "20px",
            }}
          >
            ↑ {r.users_week > 0 ? `${r.users_week} this week` : `${r.users_all_time} total`}
          </span>

          {/* Rank + name */}
          <div style={{ position: "absolute", bottom: "10px", left: "10px", display: "flex", alignItems: "flex-end", gap: "6px" }}>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 800, color: rank <= 3 ? "var(--gold)" : "rgba(255,255,255,0.7)" }}>
              #{rank}
            </span>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 800, color: "white", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "180px" }}>
              {r.restaurant_name}
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "12px 14px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            {r.avg_score > 0 ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: "3px" }}>
                <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "22px", fontWeight: 800, color: "var(--cream)" }}>
                  {r.avg_score.toFixed(1)}
                </span>
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>/10</span>
                <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "6px" }}>
                  from {r.users_all_time} {r.users_all_time === 1 ? "person" : "people"}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {r.users_all_time} {r.users_all_time === 1 ? "log" : "logs"}
              </span>
            )}
            {r.recency_boost && (
              <span style={{ background: "rgba(61,214,140,0.12)", border: "1px solid rgba(61,214,140,0.25)", color: "var(--green)", fontSize: "10px", fontWeight: 600, padding: "3px 8px", borderRadius: "20px" }}>
                🟢 Logged today
              </span>
            )}
          </div>

          {r.top_dish && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "rgba(232,168,48,0.1)", border: "1px solid rgba(232,168,48,0.2)", borderRadius: "20px", padding: "5px 10px" }}>
              <span style={{ fontSize: "11px", color: "var(--gold)", fontWeight: 600 }}>🏅 Most logged: {r.top_dish}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ─── Dish result card ───────────────────────────── */

function DishCard({ result }: { result: DishResult }) {
  const [wishlisted, setWishlisted] = useState(false);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "18px",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--cream)", lineHeight: 1.2 }}>
            {result.dish_name}
          </p>
          <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {restaurantEmoji(result.restaurant_name)} {result.restaurant_name}
          </p>
        </div>

        {/* Score badge */}
        {result.avg_score > 0 && (
          <div
            style={{
              background: "rgba(61,214,140,0.12)",
              border: "1px solid rgba(61,214,140,0.3)",
              borderRadius: "12px",
              padding: "6px 10px",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 800, color: "#3DD68C", lineHeight: 1 }}>
              {result.avg_score.toFixed(1)}
            </div>
            <div style={{ fontSize: "9px", color: "#3DD68C", opacity: 0.7, marginTop: "1px" }}>/10</div>
          </div>
        )}
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "3px 9px",
            fontSize: "11px",
            color: "var(--muted)",
          }}
        >
          📍 Near you
        </span>
        <span style={{ fontSize: "11px", color: "var(--muted)" }}>
          {result.unique_raters} {result.unique_raters === 1 ? "person" : "people"} rated this here
        </span>
      </div>

      {/* Latest one-liner */}
      {result.latest_take && (
        <p
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontStyle: "italic",
            fontSize: "13px",
            color: "var(--cream)",
            lineHeight: 1.5,
            borderLeft: "2px solid var(--orange)",
            paddingLeft: "10px",
            opacity: 0.85,
          }}
        >
          &ldquo;{result.latest_take}&rdquo;
          {result.latest_reviewer && (
            <span style={{ fontStyle: "normal", fontSize: "11px", color: "var(--muted)", marginLeft: "6px" }}>
              — {result.latest_reviewer}
            </span>
          )}
        </p>
      )}

      {/* Wishlist button */}
      <button
        onClick={() => setWishlisted((v) => !v)}
        style={{
          width: "100%",
          background: wishlisted ? "rgba(232,168,48,0.12)" : "var(--surface)",
          border: `1px solid ${wishlisted ? "rgba(232,168,48,0.35)" : "var(--border)"}`,
          borderRadius: "12px",
          padding: "10px",
          color: wishlisted ? "var(--gold)" : "var(--muted)",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          transition: "all 0.15s",
        }}
      >
        {wishlisted ? "⭐ On your wishlist" : "☆ Add to Wishlist"}
      </button>
    </div>
  );
}

/* ─── Dishes mode ────────────────────────────────── */

const PLACEHOLDERS = ["biryani...", "ramen...", "dosa...", "pasta...", "shawarma...", "burger..."];

function DishesMode({ reviews }: { reviews: SlimReview[] }) {
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const popularDishes = useMemo(() => getPopularDishes(reviews), [reviews]);
  const results = useMemo(() => searchDishes(reviews, committed), [reviews, committed]);

  function commit(q: string) {
    setQuery(q);
    setCommitted(q.trim());
  }

  return (
    <div>
      {/* Search bar */}
      <div className="px-4" style={{ marginBottom: "14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "13px 14px",
          }}
        >
          <span style={{ fontSize: "16px", flexShrink: 0 }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder={`What are you craving? ${PLACEHOLDERS[placeholderIdx]}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(query);
            }}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--cream)",
              fontSize: "14px",
            }}
          />
          {query ? (
            <button
              onClick={() => { setQuery(""); setCommitted(""); }}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}
            >
              ✕
            </button>
          ) : null}
          {query.trim() && query.trim() !== committed && (
            <button
              onClick={() => commit(query)}
              style={{
                background: "var(--orange)",
                border: "none",
                borderRadius: "10px",
                padding: "6px 14px",
                color: "white",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Find
            </button>
          )}
        </div>
      </div>

      {/* Popular dish pills — shown when no search */}
      {!committed && popularDishes.length > 0 && (
        <div className="px-4" style={{ marginBottom: "20px" }}>
          <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "10px" }}>
            Most logged
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {popularDishes.map((dish) => (
              <button
                key={dish}
                onClick={() => commit(dish)}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "20px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  color: "var(--cream)",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {dish}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {committed && (
        <div className="px-4" style={{ display: "flex", flexDirection: "column", gap: "12px", paddingBottom: "24px" }}>
          {results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <span style={{ fontSize: "48px", display: "block", marginBottom: "12px" }}>🍽️</span>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>
                Nobody has logged {committed} near you yet
              </p>
              <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "20px" }}>Be the first to try it</p>
              <Link href="/reviews/new">
                <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "12px 24px", fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
                  Log a spot →
                </button>
              </Link>
            </div>
          ) : (
            <>
              <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px" }}>
                {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{committed}&rdquo;
              </p>
              {results.map((r, i) => (
                <DishCard key={`${r.restaurant_name}__${r.dish_name}__${i}`} result={r} />
              ))}
            </>
          )}
        </div>
      )}

      {/* No-search empty state */}
      {!committed && popularDishes.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 20px" }}>
          <span style={{ fontSize: "48px", display: "block", marginBottom: "12px" }}>🍽️</span>
          <p style={{ fontSize: "13px", color: "var(--muted)" }}>
            Start typing to search dishes across all logged spots
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Main component ─────────────────────────────── */

interface Props {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  totalUsersThisWeek: number;
  reviews: SlimReview[];
}

const TIME_OPTIONS: { key: TrendingWindow; label: string }[] = [
  { key: "week",    label: "This Week" },
  { key: "month",   label: "This Month" },
  { key: "alltime", label: "All Time" },
];

export default function TrendingClient({ week, month, alltime, totalUsersThisWeek, reviews }: Props) {
  const [mode, setMode] = useState<"places" | "dishes">("places");
  const [timeFilter, setTimeFilter] = useState<TrendingWindow>("week");
  const [cuisineFilter, setCuisineFilter] = useState("All");

  const activeList = timeFilter === "week" ? week : timeFilter === "month" ? month : alltime;

  const cuisinePills = useMemo(() => {
    const seen = new Set<string>();
    for (const r of activeList) seen.add(r.cuisine_type);
    return ["All", ...Array.from(seen)];
  }, [activeList]);

  const filtered = useMemo(
    () => cuisineFilter === "All" ? activeList : activeList.filter((r) => r.cuisine_type === cuisineFilter),
    [activeList, cuisineFilter]
  );

  function handleTimeChange(t: TrendingWindow) {
    setTimeFilter(t);
    setCuisineFilter("All");
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div className="px-5 pt-6 pb-3">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)" }}>
              Trending
            </p>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: "26px", color: "var(--cream)", marginTop: "4px", lineHeight: "1.1" }}>
              {mode === "places" ? "Trending near you" : "Find a dish"}
            </h1>
          </div>
          {mode === "places" && totalUsersThisWeek > 0 && (
            <div style={{ background: "rgba(232,168,48,0.12)", border: "1px solid rgba(232,168,48,0.2)", borderRadius: "12px", padding: "8px 12px", textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--gold)" }}>
                {totalUsersThisWeek}
              </div>
              <div style={{ fontSize: "9px", color: "var(--muted)", marginTop: "1px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                this week
              </div>
            </div>
          )}
        </div>
        {mode === "places" && totalUsersThisWeek > 0 && (
          <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px" }}>
            Based on {totalUsersThisWeek} {totalUsersThisWeek === 1 ? "person" : "people"} who logged food this week
          </p>
        )}
      </div>

      {/* Mode toggle */}
      <div className="px-5 pb-4">
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {/* ── PLACES MODE ── */}
      {mode === "places" && (
        <>
          {/* Time filter */}
          <div className="px-5 pb-3" style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
            {TIME_OPTIONS.map((opt) => (
              <Pill key={opt.key} active={timeFilter === opt.key} onClick={() => handleTimeChange(opt.key)} accent="gold">
                {opt.label}
              </Pill>
            ))}
          </div>

          {/* Cuisine filter */}
          {cuisinePills.length > 1 && (
            <div className="px-5 pb-4" style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
              {cuisinePills.map((c) => (
                <Pill key={c} active={cuisineFilter === c} onClick={() => setCuisineFilter(c)}>
                  {c}
                </Pill>
              ))}
            </div>
          )}

          {/* Cards */}
          <div className="px-4 flex flex-col gap-4 pb-6">
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0" }}>
                <span style={{ fontSize: "48px", display: "block", marginBottom: "12px" }}>🔥</span>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>
                  {activeList.length === 0 ? "Nothing trending yet" : `No ${cuisineFilter} spots yet`}
                </p>
                <p style={{ fontSize: "13px", color: "var(--muted)" }}>
                  {activeList.length === 0 ? "Be the first to log a place this week" : "Try a different cuisine filter"}
                </p>
              </div>
            ) : (
              filtered.map((r, i) => <TrendingCard key={r.restaurant_name} r={r} rank={i + 1} />)
            )}
          </div>
        </>
      )}

      {/* ── DISHES MODE ── */}
      {mode === "dishes" && <DishesMode reviews={reviews} />}

    </div>
  );
}
