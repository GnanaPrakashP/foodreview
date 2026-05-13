"use client";

import { cachedJson, invalidateCachedJson, primeCachedJson } from "@/lib/browser-api-cache";
import type { AccountType } from "@/lib/types";

export type CircleStatusPayload = {
  accountType?: AccountType;
  members?: string[];
  joinedCircles?: string[];
  mutualMembers?: string[];
  oneWayMembers?: string[];
  audienceMembers?: string[];
  displayMembers?: string[];
  pendingIncoming?: string[];
  pendingSent?: string[];
  memberStates?: Record<string, string>;
  accountTypes?: Record<string, string>;
  circleCount?: number;
};

const CIRCLE_STATUS_TTL_MS = 5 * 60 * 1000;

export function circleStatusUrl(name: string) {
  return `/api/circle/status?name=${encodeURIComponent(name)}`;
}

export function cachedCircleStatus(name: string) {
  return cachedJson<CircleStatusPayload>(circleStatusUrl(name), CIRCLE_STATUS_TTL_MS);
}

export async function freshCircleStatus(name: string) {
  const response = await fetch(circleStatusUrl(name), { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const value = await response.json() as CircleStatusPayload;
  primeCachedJson(circleStatusUrl(name), value, CIRCLE_STATUS_TTL_MS);
  return value;
}

export function invalidateCircleStatusCache(name?: string) {
  if (name) {
    invalidateCachedJson(circleStatusUrl(name));
    return;
  }
  invalidateCachedJson("/api/circle/status");
}
