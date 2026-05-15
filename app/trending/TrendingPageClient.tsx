"use client";

import { useCallback, useEffect, useState } from "react";
import { cachedJson, primeCachedJson, readCachedJson } from "@/lib/browser-api-cache";
import TrendingClient from "@/components/trending/TrendingClient";
import type { TrendingPageData } from "@/lib/trending-page-data";
import { DEFAULT_TRENDING_LOCATION_BUCKET, normalizeLocationBucket, trendingApiUrl } from "@/lib/trending-location";

const TRENDING_TTL_MS = 5 * 60 * 1000;

export function TrendingSkeleton() {
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

export default function TrendingPageClient({
  initialData = null,
  initialLocationBucket = DEFAULT_TRENDING_LOCATION_BUCKET,
  initialLocationLabel = null,
}: {
  initialData?: TrendingPageData | null;
  initialLocationBucket?: string;
  initialLocationLabel?: string | null;
}) {
  const [data, setData] = useState<TrendingPageData | null>(initialData);
  const [error, setError] = useState(false);
  const [locationBucket, setLocationBucket] = useState(() => normalizeLocationBucket(initialLocationBucket));
  const handleLocationBucketChange = useCallback((nextBucket: string) => {
    setError(false);
    setLocationBucket(normalizeLocationBucket(nextBucket));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apiUrl = trendingApiUrl(locationBucket);

    if (initialData && locationBucket === normalizeLocationBucket(initialLocationBucket)) {
      const cachedData = readCachedJson<TrendingPageData>(apiUrl);
      if (cachedData) {
        setData(cachedData);
      } else {
        primeCachedJson(apiUrl, initialData, TRENDING_TTL_MS);
      }
      return () => { cancelled = true; };
    }

    const cachedData = readCachedJson<TrendingPageData>(apiUrl);
    if (cachedData) {
      setData(cachedData);
    } else {
      setData(null);
    }

    cachedJson<TrendingPageData>(apiUrl, TRENDING_TTL_MS)
      .then((freshData) => {
        if (!cancelled) setData(freshData);
      })
      .catch(() => setError(true));
    return () => { cancelled = true; };
  }, [initialData, initialLocationBucket, locationBucket]);

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
      initialLocationBucket={locationBucket}
      initialLocationLabel={initialLocationLabel}
      onLocationBucketChange={handleLocationBucketChange}
    />
  );
}
