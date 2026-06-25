import { Platform } from "react-native";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { normalizeDishInput } from "@/services/dishNormalizer";
import { getCurrentUserProfile } from "@/services/profiles";
import { uploadReviewMedia } from "@/services/reviewMedia";
import type { FoodItem, Visibility } from "@/types/models";

const MAX_REVIEW_VIDEO_DURATION_MS = 10_000;

export type CreatePostMediaInput = {
  uri: string;
  mimeType?: string | null;
  mediaType?: "image" | "video";
  durationMs?: number | null;
  fileSize?: number | null;
  height?: number | null;
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
  restaurantName: string;
  restaurantId?: string | null;
  restaurantArea?: string | null;
  restaurantAddress?: string | null;
  restaurantLat?: number | null;
  restaurantLng?: number | null;
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
  for (const media of items) {
    if (resolveMediaType(media) === "video") {
      if (
        typeof media.durationMs !== "number" ||
        !Number.isFinite(media.durationMs) ||
        media.durationMs <= 0 ||
        media.durationMs > MAX_REVIEW_VIDEO_DURATION_MS
      ) {
        throw new Error("Videos must be 10 seconds or less");
      }
    }
  }
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
  intentId: string;
  mimeType: string;
  publicUrl: string;
  sizeBytes: number;
  storagePath: string;
  mediaType: "image" | "video";
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

// Returns a copy of the video with no audio track. react-native-compressor is a
// native module that isn't present in web/pre-rebuild clients, so we lazy-require
// it and fall back to the original uri (audio intact) if it's unavailable.
async function stripVideoAudio(uri: string): Promise<string> {
  if (Platform.OS === "web") return uri;
  try {
    const { Video } = require("react-native-compressor") as typeof import("react-native-compressor");
    return await Video.compress(uri, { compressionMethod: "auto", stripAudio: true });
  } catch {
    return uri;
  }
}

async function uploadOne(media: CreatePostMediaInput): Promise<UploadedMedia> {
  const mediaType = resolveMediaType(media);
  const uri = mediaType === "video" && media.muted ? await stripVideoAudio(media.uri) : media.uri;
  const uploaded = await uploadReviewMedia({
    category: "post",
    durationMs: media.durationMs,
    mediaKind: mediaType,
    mimeType: media.mimeType,
    uri
  });

  return {
    durationMs: media.durationMs ?? null,
    height: media.height ?? null,
    intentId: uploaded.intentId,
    mediaType,
    mimeType: uploaded.mimeType,
    publicUrl: uploaded.publicUrl,
    sizeBytes: uploaded.fileSizeBytes,
    storagePath: uploaded.storagePath,
    width: media.width ?? null
  };
}

async function createReviewViaApi(input: CreatePostInput, uploaded: UploadedMedia[]) {
  if (!apiBaseUrl && Platform.OS !== "web") throw new Error("Posting requires the API server.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before posting");

  const response = await fetch(apiUrl("/api/reviews"), {
    body: JSON.stringify({
      area: input.restaurantArea,
      body: input.caption,
      items: normalizedDishes(input),
      media: uploaded.map((item) => ({
        durationSeconds: item.durationMs ? item.durationMs / 1000 : undefined,
        height: item.height ?? undefined,
        intentId: item.intentId,
        mediaType: item.mediaType,
        width: item.width ?? undefined
      })),
      restaurantAddress: input.restaurantAddress,
      restaurantId: input.restaurantId,
      restaurantLat: input.restaurantLat,
      restaurantLng: input.restaurantLng,
      restaurantName: input.restaurantName,
      tags: input.tags,
      visibility: input.visibility
    }),
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
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

  const uploaded = await Promise.all(items.map((media) => uploadOne(media)));
  return createReviewViaApi(input, uploaded);
}
