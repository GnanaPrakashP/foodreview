"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/",         label: "Circle",   icon: "👥",  center: false },
  { href: "/trending", label: "Trending", icon: "🔥",  center: false },
  { href: "/reviews/new", label: "Share", icon: "📸",  center: true  },
  { href: "/people",   label: "People",   icon: "🔍",  center: false },
  { href: "/me",       label: "Me",       icon: "👤",  center: false },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 pb-safe"
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        overflow: "visible",          /* lets the center button float above */
      }}
    >
      <div className="max-w-lg mx-auto flex items-center justify-around h-16">
        {TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);

          /* ── Center elevated Share button ── */
          if (tab.center) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
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
                    fontSize: "24px",
                    boxShadow:
                      "0 8px 24px rgba(240,96,48,0.40), 0 2px 8px rgba(0,0,0,0.35)",
                  }}
                >
                  {tab.icon}
                </div>
              </Link>
            );
          }

          /* ── Regular tab ── */
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center gap-0.5 px-2 py-1"
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  letterSpacing: "0.2px",
                  color: active ? "var(--orange)" : "var(--muted)",
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
