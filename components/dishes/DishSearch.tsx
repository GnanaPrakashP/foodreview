"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { searchDishes } from "@/lib/dishes";
import type { SlimReview, DishResult } from "@/lib/dishes";

/* ─── score bar ──────────────────────────────────── */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.min((score / 10) * 100, 100);
  const color = score >= 8 ? "var(--green)" : score >= 6 ? "var(--gold)" : "var(--orange)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          flex: 1,
          height: "4px",
          background: "var(--border)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "2px" }} />
      </div>
      <span
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "14px",
          fontWeight: 800,
          color,
          flexShrink: 0,
        }}
      >
        {score.toFixed(1)}
        <span style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 400 }}>/10</span>
      </span>
    </div>
  );
}

/* ─── dish result card ───────────────────────────── */
function DishCard({ result }: { result: DishResult }) {
  return (
    <Link href="/" className="block">
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "18px",
          padding: "14px",
        }}
      >
        {/* Restaurant + dish */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: "16px",
                fontWeight: 800,
                color: "var(--cream)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {result.restaurant_name}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
              <span
                style={{
                  background: "rgba(61,214,140,0.12)",
                  border: "1px solid rgba(61,214,140,0.25)",
                  color: "var(--green)",
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "20px",
                }}
              >
                {result.dish_name}
              </span>
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontSize: "11px", color: "var(--muted)" }}>
              {result.unique_raters} {result.unique_raters === 1 ? "person" : "people"} rated
            </p>
            {result.total_logs > result.unique_raters && (
              <p style={{ fontSize: "10px", color: "var(--muted)", marginTop: "1px" }}>
                {result.total_logs} total logs
              </p>
            )}
          </div>
        </div>

        {/* Score bar */}
        {result.avg_score > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <ScoreBar score={result.avg_score} />
          </div>
        )}

        {/* Latest take */}
        {result.latest_take && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface)",
              borderLeft: "3px solid var(--green)",
              borderRadius: "0 10px 10px 0",
            }}
          >
            <p
              style={{
                fontFamily: "'Syne', sans-serif",
                fontStyle: "italic",
                fontSize: "14px",
                color: "var(--cream)",
                lineHeight: "1.4",
              }}
            >
              "{result.latest_take}"
            </p>
            {result.latest_reviewer && (
              <p style={{ fontSize: "10px", color: "var(--muted)", marginTop: "4px" }}>
                — {result.latest_reviewer}
              </p>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ─── main component ─────────────────────────────── */

interface Props {
  reviews: SlimReview[];
  popularDishes: string[];
}

export default function DishSearch({ reviews, popularDishes }: Props) {
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");

  const results: DishResult[] = useMemo(
    () => searchDishes(reviews, committed),
    [reviews, committed]
  );

  function submit(q: string) {
    setQuery(q);
    setCommitted(q);
  }

  const hasQuery = committed.trim() !== "";

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <p
          style={{
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--green)",
          }}
        >
          Dishes
        </p>
        <h1
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "26px",
            color: "var(--cream)",
            marginTop: "4px",
            lineHeight: "1.1",
          }}
        >
          What are you craving?
        </h1>
      </div>

      {/* Search bar */}
      <div className="px-5 pb-4">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "14px 16px",
          }}
        >
          <span style={{ fontSize: "18px", flexShrink: 0 }}>🍽️</span>
          <input
            type="text"
            placeholder="e.g. Biryani, Ramen, Dosa…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(query);
            }}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--cream)",
              fontSize: "16px",
              fontFamily: "'Syne', sans-serif",
              fontStyle: query ? "normal" : "italic",
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setCommitted(""); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Search button (only when query changed) */}
        {query !== committed && query.trim() && (
          <button
            onClick={() => submit(query)}
            style={{
              width: "100%",
              marginTop: "10px",
              background: "var(--green)",
              color: "var(--on-green)",
              border: "none",
              borderRadius: "14px",
              padding: "13px",
              fontFamily: "'Syne', sans-serif",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Find "{query}" →
          </button>
        )}
      </div>

      {/* Popular dish tags (shown when no search) */}
      {!hasQuery && popularDishes.length > 0 && (
        <div className="px-5 pb-5">
          <p
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "1px",
              marginBottom: "10px",
            }}
          >
            Popular right now
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {popularDishes.map((dish) => (
              <button
                key={dish}
                onClick={() => submit(dish)}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "20px",
                  padding: "8px 14px",
                  color: "var(--cream)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {dish}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state (no data at all) */}
      {!hasQuery && popularDishes.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 20px" }}>
          <span style={{ fontSize: "52px", display: "block", marginBottom: "12px" }}>🍽️</span>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>
            No dish data yet
          </p>
          <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
            Share a meal and name the dish — it'll show up here.
          </p>
          <Link href="/reviews/new">
            <button
              style={{
                marginTop: "16px",
                background: "var(--orange)",
                color: "white",
                border: "none",
                borderRadius: "14px",
                padding: "12px 24px",
                fontFamily: "'Syne', sans-serif",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Share a moment →
            </button>
          </Link>
        </div>
      )}

      {/* Search results */}
      {hasQuery && (
        <div className="px-4 pb-6">
          {results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <span style={{ fontSize: "48px", display: "block", marginBottom: "12px" }}>🤷</span>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>
                No "{committed}" logs yet
              </p>
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>
                Be the first to log it on the Share tab.
              </p>
            </div>
          ) : (
            <>
              <p
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "var(--green)",
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  marginBottom: "12px",
                }}
              >
                {results.length} spot{results.length !== 1 ? "s" : ""} for "{committed}"
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {results.map((r) => (
                  <DishCard key={`${r.restaurant_name}-${r.dish_name}`} result={r} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
