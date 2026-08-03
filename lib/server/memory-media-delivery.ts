import { MEMORY_MEDIA_BUCKET, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS } from "@/lib/memory-media-policy";
import {
  MEDIA_PRIVATE_BUCKET,
  MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS
} from "@/lib/server/media-delivery-contract";
import type { MediaDerivativeRow } from "@/lib/server/media-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_SOURCE_BUCKET = "media-sources";

type MemoryPhotoStorageRow = {
  id: string;
  media_asset_id: string | null;
  moderation_status: string | null;
  room_id: string;
  storage_path: string | null;
  uploader_id: string | null;
  uploader_name: string;
};

type MemoryMediaAssetRow = {
  access_class: string;
  consumed_at: string | null;
  id: string;
  media_type: "image" | "video";
  moderation_status: string;
  original_mime_type: string;
  owner_id: string;
  owner_name: string;
  privacy_state: string;
  source_bucket_id: string;
  source_storage_path: string;
  status: string;
  surface: string;
  uploaded_at: string | null;
  visibility: string;
};

function photosFromPayload(payload: JsonRecord) {
  return Array.isArray(payload.photos)
    ? payload.photos.filter((value): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
}

function withoutStoredMediaLocation(photo: JsonRecord) {
  const safePhoto = { ...photo };
  delete safePhoto.storage_path;
  delete safePhoto.public_url;
  return safePhoto;
}

function expectedDerivativePath(asset: MemoryMediaAssetRow, path: string) {
  return path.startsWith(`memories/${asset.owner_id}/${asset.id}/`) &&
    !path.includes("..") &&
    !path.includes("?") &&
    !path.includes("#");
}

function expectedSourcePath(asset: MemoryMediaAssetRow) {
  return new RegExp(
    `^sources/memory/${asset.owner_id}/${asset.id}/original\\.[A-Za-z0-9]+$`
  ).test(asset.source_storage_path);
}

/**
 * Signs only photo ids that were already returned by an actor-scoped room read.
 * The admin client never expands the caller's visible row set.
 */
export async function signMemoryPhotoPayload(payload: JsonRecord, roomId: string) {
  const photos = photosFromPayload(payload);
  const photoIds = Array.from(new Set(
    photos.map((photo) => typeof photo.id === "string" ? photo.id : "").filter((id) => UUID_PATTERN.test(id))
  ));
  if (photoIds.length === 0) {
    return { ...payload, photos: photos.map(withoutStoredMediaLocation) };
  }

  const admin = createAdminClient();
  const { data: storageRows, error: storageError } = await admin
    .from("shared_memory_photos")
    .select("id, room_id, uploader_id, uploader_name, storage_path, media_asset_id, moderation_status")
    .eq("room_id", roomId)
    .in("id", photoIds)
    .returns<MemoryPhotoStorageRow[]>();
  if (storageError) throw storageError;

  const photoById = new Map((storageRows ?? []).map((row) => [row.id, row]));
  const assetIds = Array.from(new Set(
    (storageRows ?? []).flatMap((row) => row.media_asset_id ? [row.media_asset_id] : [])
  ));
  const { data: assetRows, error: assetError } = assetIds.length > 0
    ? await admin
      .from("media_assets")
      .select("id, owner_id, owner_name, surface, media_type, status, access_class, visibility, privacy_state, moderation_status, consumed_at, source_bucket_id, source_storage_path, original_mime_type, uploaded_at")
      .in("id", assetIds)
      .returns<MemoryMediaAssetRow[]>()
    : { data: [], error: null };
  if (assetError) throw assetError;

  const assetsById = new Map((assetRows ?? []).map((asset) => [asset.id, asset]));
  const deliverableAssetIds = (storageRows ?? []).flatMap((photo) => {
    if (!photo.media_asset_id) return [];
    const asset = assetsById.get(photo.media_asset_id);
    if (
      !asset ||
      asset.surface !== "memory" ||
      asset.status !== "ready" ||
      asset.access_class !== "memory_private" ||
      asset.visibility !== "private" ||
      asset.privacy_state !== "stable" ||
      asset.moderation_status !== "approved" ||
      !asset.consumed_at ||
      asset.owner_id !== photo.uploader_id ||
      asset.owner_name !== photo.uploader_name ||
      photo.moderation_status !== "approved"
    ) return [];
    return [asset.id];
  });

  const { data: derivativeRows, error: derivativeError } = deliverableAssetIds.length > 0
    ? await admin
      .from("media_derivatives")
      .select("asset_id, kind, bucket_id, storage_path, public_url, mime_type, width, height, duration_ms, file_size_bytes, blurhash")
      .in("asset_id", Array.from(new Set(deliverableAssetIds)))
      .in("kind", ["canonical", "thumbnail", "poster"])
      .returns<MediaDerivativeRow[]>()
    : { data: [], error: null };
  if (derivativeError) throw derivativeError;

  const derivativesByAsset = new Map<string, MediaDerivativeRow[]>();
  for (const derivative of derivativeRows ?? []) {
    const asset = assetsById.get(derivative.asset_id);
    if (
      !asset ||
      derivative.bucket_id !== MEDIA_PRIVATE_BUCKET ||
      derivative.public_url !== null ||
      !expectedDerivativePath(asset, derivative.storage_path)
    ) continue;
    const existing = derivativesByAsset.get(derivative.asset_id) ?? [];
    existing.push(derivative);
    derivativesByAsset.set(derivative.asset_id, existing);
  }

  const pendingImageSourcePaths = (storageRows ?? []).flatMap((photo) => {
    if (!photo.media_asset_id || photo.moderation_status !== "approved") return [];
    const asset = assetsById.get(photo.media_asset_id);
    if (
      !asset ||
      asset.media_type !== "image" ||
      !["uploaded", "processing"].includes(asset.status) ||
      asset.surface !== "memory" ||
      asset.access_class !== "memory_private" ||
      asset.visibility !== "private" ||
      asset.privacy_state !== "stable" ||
      asset.source_bucket_id !== MEDIA_SOURCE_BUCKET ||
      !asset.uploaded_at ||
      asset.consumed_at ||
      asset.owner_id !== photo.uploader_id ||
      asset.owner_name !== photo.uploader_name ||
      !/^(?:image\/jpeg|image\/png|image\/webp)$/.test(asset.original_mime_type) ||
      !expectedSourcePath(asset)
    ) return [];
    return [asset.source_storage_path];
  });

  const legacyPaths = Array.from(new Set(
    (storageRows ?? []).flatMap((row) => row.media_asset_id || !row.storage_path ? [] : [row.storage_path])
  ));
  const privatePaths = Array.from(new Set(
    Array.from(derivativesByAsset.values()).flatMap((derivatives) => derivatives.map((item) => item.storage_path))
  ));
  const [
    { data: legacySigned, error: legacySignError },
    { data: privateSigned, error: privateSignError },
    { data: sourceSigned, error: sourceSignError }
  ] = await Promise.all([
    legacyPaths.length > 0
      ? admin.storage.from(MEMORY_MEDIA_BUCKET).createSignedUrls(legacyPaths, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: [], error: null }),
    privatePaths.length > 0
      ? admin.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrls(privatePaths, MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: [], error: null }),
    pendingImageSourcePaths.length > 0
      ? admin.storage.from(MEDIA_SOURCE_BUCKET).createSignedUrls(
        Array.from(new Set(pendingImageSourcePaths)),
        MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS
      )
      : Promise.resolve({ data: [], error: null })
  ]);
  if (legacySignError) throw legacySignError;
  if (privateSignError) throw privateSignError;
  if (sourceSignError) throw sourceSignError;

  const legacyUrlByPath = new Map(
    (legacySigned ?? []).filter((row) => row.signedUrl).map((row) => [row.path, row.signedUrl] as const)
  );
  const privateUrlByPath = new Map(
    (privateSigned ?? []).filter((row) => row.signedUrl).map((row) => [row.path, row.signedUrl] as const)
  );
  const sourceUrlByPath = new Map(
    (sourceSigned ?? []).filter((row) => row.signedUrl).map((row) => [row.path, row.signedUrl] as const)
  );
  const legacyExpiresAt = new Date(Date.now() + MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const privateExpiresAt = new Date(Date.now() + MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return {
    ...payload,
    photos: photos.map((photo) => {
      const row = typeof photo.id === "string" ? photoById.get(photo.id) : null;
      if (!row) return withoutStoredMediaLocation(photo);

      if (!row.media_asset_id) {
        const publicUrl = row.storage_path ? legacyUrlByPath.get(row.storage_path) ?? null : null;
        return {
          ...withoutStoredMediaLocation(photo),
          media_asset_id: null,
          poster_url: null,
          public_url: publicUrl,
          signed_url_expires_at: publicUrl ? legacyExpiresAt : null,
          thumbnail_url: null
        };
      }

      const derivatives = derivativesByAsset.get(row.media_asset_id) ?? [];
      const asset = assetsById.get(row.media_asset_id);
      const canonical = derivatives.find((item) => item.kind === "canonical");
      const thumbnail = derivatives.find((item) => item.kind === "thumbnail");
      const poster = derivatives.find((item) => item.kind === "poster");
      const canonicalUrl = canonical ? privateUrlByPath.get(canonical.storage_path) ?? null : null;
      const thumbnailUrl = thumbnail ? privateUrlByPath.get(thumbnail.storage_path) ?? null : null;
      const posterUrl = poster ? privateUrlByPath.get(poster.storage_path) ?? null : null;
      const pendingImageUrl = asset?.media_type === "image" && ["uploaded", "processing"].includes(asset.status)
        ? sourceUrlByPath.get(asset.source_storage_path) ?? null
        : null;
      const displayUrl = canonicalUrl ?? pendingImageUrl;
      return {
        ...withoutStoredMediaLocation(photo),
        blurhash: thumbnail?.blurhash ?? poster?.blurhash ?? canonical?.blurhash ?? null,
        file_size_bytes: canonical?.file_size_bytes ?? photo.file_size_bytes ?? null,
        image_height: canonical?.height ?? photo.image_height ?? null,
        image_width: canonical?.width ?? photo.image_width ?? null,
        media_asset_id: row.media_asset_id,
        mime_type: canonical?.mime_type ?? asset?.original_mime_type ?? photo.mime_type ?? null,
        poster_url: posterUrl,
        public_url: displayUrl,
        signed_url_expires_at: displayUrl ? privateExpiresAt : null,
        thumbnail_url: thumbnailUrl
      };
    })
  };
}
