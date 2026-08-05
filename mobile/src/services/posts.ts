import { Platform } from "react-native";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { authorizedApiHeaders } from "@/api/client";
import { normalizeDishInput } from "@/services/dishNormalizer";
import {
  completeRecoveredMediaUploads,
  uploadPostMediaAsset,
  waitForReadyMediaAssets,
  type MediaCropRect
} from "@/services/mediaPipeline";
import { getCurrentUserProfile } from "@/services/profiles";
import type { FoodItem, Visibility } from "@/types/models";

export type CreatePostMediaInput = {
  uri: string;
  mimeType?: string | null;
  mediaType?: "image" | "video";
  durationMs?: number | null;
  fileSize?: number | null;
  height?: number | null;
  cropRect?: MediaCropRect | null;
  width?: number | null;
  // When true on a video, the audio track is stripped before upload.
  muted?: boolean;
};

export type CreatePostInput = {
  imageUri?: string;
  imageMimeType?: string | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "image" | "video";
  mediaDurationMs?: number | null;
  mediaFileSize?: number | null;
  mediaHeight?: number | null;
  mediaWidth?: number | null;
  // Preferred multi-media field. When present it supersedes the single media*
  // fields above (which remain for older single-capture callers).
  mediaItems?: CreatePostMediaInput[];
  onUploadProgress?: (progress: number) => void;
  restaurantName: string;
  restaurantId?: string | null;
  restaurantArea?: string | null;
  restaurantAddress?: string | null;
  restaurantLat?: number | null;
  restaurantLng?: number | null;
  restaurantPrimaryType?: string | null;
  restaurantTypes?: string[] | null;
  dishName: string;
  dishes?: FoodItem[];
  caption: string;
  rating: number;
  recommended: boolean;
  tags?: string[];
  visibility: Visibility;
};

export type CreatePostResult = {
  id: string;
};

function resolveMediaType(media: { mediaType?: "image" | "video"; mimeType?: string | null }) {
  return media.mediaType ?? (media.mimeType?.startsWith("video/") ? "video" : "image");
}

// Normalizes either the new `mediaItems` array or the legacy single media*
// fields into one list, so the rest of the pipeline only deals with an array.
function mediaInputs(input: CreatePostInput): CreatePostMediaInput[] {
  if (input.mediaItems?.length) {
    return input.mediaItems.filter((item) => item.uri);
  }
  const single = primaryMediaInput(input);
  if (!single.uri) return [];
  return [{
    durationMs: input.mediaDurationMs,
    fileSize: input.mediaFileSize,
    height: input.mediaHeight,
    mediaType: single.mediaType,
    mimeType: single.mimeType,
    uri: single.uri,
    width: input.mediaWidth
  }];
}

function validateInput(input: CreatePostInput) {
  const items = mediaInputs(input);
  if (items.length === 0) throw new Error("Choose a photo or video");
  if (!input.restaurantName.trim()) throw new Error("Restaurant name is required");
  const dishes = normalizedDishes(input);
  if (dishes.length === 0) throw new Error("Add at least one dish");
  if (dishes.some((dish) => !Number.isFinite(dish.rating) || dish.rating < 1 || dish.rating > 5)) {
    throw new Error("Select a rating");
  }
  if (input.caption.trim() && input.caption.trim().length < 5) {
    throw new Error("Caption must be at least 5 characters");
  }
}

function primaryMediaInput(input: CreatePostInput) {
  const mimeType = input.mediaMimeType ?? input.imageMimeType ?? null;
  const mediaType = input.mediaType ?? (mimeType?.startsWith("video/") ? "video" : "image");
  return {
    mediaType,
    mimeType,
    uri: input.mediaUri ?? input.imageUri ?? ""
  };
}

function normalizedDishes(input: CreatePostInput): FoodItem[] {
  const dishes = input.dishes?.length
    ? input.dishes
    : [{ name: input.dishName, rating: input.rating }];

  return dishes
    .map((dish) => {
      const normalization = normalizeDishInput(dish.name);
      return {
        name: normalization.canonicalVariantName ?? normalization.rawDishName,
        rawDishName: normalization.rawDishName,
        canonicalDishId: normalization.canonicalVariantId,
        canonicalDishName: normalization.canonicalVariantName,
        canonicalDishSource: normalization.canonicalSource,
        dishClusterKey: normalization.dishClusterKey,
        dishFamilyId: normalization.dishFamilyId,
        dishFamilyName: normalization.dishFamilyName,
        dishNormalizationConfidence: normalization.confidence,
        rating: Number(dish.rating)
      };
    })
    .filter((dish) => dish.rawDishName);
}

type UploadedMedia = {
  assetId?: string;
  mimeType: string;
  sizeBytes: number;
  mediaType: "image" | "video";
  recoveryId: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

async function uploadOneWithProgress(
  media: CreatePostMediaInput,
  visibility: Visibility,
  onUploadProgress?: (progress: number) => void
): Promise<UploadedMedia> {
  const mediaType = resolveMediaType(media);
  const uploaded = await uploadPostMediaAsset({
    cropRect: media.cropRect,
    // The batch waits for every asset together once all of them are queued.
    deferReadyWait: true,
    durationMs: media.durationMs,
    fileSize: media.fileSize,
    height: media.height,
    mediaKind: mediaType,
    mimeType: media.mimeType,
    muted: media.muted,
    intendedVisibility: visibility,
    onUploadProgress,
    width: media.width,
    uri: media.uri
  });

  return {
    assetId: uploaded.assetId,
    durationMs: media.durationMs ?? null,
    height: uploaded.height ?? media.height ?? null,
    mediaType,
    mimeType: uploaded.mimeType,
    recoveryId: uploaded.recoveryId,
    sizeBytes: uploaded.fileSizeBytes,
    width: uploaded.width ?? media.width ?? null
  };
}

// Uploads stay one at a time — they share one uplink, and the worker processes
// one asset at a time regardless — but no item waits for its own processing any
// more. Finalizing an upload is what queues the job, so item one is already
// transcoding while item two is still sending, and every asset is then awaited
// together in a single poll cadence.
const UPLOAD_PHASE_SHARE = 0.9;

async function uploadPostMediaItems(items: CreatePostMediaInput[], visibility: Visibility, onUploadProgress?: (progress: number) => void) {
  const uploaded: UploadedMedia[] = [];
  const total = Math.max(1, items.length);
  onUploadProgress?.(0);

  for (const [index, media] of items.entries()) {
    const item = await uploadOneWithProgress(media, visibility, (itemProgress) => {
      const itemShare = (index + Math.max(0, Math.min(itemProgress, 1))) / total;
      onUploadProgress?.(itemShare * UPLOAD_PHASE_SHARE);
    });
    uploaded.push(item);
    onUploadProgress?.(((index + 1) / total) * UPLOAD_PHASE_SHARE);
  }

  const ready = await waitForReadyMediaAssets(
    uploaded.map((item) => item.recoveryId),
    (waitProgress) => {
      onUploadProgress?.(UPLOAD_PHASE_SHARE + Math.max(0, Math.min(waitProgress, 1)) * (1 - UPLOAD_PHASE_SHARE));
    }
  );
  onUploadProgress?.(1);

  // The canonical derivative is authoritative for what was actually stored, so
  // adopt its dimensions and size exactly as the per-item wait used to.
  return uploaded.map((item) => {
    const canonical = ready.get(item.recoveryId);
    if (!canonical) return item;
    return {
      ...item,
      height: canonical.height ?? item.height,
      mimeType: canonical.mimeType,
      sizeBytes: canonical.fileSizeBytes,
      width: canonical.width ?? item.width
    };
  });
}

async function createReviewViaApi(input: CreatePostInput, uploaded: UploadedMedia[]) {
  if (!apiBaseUrl && Platform.OS !== "web") throw new Error("Posting requires the API server.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before posting");

  const authorizedHeaders = await authorizedApiHeaders("sharing a post", "POST");
  const stablePostKey = uploaded[0]?.assetId ? `post-${uploaded[0].assetId}` : authorizedHeaders["Idempotency-Key"];
  const response = await fetch(apiUrl("/api/reviews"), {
    body: JSON.stringify({
      area: input.restaurantArea,
      body: input.caption,
      items: normalizedDishes(input),
      media: uploaded.map((item) => ({
        assetId: item.assetId,
        durationSeconds: item.durationMs ? item.durationMs / 1000 : undefined,
        height: item.height ?? undefined,
        mediaType: item.mediaType,
        width: item.width ?? undefined
      })),
      restaurantAddress: input.restaurantAddress,
      restaurantId: input.restaurantId,
      restaurantLat: input.restaurantLat,
      restaurantLng: input.restaurantLng,
      restaurantName: input.restaurantName,
      restaurantPrimaryType: input.restaurantPrimaryType,
      restaurantTypes: input.restaurantTypes,
      tags: input.tags,
      visibility: input.visibility
    }),
    headers: {
      ...authorizedHeaders,
      ...(stablePostKey ? { "Idempotency-Key": stablePostKey } : {})
    },
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as { id?: string; error?: string } | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error ?? "Could not share post");
  }
  return { id: payload.id };
}

export async function createPost(input: CreatePostInput): Promise<CreatePostResult> {
  validateInput(input);

  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in before posting");

  const items = mediaInputs(input);
  if (!apiBaseUrl && Platform.OS !== "web") {
    throw new Error("Posting requires the API server.");
  }

  const uploaded = await uploadPostMediaItems(items, input.visibility, input.onUploadProgress);
  const created = await createReviewViaApi(input, uploaded);
  await completeRecoveredMediaUploads(uploaded.map((item) => item.recoveryId));
  return created;
}
