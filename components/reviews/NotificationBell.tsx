"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cachedJson, readCachedJson } from "@/lib/browser-api-cache";

const UNREAD_COUNT_TTL_MS = 15_000;
const API_URL = "/api/notifications/unread-count";

function isDocumentReload() {
  try {
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return navigation?.type === "reload";
  } catch {
    return false;
  }
}

export default function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
  const [unreadCount, setUnreadCount] = useState(() => {
    const cached = readCachedJson<{ unreadCount?: number }>(API_URL, { allowStale: true });
    return typeof cached?.unreadCount === "number" ? cached.unreadCount : initialUnreadCount;
  });

  useEffect(() => {
    let active = true;

    async function loadUnreadCount(options: { skipWhenCached?: boolean } = {}) {
      try {
        const cached = !isDocumentReload()
          ? readCachedJson<{ unreadCount?: number }>(API_URL, { allowStale: true })
          : null;
        if (options.skipWhenCached && cached) {
          if (active && typeof cached.unreadCount === "number") setUnreadCount(cached.unreadCount);
          return;
        }
        const data = await cachedJson<{ unreadCount?: number }>(
          API_URL,
          UNREAD_COUNT_TTL_MS,
          { bypassOnReload: true }
        );
        if (active && typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
      } catch {
        // Keep the bell quiet if the user is logged out or the network hiccups.
      }
    }

    loadUnreadCount({ skipWhenCached: true });
    const interval = window.setInterval(loadUnreadCount, 45_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, textDecoration: "none" }}
      aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
    >
      <span style={{ fontSize: "20px", lineHeight: 1 }}>🔔</span>
      {unreadCount > 0 && (
        <span style={{ position: "absolute", top: 0, right: 0, background: "#E84040", color: "white", borderRadius: "999px", minWidth: "16px", height: "16px", fontSize: "9px", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", fontFamily: "'DM Sans', sans-serif", lineHeight: 1 }}>
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
