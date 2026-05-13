"use client";

import { useEffect, useState } from "react";
import { cachedJson, primeCachedJson } from "@/lib/browser-api-cache";
import TrendingClient from "@/components/trending/TrendingClient";
import type { TrendingPageData } from "@/lib/trending-page-data";

const TRENDING_TTL_MS = 5 * 60 * 1000;
const API_URL = "/api/trending";

function TrendingSkeleton() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ padding: "18px 20px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ height: 30, width: 130, borderRadius: 8, background: "var(--card)", marginBottom: 8 }} />
        <div style={{ height: 12, width: 200, borderRadius: 6, background: "var(--card)", marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 0, paddingBottom: 0 }}>
          <div style={{ flex: 1, height: 36, borderBottom: "2px solid var(--border)" }} />
          <div style={{ flex: 1, height: 36, borderBottom: "2px solid var(--border)" }} />
        </div>
      </div>
      <div style={{ padding: "14px 20px 0" }}>
        <div style={{ height: 36, borderRadius: 10, background: "var(--card)", marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 24, width: 70, borderRadius: 99, background: "var(--card)" }} />
          ))}
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ height: 88, borderRadius: 14, background: "var(--card)", marginBottom: 10 }} />
        ))}
      </div>
    </div>
  );
}

export default function TrendingPageClient({ initialData = null }: { initialData?: TrendingPageData | null }) {
  const [data, setData] = useState<TrendingPageData | null>(initialData);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (initialData) {
      primeCachedJson(API_URL, initialData, TRENDING_TTL_MS);
      return;
    }
    cachedJson<TrendingPageData>(API_URL, TRENDING_TTL_MS)
      .then(setData)
      .catch(() => setError(true));
  }, [initialData]);

  if (error) {
    return (
      <div style={{ background: "var(--bg)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
          Failed to load. Please try again.
        </p>
      </div>
    );
  }

  if (!data) return <TrendingSkeleton />;

  return (
    <TrendingClient
      week={data.week}
      month={data.month}
      alltime={data.alltime}
      peopleCounts={data.peopleCounts}
      circleReviews={data.circleReviews}
      circleWeek={data.circleWeek}
      circleMonth={data.circleMonth}
      circleAlltime={data.circleAlltime}
      circlePeopleCounts={data.circlePeopleCounts}
    />
  );
}
