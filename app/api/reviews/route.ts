import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidVisibility, normalizeReviewItems, validateReviewBody } from "@/lib/server/review-validation";
import { refreshUserReputationFoundation } from "@/lib/server/reputation";

const MAX_REVIEW_MEDIA = 4;
const MAX_REVIEW_VIDEO_DURATION_SECONDS = 10;
const MAX_REVIEW_TAGS = 5;
const MAX_REVIEW_TAG_LENGTH = 28;

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
    photoUrl,
    photos,
    media,
    area,
    restaurantId,
    restaurantAddress,
    restaurantLat,
    restaurantLng,
    tags,
  } = body;

  // media is an array of uploaded image/video objects from the client.
  type IncomingMedia = {
    publicUrl?: unknown;
    storagePath?: unknown;
    width?: unknown;
    height?: unknown;
    sizeBytes?: unknown;
    mediaType?: unknown;
    durationSeconds?: unknown;
  };
  const incomingMedia = Array.isArray(media) ? media : photos;
  if (Array.isArray(incomingMedia) && incomingMedia.length > MAX_REVIEW_MEDIA) {
    return NextResponse.json({ error: `Maximum ${MAX_REVIEW_MEDIA} media items allowed` }, { status: 400 });
  }

  const validatedMedia: IncomingMedia[] =
    Array.isArray(incomingMedia)
      ? (incomingMedia as unknown[]).filter(
          (p): p is IncomingMedia =>
            p !== null &&
            typeof p === "object" &&
            typeof (p as IncomingMedia).publicUrl === "string" &&
            typeof (p as IncomingMedia).storagePath === "string" &&
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

  if (validatedMedia.length === 0) {
    return NextResponse.json({ error: "Add at least one photo or video" }, { status: 400 });
  }
  const oversizedVideo = validatedMedia.find(
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
  console.log("[reviews POST] actor.actorName:", actor.actorName, "restaurantName:", restaurantName?.trim());
  const writeDb = createAdminClient();
  const { data, error } = await writeDb
    .from("reviews")
    .insert({
      reviewer_name: actor.actorName,
      restaurant_name: restaurantName.trim(),
      items: normalizedItems.items,
      body: normalizedBody.body ?? null,
      tags: normalizedTags,
      visibility,
      photo_url: typeof photoUrl === "string" && photoUrl.trim() ? photoUrl : validatedMedia[0].publicUrl,
      photo_urls: validatedMedia.map((item) => item.publicUrl as string),
      area: area?.trim() || null,
      restaurant_id: restaurantId ?? null,
      restaurant_address: restaurantAddress?.trim() || null,
      restaurant_lat: typeof restaurantLat === "number" ? restaurantLat : null,
      restaurant_lng: typeof restaurantLng === "number" ? restaurantLng : null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Insert review_photos rows (position = index in the array). The table name is
  // legacy; rows can now represent either images or videos.
  if (validatedMedia.length > 0) {
    const mediaRows = validatedMedia.map((p, i) => ({
      review_id: data.id,
      storage_path: p.storagePath as string,
      public_url: p.publicUrl as string,
      media_type: p.mediaType === "video" ? "video" : "image",
      width: typeof p.width === "number" ? p.width : null,
      height: typeof p.height === "number" ? p.height : null,
      size_bytes: typeof p.sizeBytes === "number" ? p.sizeBytes : null,
      position: i,
    }));
    let { error: photoError } = await writeDb.from("review_photos").insert(mediaRows);
    if (photoError && /media_type|schema cache|column/i.test(photoError.message)) {
      const legacyRows = mediaRows.map(({ media_type: _mediaType, ...row }) => row);
      const retry = await writeDb.from("review_photos").insert(legacyRows);
      photoError = retry.error;
    }
    if (photoError) {
      console.error("[reviews] Failed to insert review media:", photoError.message);
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
