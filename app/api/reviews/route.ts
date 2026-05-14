import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidVisibility, normalizeReviewItems, validateReviewBody } from "@/lib/server/review-validation";

const MAX_REVIEW_PHOTOS = 4;

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor();
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
    area,
    restaurantId,
    restaurantAddress,
    restaurantLat,
    restaurantLng,
  } = body;

  // photos is an optional array of moderated photo objects from /api/photos/moderate
  type IncomingPhoto = {
    publicUrl?: unknown;
    storagePath?: unknown;
    width?: unknown;
    height?: unknown;
    sizeBytes?: unknown;
  };
  if (Array.isArray(photos) && photos.length > MAX_REVIEW_PHOTOS) {
    return NextResponse.json({ error: `Maximum ${MAX_REVIEW_PHOTOS} photos allowed` }, { status: 400 });
  }

  const validatedPhotos: IncomingPhoto[] =
    Array.isArray(photos)
      ? (photos as unknown[]).filter(
          (p): p is IncomingPhoto =>
            p !== null &&
            typeof p === "object" &&
            typeof (p as IncomingPhoto).publicUrl === "string" &&
            typeof (p as IncomingPhoto).storagePath === "string"
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
      visibility,
      photo_url: photoUrl ?? null,
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

  // Insert review_photos rows (position = index in the array)
  if (validatedPhotos.length > 0) {
    const photoRows = validatedPhotos.map((p, i) => ({
      review_id: data.id,
      storage_path: p.storagePath as string,
      public_url: p.publicUrl as string,
      width: typeof p.width === "number" ? p.width : null,
      height: typeof p.height === "number" ? p.height : null,
      size_bytes: typeof p.sizeBytes === "number" ? p.sizeBytes : null,
      position: i,
    }));
    const { error: photoError } = await writeDb.from("review_photos").insert(photoRows);
    if (photoError) {
      // Review was created — log and continue rather than failing the whole request
      console.error("[reviews] Failed to insert review_photos:", photoError.message);
    }
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ id: data.id });
}
