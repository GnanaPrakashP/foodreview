import * as FileSystem from "expo-file-system/legacy";
import type { AddMemoryMediaAsset } from "@/services/memories";

export type MemoryChatPlacementFixtureKind = "image" | "video";

function placementDiagnosticsEnabled() {
  return typeof __DEV__ !== "undefined" &&
    __DEV__ &&
    process.env.EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS === "1";
}

function localFixtureOrigin() {
  if (!placementDiagnosticsEnabled()) return null;
  const raw = process.env.EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "10.0.2.2"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function memoryChatPlacementFixtureKinds(): MemoryChatPlacementFixtureKind[] {
  if (!localFixtureOrigin()) return [];
  const raw = process.env.EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_KINDS ?? "";
  return Array.from(new Set(
    raw.split(",").map((value) => value.trim()).filter(
      (value): value is MemoryChatPlacementFixtureKind => value === "image" || value === "video"
    )
  ));
}

export function memoryChatPlacementFixtureStartDelayMs() {
  if (!placementDiagnosticsEnabled()) return 0;
  const requested = Number(process.env.EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_START_MS ?? 0);
  if (!Number.isFinite(requested) || requested < 0 || requested > 10_000) return 0;
  return Math.floor(requested);
}

export function memoryChatPlacementStaleRefreshDelayMs() {
  if (!placementDiagnosticsEnabled()) return null;
  const requested = Number(process.env.EXPO_PUBLIC_CHAT_PLACEMENT_STALE_REFRESH_MS ?? 0);
  if (!Number.isFinite(requested) || requested < 100 || requested > 5_000) return null;
  return Math.floor(requested);
}

export async function downloadMemoryChatPlacementFixture(
  kind: MemoryChatPlacementFixtureKind
): Promise<AddMemoryMediaAsset> {
  const origin = localFixtureOrigin();
  if (!origin || !FileSystem.cacheDirectory) {
    throw new Error("chat_placement_fixture_unavailable");
  }
  const extension = kind === "video" ? "mp4" : "png";
  const destination = `${FileSystem.cacheDirectory}chat-placement-${kind}-${Date.now()}.${extension}`;
  const result = await FileSystem.downloadAsync(
    `${origin}/${kind}.${extension}`,
    destination
  );
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error("chat_placement_fixture_download_failed");
  }
  return kind === "video"
    ? {
      duration: 1,
      fileSize: null,
      imageHeight: 64,
      imageWidth: 64,
      mediaMimeType: "video/mp4",
      mediaType: "video",
      mediaUri: destination
    }
    : {
      duration: null,
      fileSize: null,
      imageHeight: 64,
      imageMimeType: "image/png",
      imageWidth: 64,
      mediaMimeType: "image/png",
      mediaType: "image",
      mediaUri: destination
    };
}
