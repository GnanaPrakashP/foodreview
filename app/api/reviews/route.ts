import { NextRequest, NextResponse } from "next/server";
import { recordAccountMediaCleanupJob } from "@/lib/server/account-media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidVisibility, normalizeReviewItems, validateReviewBody } from "@/lib/server/review-validation";
import { refreshUserReputationFoundation } from "@/lib/server/reputation";
import { REVIEW_MEDIA_BUCKET, REVIEW_POST_MAX_ITEMS, type ReviewMediaKind } from "@/lib/server/review-media";

const MAX_REVIEW_VIDEO_DURATION_SECONDS = 10;
const MAX_REVIEW_TAGS = 5;
const MAX_REVIEW_TAG_LENGTH = 28;

type FinalizedReviewMediaIntent = {
  category: "post" | "avatar";
  file_size_bytes: number;
  id: string;
  media_type: ReviewMediaKind;
  mime_type: string;
  status: string;
  storage_path: string;
  user_id: string;
  user_name: string;
};

type ValidatedReviewMedia = {
  durationSeconds?: number;
  height?: number;
  intentId: string;
  mediaType: ReviewMediaKind;
  mimeType: string;
  publicUrl: string;
  sizeBytes: number;
  storagePath: string;
  width?: number;
};

async function cleanupUnusedReviewMedia(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  media: ValidatedReviewMedia[]
) {
  const storagePaths = Array.from(new Set(media.map((item) => item.storagePath).filter(Boolean)));
  const intentIds = Array.from(new Set(media.map((item) => item.intentId).filter(Boolean)));

  if (storagePaths.length > 0) {
    const { error } = await admin.storage.from(REVIEW_MEDIA_BUCKET).remove(storagePaths);
    if (error) await recordAccountMediaCleanupJob(admin, {
      bucketId: REVIEW_MEDIA_BUCKET,
      error,
      paths: storagePaths,
      userId
    });
  }
  if (intentIds.length > 0) {
    await admin
      .from("review_media_upload_intents")
      .update({ status: "abandoned" })
      .in("id", intentIds)
      .eq("user_id", userId)
      .eq("status", "finalized");
  }
}

function normalizeReviewTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/^#/, "").replace(/\s+/g, " ");
    if (!tag || tag.length > MAX_REVIEW_TAG_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_REVIEW_TAGS) break;
  }
  return tags;
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const {
    restaurantName,
    items,
    body: reviewBody,
    visibility = "public",
    photos,
    media,
    area,
    restaurantId,
    restaurantAddress,
    restaurantLat,
    restaurantLng,
    tags,
  } = body;

  type IncomingMedia = {
    durationSeconds?: unknown;
    height?: unknown;
    intentId?: unknown;
    width?: unknown;
    mediaType?: unknown;
  };
  const incomingMedia = Array.isArray(media) ? media : photos;
  if (Array.isArray(incomingMedia) && incomingMedia.length > REVIEW_POST_MAX_ITEMS) {
    return NextResponse.json({ error: `Maximum ${REVIEW_POST_MAX_ITEMS} media items allowed` }, { status: 400 });
  }

  const incomingMediaItems: IncomingMedia[] =
    Array.isArray(incomingMedia)
      ? (incomingMedia as unknown[]).filter(
          (p): p is IncomingMedia =>
            p !== null &&
            typeof p === "object" &&
            typeof (p as IncomingMedia).intentId === "string" &&
            ((p as IncomingMedia).mediaType === "video" || (p as IncomingMedia).mediaType === "image" || (p as IncomingMedia).mediaType === undefined)
        )
      : [];

  if (!restaurantName?.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const normalizedItems = normalizeReviewItems(items);
  if (normalizedItems.error) {
    return NextResponse.json({ error: normalizedItems.error }, { status: 400 });
  }

  if (!isValidVisibility(visibility)) {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  const normalizedBody = validateReviewBody(reviewBody);
  if (normalizedBody.error) {
    return NextResponse.json({ error: normalizedBody.error }, { status: 400 });
  }
  const normalizedTags = normalizeReviewTags(tags);

  if (incomingMediaItems.length === 0) {
    return NextResponse.json({ error: "Add at least one photo or video" }, { status: 400 });
  }
  if (incomingMediaItems.some((item) => item.mediaType === "video")) {
    return NextResponse.json({ error: "Video uploads are temporarily unavailable" }, { status: 400 });
  }
  const oversizedVideo = incomingMediaItems.find(
    (item) =>
      item.mediaType === "video" &&
      (typeof item.durationSeconds !== "number" ||
        !Number.isFinite(item.durationSeconds) ||
        item.durationSeconds <= 0 ||
        item.durationSeconds > MAX_REVIEW_VIDEO_DURATION_SECONDS)
  );
  if (oversizedVideo) {
    return NextResponse.json({ error: "Videos must be 10 seconds or less" }, { status: 400 });
  }

  // reviewer_name is always derived from the authenticated session — never from the request body
  const writeDb = createAdminClient();
  const validatedMedia = await loadFinalizedReviewMedia(writeDb, actor, incomingMediaItems);
  if (!validatedMedia.ok) {
    return NextResponse.json({ error: validatedMedia.error }, { status: validatedMedia.status });
  }

  const { data, error } = await writeDb
    .from("reviews")
    .insert({
      reviewer_name: actor.actorName,
      restaurant_name: restaurantName.trim(),
      items: normalizedItems.items,
      body: normalizedBody.body ?? null,
      tags: normalizedTags,
      visibility,
      photo_url: validatedMedia.media[0].publicUrl,
      photo_urls: validatedMedia.media.map((item) => item.publicUrl),
      area: area?.trim() || null,
      restaurant_id: restaurantId ?? null,
      restaurant_address: restaurantAddress?.trim() || null,
      restaurant_lat: typeof restaurantLat === "number" ? restaurantLat : null,
      restaurant_lng: typeof restaurantLng === "number" ? restaurantLng : null,
    })
    .select("id")
    .single();

  if (error) {
    await cleanupUnusedReviewMedia(writeDb, actor.userId, validatedMedia.media);
    return NextResponse.json({ error: "Could not create review" }, { status: 500 });
  }

  // Insert review_photos rows (position = index in the array). The table name is
  // legacy; rows can now represent either images or videos.
  if (validatedMedia.media.length > 0) {
    const mediaRows = validatedMedia.media.map((p, i) => ({
      file_size_bytes: p.sizeBytes,
      mime_type: p.mimeType,
      owner_id: actor.userId,
      review_id: data.id,
      storage_path: p.storagePath,
      public_url: p.publicUrl,
      media_type: p.mediaType,
      width: typeof p.width === "number" ? p.width : null,
      height: typeof p.height === "number" ? p.height : null,
      size_bytes: p.sizeBytes,
      upload_intent_id: p.intentId,
      position: i,
    }));
    let { error: photoError } = await writeDb.from("review_photos").insert(mediaRows);
    if (photoError && /media_type|schema cache|column/i.test(photoError.message)) {
      const legacyRows = mediaRows.map((row) => ({
        height: row.height,
        position: row.position,
        public_url: row.public_url,
        review_id: row.review_id,
        size_bytes: row.size_bytes,
        storage_path: row.storage_path,
        width: row.width
      }));
      const retry = await writeDb.from("review_photos").insert(legacyRows);
      photoError = retry.error;
    }
    if (photoError) {
      await writeDb.from("reviews").delete().eq("id", data.id);
      await cleanupUnusedReviewMedia(writeDb, actor.userId, validatedMedia.media);
      return NextResponse.json({ error: "Could not attach review media" }, { status: 500 });
    }
    const { error: consumeError } = await writeDb
      .from("review_media_upload_intents")
      .update({ status: "consumed" })
      .in("id", validatedMedia.media.map((item) => item.intentId))
      .eq("user_id", actor.userId)
      .eq("category", "post")
      .eq("status", "finalized");
    if (consumeError) {
      await writeDb.from("reviews").delete().eq("id", data.id);
      await cleanupUnusedReviewMedia(writeDb, actor.userId, validatedMedia.media);
      return NextResponse.json({ error: "Could not attach review media" }, { status: 500 });
    }
  }

  invalidateSocialCachesForNames([actor.actorName]);
  try {
    await refreshUserReputationFoundation(writeDb, actor.userId);
  } catch (error) {
    console.error("[reviews] Failed to refresh reputation:", error);
  }
  return NextResponse.json({ id: data.id });
}

async function loadFinalizedReviewMedia(
  admin: ReturnType<typeof createAdminClient>,
  actor: NonNullable<Awaited<ReturnType<typeof getRouteActor>>["actor"]>,
  incomingMedia: Array<{
    durationSeconds?: unknown;
    height?: unknown;
    intentId?: unknown;
    mediaType?: unknown;
    width?: unknown;
  }>
): Promise<
  | { ok: true; media: ValidatedReviewMedia[] }
  | { ok: false; error: string; status: number }
> {
  const intentIds = incomingMedia
    .map((item) => typeof item.intentId === "string" ? item.intentId.trim() : "")
    .filter(Boolean);
  const uniqueIntentIds = Array.from(new Set(intentIds));
  if (intentIds.length !== incomingMedia.length || uniqueIntentIds.length !== intentIds.length) {
    return { ok: false, error: "Invalid review media", status: 400 };
  }

  const { data, error } = await admin
    .from("review_media_upload_intents")
    .select("id, user_id, user_name, category, media_type, mime_type, file_size_bytes, storage_path, status")
    .in("id", uniqueIntentIds)
    .returns<FinalizedReviewMediaIntent[]>();
  if (error) return { ok: false, error: "Could not verify review media", status: 500 };

  const intentsById = new Map((data ?? []).map((intent) => [intent.id, intent]));
  const verified: ValidatedReviewMedia[] = [];
  for (const item of incomingMedia) {
    const intentId = typeof item.intentId === "string" ? item.intentId.trim() : "";
    const intent = intentsById.get(intentId);
    if (
      !intent ||
      intent.user_id !== actor.userId ||
      intent.user_name !== actor.actorName ||
      intent.category !== "post" ||
      intent.status !== "finalized"
    ) {
      return { ok: false, error: "Review media is not authorized", status: 403 };
    }
    if (item.mediaType && item.mediaType !== intent.media_type) {
      return { ok: false, error: "Review media type mismatch", status: 400 };
    }
    if (intent.media_type === "video") {
      return { ok: false, error: "Video uploads are temporarily unavailable", status: 400 };
    }

    const { data: publicUrlData } = admin.storage.from(REVIEW_MEDIA_BUCKET).getPublicUrl(intent.storage_path);
    verified.push({
      durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
      height: typeof item.height === "number" ? item.height : undefined,
      intentId: intent.id,
      mediaType: intent.media_type,
      mimeType: intent.mime_type,
      publicUrl: publicUrlData.publicUrl,
      sizeBytes: intent.file_size_bytes,
      storagePath: intent.storage_path,
      width: typeof item.width === "number" ? item.width : undefined
    });
  }

  return { ok: true, media: verified };
}
