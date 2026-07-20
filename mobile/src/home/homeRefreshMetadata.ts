import type { QueryClient } from "@tanstack/react-query";

export const HOME_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
export const HOME_REFRESH_FUTURE_SKEW_MS = 60_000;

export const homeRefreshMetadataKeys = {
  pageOne: (ownerScope: string) => ["home", "page-one-refresh-at", ownerScope] as const
};

export function normalizeHomePageOneRefreshAt(value: unknown, now = Date.now()) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value > now + HOME_REFRESH_FUTURE_SKEW_MS) return null;
  return value;
}

export function recordHomePageOneRefreshAt(
  queryClient: QueryClient,
  ownerScope: string,
  refreshedAt = Date.now()
) {
  const timestamp = normalizeHomePageOneRefreshAt(refreshedAt, refreshedAt);
  if (timestamp === null) return false;
  queryClient.setQueryData(homeRefreshMetadataKeys.pageOne(ownerScope), timestamp);
  return true;
}

export function readHomePageOneRefreshAt(queryClient: QueryClient, ownerScope: string, now = Date.now()) {
  return normalizeHomePageOneRefreshAt(
    queryClient.getQueryData(homeRefreshMetadataKeys.pageOne(ownerScope)),
    now
  );
}

export function isHomePageOneFresh(refreshedAt: unknown, now = Date.now()) {
  const timestamp = normalizeHomePageOneRefreshAt(refreshedAt, now);
  if (timestamp === null) return false;
  return Math.max(0, now - timestamp) < HOME_FRESHNESS_WINDOW_MS;
}
