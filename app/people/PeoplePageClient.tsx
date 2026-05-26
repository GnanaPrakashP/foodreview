"use client";

import { useEffect, useState } from "react";
import { cachedJson, primeCachedJson, readCachedJson, refreshCachedJson } from "@/lib/browser-api-cache";
import PeopleTab from "@/components/people/PeopleTab";
import type { CircleMember } from "@/lib/people-page-data";

const PEOPLE_TTL_MS = 5 * 60 * 1000;
const API_URL = "/api/people";

type PeopleApiResponse = {
  circleMembers: CircleMember[];
};

export function PeopleSkeleton() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ padding: "24px 20px 14px" }}>
        <div style={{ height: 28, width: 100, borderRadius: 8, background: "var(--card)", marginBottom: 14 }} />
        <div style={{ height: 40, borderRadius: 12, background: "var(--card)" }} />
      </div>
      <div style={{ padding: "0 20px" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: "var(--card)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 13, width: 120, borderRadius: 5, background: "var(--card)", marginBottom: 7 }} />
              <div style={{ height: 11, width: 80, borderRadius: 5, background: "var(--card)" }} />
            </div>
            <div style={{ width: 64, height: 30, borderRadius: 99, background: "var(--card)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PeoplePageClient({ initialData = null }: { initialData?: PeopleApiResponse | null }) {
  const [data, setData] = useState<PeopleApiResponse | null>(initialData);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (initialData) {
      const cachedData = readCachedJson<PeopleApiResponse>(API_URL, { allowStale: true });
      if (cachedData) {
        setData(cachedData);
      } else {
        primeCachedJson(API_URL, initialData, PEOPLE_TTL_MS);
      }
      refreshCachedJson<PeopleApiResponse>(API_URL, PEOPLE_TTL_MS)
        .then((fresh) => {
          if (!cancelled) setData(fresh);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    const cachedData = readCachedJson<PeopleApiResponse>(API_URL, { allowStale: true });
    if (cachedData) setData(cachedData);
    const load = cachedData
      ? refreshCachedJson<PeopleApiResponse>(API_URL, PEOPLE_TTL_MS)
      : cachedJson<PeopleApiResponse>(API_URL, PEOPLE_TTL_MS);
    load
      .then((fresh) => {
        if (!cancelled) setData(fresh);
      })
      .catch(() => {
        if (!cachedData && !cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
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

  if (!data) return <PeopleSkeleton />;

  return <PeopleTab initialCircle={data.circleMembers} />;
}
