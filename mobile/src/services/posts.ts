import { Platform } from "react-native";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { normalizeDishInput } from "@/services/dishNormalizer";
import { getCurrentUserProfile } from "@/services/profiles";
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

function extensionFor(uri: string, mimeType?: string | null, mediaType: "image" | "video" = "image") {
  if (mimeType?.includes("quicktime")) return "mov";
  if (mimeType?.includes("webm")) return "webm";
  if (mimeType?.includes("mp4")) return "mp4";
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (mediaType === "video" && (ext === "mp4" || ext === "mov" || ext === "webm")) return ext;
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext;
  return mediaType === "video" ? "mp4" : "jpg";
}

function contentTypeFor(ext: string, mimeType?: string | null, mediaType: "image" | "video" = "image") {
  if (mimeType) return mimeType;
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return mediaType === "video" ? "video/mp4" : "image/jpeg";
}

async function blobFromUri(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected media");
  return response.blob();
}

type UploadedMedia = {
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

async function uploadOne(media: CreatePostMediaInput, userId: string): Promise<UploadedMedia> {
  const mediaType = resolveMediaType(media);
  const uri = mediaType === "video" && media.muted ? await stripVideoAudio(media.uri) : media.uri;
  const ext = extensionFor(uri, media.mimeType, mediaType);
  const contentType = contentTypeFor(ext, media.mimeType, mediaType);
  // Random suffix keeps parallel uploads in the same millisecond from colliding.
  const path = `public/mobile/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const blob = await blobFromUri(uri);

  const { error } = await supabase.storage
    .from("review-photos")
    .upload(path, blob, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("review-photos").getPublicUrl(path);
  return {
    durationMs: media.durationMs ?? null,
    height: media.height ?? null,
    mediaType,
    publicUrl: data.publicUrl,
    sizeBytes: media.fileSize ?? blob.size,
    storagePath: path,
    width: media.width ?? null
  };
}

async function createReviewViaApi(input: CreatePostInput, uploaded: UploadedMedia[]) {
  if (!apiBaseUrl) throw new Error("Video posts require the API server.");

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
        mediaType: item.mediaType,
        publicUrl: item.publicUrl,
        sizeBytes: item.sizeBytes,
        storagePath: item.storagePath,
        width: item.width ?? undefined
      })),
      photoUrl: uploaded[0]?.publicUrl,
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
  const hasVideo = items.some((media) => resolveMediaType(media) === "video");
  if (hasVideo && !apiBaseUrl) {
    throw new Error("Video posts require the API server.");
  }

  const uploaded = await Promise.all(items.map((media) => uploadOne(media, profile.id)));
  // Video (and any mixed set) goes through the API so typed review_photos rows
  // are written; all-image posts use the direct insert with every photo_url.
  if (hasVideo) {
    return createReviewViaApi(input, uploaded);
  }
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean);

  const { data, error } = await supabase
    .from("reviews")
    .insert({
      reviewer_name: profile.username,
      restaurant_id: input.restaurantId?.trim() || null,
      restaurant_name: input.restaurantName.trim(),
      area: input.restaurantArea?.trim() || null,
      restaurant_address: input.restaurantAddress?.trim() || null,
      restaurant_lat: typeof input.restaurantLat === "number" ? input.restaurantLat : null,
      restaurant_lng: typeof input.restaurantLng === "number" ? input.restaurantLng : null,
      items: normalizedDishes(input),
      body: input.caption.trim() || null,
      tags,
      visibility: input.visibility,
      photo_url: uploaded[0].publicUrl,
      photo_urls: uploaded.map((item) => item.publicUrl),
      status: "active"
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(error.message);
  return { id: data.id };
}
