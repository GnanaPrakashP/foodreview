"use client";

import { isInitialDocumentReload, markSpaNavigationStarted } from "@/lib/browser-navigation-state";

const PENDING_ROUTE_KEY = "fc_pending_route";
const PENDING_ROUTE_MAX_AGE_MS = 15 * 1000;

type PendingRoute = {
  pathname: string;
  savedAt: number;
};

function parsePendingRoute(raw: string | null): PendingRoute | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRoute>;
    if (typeof parsed.pathname === "string" && typeof parsed.savedAt === "number") {
      return { pathname: parsed.pathname, savedAt: parsed.savedAt };
    }
  } catch {
    return { pathname: raw, savedAt: 0 };
  }
  return null;
}

export function writePendingRoute(pathname: string) {
  markSpaNavigationStarted();
  try {
    sessionStorage.setItem(PENDING_ROUTE_KEY, JSON.stringify({ pathname, savedAt: Date.now() }));
  } catch {
    // Session storage can be unavailable in private browsing.
  }
}

export function readPendingRoute() {
  try {
    return parsePendingRoute(sessionStorage.getItem(PENDING_ROUTE_KEY))?.pathname ?? null;
  } catch {
    return null;
  }
}

export function consumePendingRoute(pathname: string) {
  const pending = (() => {
    try {
      return parsePendingRoute(sessionStorage.getItem(PENDING_ROUTE_KEY));
    } catch {
      return null;
    }
  })();

  clearPendingRoute();
  if (!pending || pending.pathname !== pathname || isInitialDocumentReload()) return false;
  if (pending.savedAt > 0 && Date.now() - pending.savedAt > PENDING_ROUTE_MAX_AGE_MS) return false;
  return true;
}

export function clearPendingRoute() {
  try {
    sessionStorage.removeItem(PENDING_ROUTE_KEY);
  } catch {
    // Ignore storage access failures.
  }
}
