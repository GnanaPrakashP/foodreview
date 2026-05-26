"use client";

import { useEffect, useState } from "react";
import { cachedJson, primeCachedJson, readCachedJson } from "@/lib/browser-api-cache";
import MeClient from "@/components/me/MeClient";
import type { Review } from "@/lib/types";
import type { TasteTrustSummary } from "@/lib/taste-trust";

const ME_TTL_MS = 3 * 60 * 1000;
const API_URL = "/api/me";

type MeApiResponse = {
  reviews: Review[];
  circleMembers: string[];
  myName: string;
  displayName: string;
  bio?: string;
  joinedAt?: string;
  likeCountMap?: Record<string, number>;
  commentMap?: Record<string, { count: number; top: import("@/lib/types").Comment }>;
  likedByMeMap?: Record<string, boolean>;
  bookmarkedPostMap?: Record<string, boolean>;
  tasteTrust?: TasteTrustSummary;
};

export function MeSkeleton() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ padding: "24px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ height: 28, width: 120, borderRadius: 8, background: "var(--card)" }} />
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--card)" }} />
      </div>
      <div style={{ padding: "0 20px 16px", display: "flex", gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, height: 72, borderRadius: 14, background: "var(--card)" }} />
        ))}
      </div>
      <div style={{ padding: "0 20px" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 80, borderRadius: 14, background: "var(--card)", marginBottom: 10 }} />
        ))}
      </div>
    </div>
  );
}

export default function MePageClient({ initialData = null }: { initialData?: MeApiResponse | null }) {
  const [data, setData] = useState<MeApiResponse | null>(initialData);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (initialData) {
      const cachedData = readCachedJson<MeApiResponse>(API_URL);
      if (cachedData) {
        setData(cachedData);
      } else {
        primeCachedJson(API_URL, initialData, ME_TTL_MS);
      }
      return;
    }
    cachedJson<MeApiResponse>(API_URL, ME_TTL_MS)
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

  if (!data) return <MeSkeleton />;

  return (
    <MeClient
      allReviews={data.reviews}
      initialMyName={data.myName}
      initialDisplayName={data.displayName}
      initialBio={data.bio}
      joinedAt={data.joinedAt}
      initialCircle={data.circleMembers}
      likeCountMap={data.likeCountMap ?? {}}
      commentMap={data.commentMap ?? {}}
      likedByMeMap={data.likedByMeMap ?? {}}
      bookmarkedPostMap={data.bookmarkedPostMap ?? {}}
      tasteTrust={data.tasteTrust}
    />
  );
}
