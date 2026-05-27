"use client";

const PENDING_ROUTE_KEY = "fc_pending_route";

export function writePendingRoute(pathname: string) {
  try {
    sessionStorage.setItem(PENDING_ROUTE_KEY, pathname);
  } catch {
    // Session storage can be unavailable in private browsing.
  }
}

export function readPendingRoute() {
  try {
    return sessionStorage.getItem(PENDING_ROUTE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingRoute() {
  try {
    sessionStorage.removeItem(PENDING_ROUTE_KEY);
  } catch {
    // Ignore storage access failures.
  }
}
