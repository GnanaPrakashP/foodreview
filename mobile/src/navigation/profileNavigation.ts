import * as Haptics from "expo-haptics";
import type { Router } from "expo-router";
import type { QueryClient } from "@tanstack/react-query";
import { profileKeys } from "@/hooks/useProfiles";
import { recordPerformanceSample } from "@/performance/mobilePerformance";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";

const OPENING_GUARD_TIMEOUT_MS = 1_500;

type PendingProfileNavigation = {
  startedAt: number;
  warm: boolean;
};

const openingUntil = new Map<string, number>();
const pendingNavigation = new Map<string, PendingProfileNavigation>();

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function claimProfileNavigation(username: string, now = Date.now()) {
  const normalized = normalizeUsername(username);
  if (!normalized) return false;
  const lockedUntil = openingUntil.get(normalized) ?? 0;
  if (lockedUntil > now) return false;
  openingUntil.set(normalized, now + OPENING_GUARD_TIMEOUT_MS);
  return true;
}

export function releaseProfileNavigation(username: string) {
  const normalized = normalizeUsername(username);
  if (normalized) openingUntil.delete(normalized);
}

export function openProfileRoute(input: {
  queryClient: QueryClient;
  router: Pick<Router, "push">;
  username: string;
  viewerUsername: string;
}) {
  const username = normalizeUsername(input.username);
  if (!username || !claimProfileNavigation(username)) return false;

  const isSelf = username === normalizeUsername(input.viewerUsername);
  if (!isSelf) {
    pendingNavigation.set(username, {
      startedAt: Date.now(),
      warm: Boolean(input.queryClient.getQueryData(profileKeys.otherShell(username)))
    });
  }

  void Haptics.selectionAsync().catch(() => {});
  try {
    input.router.push(isSelf
      ? "/profile"
      : { pathname: "/people/[username]", params: { username } });
  } catch (error) {
    releaseProfileNavigation(username);
    pendingNavigation.delete(username);
    throw error;
  }

  setTimeout(() => releaseProfileNavigation(username), OPENING_GUARD_TIMEOUT_MS);
  return true;
}

export function recordProfileShellVisible(username: string) {
  const normalized = normalizeUsername(username);
  releaseProfileNavigation(normalized);
  const pending = pendingNavigation.get(normalized);
  if (!pending) return;
  pendingNavigation.delete(normalized);
  recordPerformanceSample(
    pending.warm ? "profile.other.warm_shell_visible" : "profile.other.cold_shell_visible",
    { durationMs: Math.max(0, Date.now() - pending.startedAt) }
  );
}

export function clearProfileNavigationState() {
  openingUntil.clear();
  pendingNavigation.clear();
}

registerSensitiveResourceCleanup(clearProfileNavigationState);
