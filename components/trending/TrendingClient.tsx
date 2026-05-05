"use client";

import { useState } from "react";
import Link from "next/link";
import type { TrendingRestaurant, TrendingWindow, CircleReviewItem } from "@/lib/trending";
import { avatarGradient, avatarInitials } from "@/lib/profile";

// ── Helpers ────────────────────────────────────────────────────────────────


function heatStyle(h: number) {
  if (h >= 90) return { bg: "#FF4D0022", border: "#FF4D0044", dot: "#FF4D00", label: "On Fire" };
  if (h >= 75) return { bg: "#F59E0B22", border: "#F59E0B44", dot: "#F59E0B", label: "Hot" };
  if (h >= 60) return { bg: "#34D39922", border: "#34D39944", dot: "#34D399", label: "Warm" };
  return { bg: "var(--surface)", border: "var(--border)", dot: "var(--muted)", label: "Cooling" };
}

function computeHeat(score: number, maxScore: number): number {
  if (maxScore === 0) return 50;
  return Math.min(100, Math.round((score / maxScore) * 100));
}

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

function HeatBar({ value }: { value: number }) {
  return (
    <div style={{ height: 3, background: "var(--surface)", borderRadius: 99, flex: 1, overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: 99, width: `${value}%`,
        background: value >= 90 ? "linear-gradient(90deg,#FF4D00,#F59E0B)" : value >= 75 ? "#F59E0B" : value >= 60 ? "#34D399" : "var(--border)",
      }} />
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
          ? `${shown[0].friend_name.split(" ")[0]} visited this`
          : `${shown.length} from your Circle`}
      </span>
    </div>
  );
}

// ── Restaurants tab ─────────────────────────────────────────────────────────

function RestaurantsTab({
  week,
  month,
  alltime,
  circleReviews,
}: {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  circleReviews: Record<string, CircleReviewItem[]>;
}) {
  const [timeFilter, setTimeFilter] = useState<TrendingWindow>("week");
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
          <button key={t} onClick={() => setTimeFilter(t)}
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
          filtered.map((r, i) => {
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

                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Rank number */}
                  <div style={{ minWidth: 26, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 21, fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>{i + 1}</span>
                  </div>

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
}: {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  circleReviews: Record<string, CircleReviewItem[]>;
}) {
  const [timeFilter, setTimeFilter] = useState<TrendingWindow>("week");
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
          <button key={t} onClick={() => setTimeFilter(t)}
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
        ) : picks.map((r, i) => {
          const cReviews = circleReviews[r.restaurant_name] ?? [];
          const stars = starRating(r.avg_score);
          return (
            <Link key={r.restaurant_name} href={`/trending/${encodeURIComponent(r.restaurant_name)}?circle=1`} style={{ textDecoration: "none", display: "block", marginBottom: 10 }}>
              <div style={{ background: "var(--card)", border: "1px solid #F59E0B22", borderRadius: 14, padding: 16, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 26, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 21, fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>{i + 1}</span>
                  </div>
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

// ── Detail drawer ─────────────────────────────────────────────────────────────

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  totalUsersThisWeek: number;
  circleReviews: Record<string, CircleReviewItem[]>;
  circleWeek: TrendingRestaurant[];
  circleMonth: TrendingRestaurant[];
  circleAlltime: TrendingRestaurant[];
}

export default function TrendingClient({ week, month, alltime, totalUsersThisWeek, circleReviews, circleWeek, circleMonth, circleAlltime }: Props) {
  const [tab, setTab] = useState<"restaurants" | "circle">("restaurants");

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", fontFamily: "'DM Sans',sans-serif", color: "var(--cream)" }}>

      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ padding: "18px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 30, fontWeight: 700, color: "var(--cream)", letterSpacing: "-0.5px", lineHeight: 1 }}>Trending</h1>
            {totalUsersThisWeek > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {totalUsersThisWeek} {totalUsersThisWeek === 1 ? "person" : "people"} eating out this week
              </div>
            )}
          </div>

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
          <RestaurantsTab week={week} month={month} alltime={alltime} circleReviews={circleReviews} />
        )}
        {tab === "circle" && <CirclePicksTab week={circleWeek} month={circleMonth} alltime={circleAlltime} circleReviews={circleReviews} />}
      </div>

    </div>
  );
}
