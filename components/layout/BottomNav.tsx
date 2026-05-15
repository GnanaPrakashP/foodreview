"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Users, Flame, Camera, Search, User } from "lucide-react";
import { DEFAULT_TRENDING_LOCATION_BUCKET, readStoredTrendingLocationBucket } from "@/lib/trending-location";

function trendingHrefForBucket(locationBucket: string): string {
  return `/trending?loc=${encodeURIComponent(locationBucket)}`;
}

const TABS = [
  { href: "/",         label: "Circle",   Icon: Users,   center: false },
  { href: "/trending", label: "Trending", Icon: Flame,   center: false },
  { href: "/reviews/new", label: "Share", Icon: Camera,  center: true  },
  { href: "/people",   label: "People",   Icon: Search,  center: false },
  { href: "/me",       label: "Me",       Icon: User,    center: false },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [trendingHref, setTrendingHref] = useState(() => trendingHrefForBucket(DEFAULT_TRENDING_LOCATION_BUCKET));

  useEffect(() => {
    setPendingHref(null);
    setTrendingHref(trendingHrefForBucket(readStoredTrendingLocationBucket()));
  }, [pathname]);

  if (
    pathname === "/login" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/auth/reset-password") ||
    pathname.startsWith("/comments/") ||
    (pathname.startsWith("/reviews/") && pathname !== "/reviews/new") ||
    pathname.startsWith("/qa") ||
    pathname === "/privacy" ||
    pathname === "/terms"
  )
    return null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 pb-safe"
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        overflow: "visible",
      }}
    >
      <div className="max-w-lg mx-auto flex items-center justify-around h-16">
        {TABS.map((tab) => {
          const href = tab.href === "/trending" ? trendingHref : tab.href;
          const active =
            pendingHref === href ||
            (tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href));

          const beginNavigation = () => {
            if (tab.href !== pathname) setPendingHref(href);
          };

          /* ── Center elevated Share button ── */
          if (tab.center) {
            return (
              <Link
                key={tab.href}
                href={href}
                prefetch={false}
                onClick={beginNavigation}
                style={{ position: "relative", top: "-14px", flexShrink: 0 }}
                aria-label="Share"
              >
                <div
                  style={{
                    width: "54px",
                    height: "54px",
                    background: "var(--orange)",
                    borderRadius: "18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow:
                      "0 8px 24px rgba(240,96,48,0.40), 0 2px 8px rgba(0,0,0,0.35)",
                  }}
                >
                  <tab.Icon size={22} strokeWidth={2.2} color="white" />
                </div>
              </Link>
            );
          }

          /* ── Regular tab ── */
          const color = active ? "var(--orange)" : "var(--muted)";
          return (
            <Link
              key={tab.href}
              href={href}
              prefetch={false}
              onClick={beginNavigation}
              className="flex flex-col items-center gap-1 px-2 py-1"
              aria-current={active ? "page" : undefined}
              style={{ transform: active ? "translateY(-1px)" : "none", transition: "transform 120ms ease" }}
            >
              <tab.Icon size={20} strokeWidth={active ? 2.4 : 1.8} color={color} />
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  letterSpacing: "0.2px",
                  color,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
