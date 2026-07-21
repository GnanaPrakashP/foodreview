import * as Haptics from "expo-haptics";
import type { Router } from "expo-router";
import type { QueryClient } from "@tanstack/react-query";
import { profileKeys } from "@/hooks/useProfiles";
import { recordPerformanceSample } from "@/performance/mobilePerformance";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";

const OPENING_GUARD_TIMEOUT_MS = 1_500;
const PROFILE_PREVIEW_TTL_MS = 2 * 60_000;
const MAX_PROFILE_PREVIEWS = 25;

export type ProfileNavigationPreview = {
  avatarCacheRevision: number;
  avatarMediaAssetId: string | null;
  avatarPlaceholder: string | null;
  avatarThumbnailUrl: string | null;
  displayName: string;
  initials: string;
  username: string;
};

type ProfileNavigationPreviewInput = Omit<ProfileNavigationPreview, "username">;

type StoredProfileNavigationPreview = ProfileNavigationPreview & {
  expiresAt: number;
};

type PendingProfileNavigation = {
  startedAt: number;
  warm: boolean;
};

const openingUntil = new Map<string, number>();
const pendingNavigation = new Map<string, PendingProfileNavigation>();
const profilePreviews = new Map<string, StoredProfileNavigationPreview>();

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function cleanPreviewText(value: string | null | undefined, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function storeProfileNavigationPreview(
  username: string,
  preview: ProfileNavigationPreviewInput,
  now = Date.now()
) {
  const displayName = cleanPreviewText(preview.displayName, 120) || username;
  const initials = cleanPreviewText(preview.initials, 4) || displayName.slice(0, 2).toUpperCase();
  const revision = Number.isFinite(preview.avatarCacheRevision)
    ? Math.max(1, Math.floor(preview.avatarCacheRevision))
    : 1;
  profilePreviews.delete(username);
  profilePreviews.set(username, {
    avatarCacheRevision: revision,
    avatarMediaAssetId: cleanPreviewText(preview.avatarMediaAssetId, 160) || null,
    avatarPlaceholder: cleanPreviewText(preview.avatarPlaceholder, 500) || null,
    avatarThumbnailUrl: cleanPreviewText(preview.avatarThumbnailUrl, 2_048) || null,
    displayName,
    expiresAt: now + PROFILE_PREVIEW_TTL_MS,
    initials,
    username
  });
  while (profilePreviews.size > MAX_PROFILE_PREVIEWS) {
    const oldestUsername = profilePreviews.keys().next().value as string | undefined;
    if (!oldestUsername) break;
    profilePreviews.delete(oldestUsername);
  }
}

export function getProfileNavigationPreview(username: string, now = Date.now()): ProfileNavigationPreview | null {
  const normalized = normalizeUsername(username);
  const preview = profilePreviews.get(normalized);
  if (!preview) return null;
  if (preview.expiresAt <= now) {
    profilePreviews.delete(normalized);
    return null;
  }
  return {
    avatarCacheRevision: preview.avatarCacheRevision,
    avatarMediaAssetId: preview.avatarMediaAssetId,
    avatarPlaceholder: preview.avatarPlaceholder,
    avatarThumbnailUrl: preview.avatarThumbnailUrl,
    displayName: preview.displayName,
    initials: preview.initials,
    username: preview.username
  };
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
  preview?: ProfileNavigationPreviewInput;
  queryClient: QueryClient;
  router: Pick<Router, "push">;
  username: string;
  viewerUsername: string;
}) {
  const username = normalizeUsername(input.username);
  if (!username || !claimProfileNavigation(username)) return false;

  const isSelf = username === normalizeUsername(input.viewerUsername);
  if (!isSelf) {
    if (input.preview) storeProfileNavigationPreview(username, input.preview);
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
    profilePreviews.delete(username);
    throw error;
  }

  setTimeout(() => releaseProfileNavigation(username), OPENING_GUARD_TIMEOUT_MS);
  return true;
}

export function recordProfileShellVisible(username: string) {
  const normalized = normalizeUsername(username);
  releaseProfileNavigation(normalized);
  profilePreviews.delete(normalized);
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
  profilePreviews.clear();
}

registerSensitiveResourceCleanup(clearProfileNavigationState);
