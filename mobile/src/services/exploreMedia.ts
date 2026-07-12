import { supabase } from "@/api/supabase";

const TRUSTED_MEDIA_BUCKET_SEGMENTS = [
  "/storage/v1/object/public/media-public/",
  "/storage/v1/object/sign/media-public/",
  "/object/public/media-public/",
  "/object/sign/media-public/"
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_EXPLORE_SOURCE_ASPECT_RATIO = 0.5;

type ExploreMediaAssetRow = {
  id: string;
  media_type: string;
  original_height: number | null;
  original_width: number | null;
  status: string;
  surface: string;
  visibility: string;
};

type PhotoBearing = {
  photo: string | null;
};

export function trustedExplorePhotoUrl(value?: string | null) {
  const url = value?.trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    return TRUSTED_MEDIA_BUCKET_SEGMENTS.some((segment) => pathname.includes(segment)) ? url : null;
  } catch {
    return null;
  }
}

export function explorePhotoUrl(value?: string | null) {
  const url = value?.trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function mediaAssetIdFromExplorePhotoUrl(value?: string | null) {
  const url = trustedExplorePhotoUrl(value);
  if (!url) return null;

  try {
    const parts = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);
    const bucketIndex = parts.indexOf("media-public");
    if (bucketIndex < 0 || parts[bucketIndex + 1] !== "posts") return null;
    const assetId = parts[bucketIndex + 3] ?? "";
    return UUID_RE.test(assetId) ? assetId : null;
  } catch {
    return null;
  }
}

function hasExploreSafeSourceAspect(asset: Pick<ExploreMediaAssetRow, "original_height" | "original_width">) {
  const width = Number(asset.original_width);
  const height = Number(asset.original_height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return true;
  return Math.min(width, height) / Math.max(width, height) >= MIN_EXPLORE_SOURCE_ASPECT_RATIO;
}

function isEligibleExploreMediaAsset(asset: ExploreMediaAssetRow) {
  return asset.surface === "post"
    && asset.media_type === "image"
    && asset.status === "ready"
    && asset.visibility === "public"
    && hasExploreSafeSourceAspect(asset);
}

export async function eligibleExplorePhotoUrlSet(values: Array<string | null | undefined>) {
  const trustedUrls = Array.from(new Set(values.map(trustedExplorePhotoUrl).filter((url): url is string => Boolean(url))));
  const assetIds = Array.from(new Set(trustedUrls.map(mediaAssetIdFromExplorePhotoUrl).filter((id): id is string => Boolean(id))));
  if (assetIds.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("media_assets")
    .select("id, surface, media_type, status, visibility, original_width, original_height")
    .in("id", assetIds)
    .returns<ExploreMediaAssetRow[]>();
  if (error) return new Set<string>();

  const eligibleAssetIds = new Set((data ?? [])
    .filter(isEligibleExploreMediaAsset)
    .map((asset) => asset.id));
  return new Set(trustedUrls.filter((url) => {
    const assetId = mediaAssetIdFromExplorePhotoUrl(url);
    return Boolean(assetId && eligibleAssetIds.has(assetId));
  }));
}

export async function filterEligibleExplorePhotos<T extends PhotoBearing>(items: T[]) {
  const eligibleUrls = await eligibleExplorePhotoUrlSet(items.map((item) => item.photo));
  return items.map((item) => (
    item.photo && mediaAssetIdFromExplorePhotoUrl(item.photo) && !eligibleUrls.has(item.photo)
      ? { ...item, photo: null }
      : item
  )) as T[];
}
