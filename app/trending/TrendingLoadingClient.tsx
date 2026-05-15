"use client";

import { useState } from "react";
import { readCachedJson } from "@/lib/browser-api-cache";
import TrendingClient from "@/components/trending/TrendingClient";
import type { TrendingPageData } from "@/lib/trending-page-data";
import {
  readStoredTrendingLocationBucket,
  normalizeLocationLabel,
  trendingApiUrl,
  TRENDING_LOCATION_LABEL_STORAGE_KEY,
} from "@/lib/trending-location";
import { TrendingSkeleton } from "./TrendingPageClient";

function readStoredLocationLabel(): string | null {
  try {
    return normalizeLocationLabel(localStorage.getItem(TRENDING_LOCATION_LABEL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export default function TrendingLoadingClient() {
  const [snapshot] = useState(() => {
    const locationBucket = readStoredTrendingLocationBucket();
    return {
      locationBucket,
      locationLabel: readStoredLocationLabel(),
      data: readCachedJson<TrendingPageData>(trendingApiUrl(locationBucket)),
    };
  });

  if (!snapshot.data) return <TrendingSkeleton />;

  return (
    <TrendingClient
      week={snapshot.data.week}
      month={snapshot.data.month}
      alltime={snapshot.data.alltime}
      peopleCounts={snapshot.data.peopleCounts}
      circleReviews={snapshot.data.circleReviews}
      circleWeek={snapshot.data.circleWeek}
      circleMonth={snapshot.data.circleMonth}
      circleAlltime={snapshot.data.circleAlltime}
      circlePeopleCounts={snapshot.data.circlePeopleCounts}
      initialLocationBucket={snapshot.locationBucket}
      initialLocationLabel={snapshot.locationLabel}
    />
  );
}
