"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Users, Search, Plus, Flame, User } from "lucide-react";

const TABS = [
  { href: "/", label: "Circle", Icon: Users, center: false },
  { href: "/explore", label: "Explore", Icon: Search, center: false },
  { href: "/reviews/new", label: "+", Icon: Plus, center: true },
  { href: "/hungry", label: "Hungry", Icon: Flame, center: false },
  { href: "/me", label: "Me", Icon: User, center: false },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
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
          const href = tab.href;
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
                aria-label={tab.label}
              >
                <div
                  style={{
                    width: "54px",
                    height: "54px",
                    background: "var(--orange)",
                    borderRadius: "999px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow:
                      "0 8px 24px rgba(240,96,48,0.40), 0 2px 8px rgba(0,0,0,0.35)",
                  }}
                >
                  {tab.Icon && <tab.Icon size={22} strokeWidth={2.2} color="white" />}
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
