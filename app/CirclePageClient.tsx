"use client";

import { useEffect, useState } from "react";
import { cachedJson, primeCachedJson, readCachedJson } from "@/lib/browser-api-cache";
import CircleFeedClient from "@/components/circle/CircleFeedClient";
import NotificationBell from "@/components/reviews/NotificationBell";
import StoriesTray from "@/components/stories/StoriesTray";
import type { CircleFeedPage } from "@/lib/circle-feed";

const CIRCLE_TTL_MS = 3 * 60 * 1000;
const API_URL = "/api/feed/circle";

export function CircleSkeleton() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 12px 10px" }}>
        <div>
          <div style={{ height: 28, width: 210, borderRadius: 8, background: "var(--card)" }} />
        </div>
        <div>
          <NotificationBell />
        </div>
      </div>
      <div style={{ padding: "8px 12px 0" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface)" }} />
              <div>
                <div style={{ height: 12, width: 100, borderRadius: 5, background: "var(--surface)", marginBottom: 6 }} />
                <div style={{ height: 10, width: 70, borderRadius: 5, background: "var(--surface)" }} />
              </div>
            </div>
            <div style={{ height: 14, width: "80%", borderRadius: 5, background: "var(--surface)", marginBottom: 8 }} />
            <div style={{ height: 12, width: "60%", borderRadius: 5, background: "var(--surface)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CirclePageClient({ initialData = null }: { initialData?: CircleFeedPage | null }) {
  const [data, setData] = useState<CircleFeedPage | null>(initialData);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (initialData) {
      const cachedData = readCachedJson<CircleFeedPage>(API_URL);
      if (cachedData) {
        setData(cachedData);
      } else {
        primeCachedJson(API_URL, initialData, CIRCLE_TTL_MS);
      }
      return;
    }
    cachedJson<CircleFeedPage>(API_URL, CIRCLE_TTL_MS)
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

  if (!data) return <CircleSkeleton />;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 12px 10px" }}>
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", color: "var(--cream)", lineHeight: "1.2", margin: 0 }}>
            What they&rsquo;re{" "}
            <span style={{ fontStyle: "italic", color: "var(--orange)" }}>eating</span>
          </h1>
        </div>
        <div>
          <NotificationBell />
        </div>
      </div>

      <StoriesTray />

      <CircleFeedClient
        allReviews={data.reviews}
        likeCountMap={data.likeCountMap}
        commentMap={data.commentMap}
        rankMap={data.rankMap}
        initialProfileMap={data.profileMap}
        initialMyName={data.myName}
        initialCircle={data.joinedCircles}
        initialMutualCircle={data.mutualMembers}
        initialLikedMap={data.likedByMeMap}
        initialBookmarkedPostMap={data.bookmarkedPostMap}
        initialHasMore={data.hasMore}
        initialNextCursor={data.nextCursor}
      />
    </div>
  );
}
