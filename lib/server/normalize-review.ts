import type { Review, ReviewMedia, ReviewMediaType } from "@/lib/types";

type RawReviewPhoto = {
  public_url: string;
  media_type?: ReviewMediaType | null;
  position: number;
};

// Raw shape returned by Supabase when review_photos is included via relational select.
type RawReview = Review & {
  review_photos?: RawReviewPhoto[] | null;
};

// Converts a raw Supabase row (with review_photos relation) into the canonical Review shape.
// Falls back to legacy photo_url for reviews created before the review_photos table.
export function normalizeReview(raw: RawReview): Review {
  const mediaItems: ReviewMedia[] = (raw.review_photos ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      public_url: p.public_url,
      media_type: p.media_type === "video" ? "video" : "image",
      position: p.position,
    }));

  const photo_urls =
    mediaItems.length > 0
      ? mediaItems.map((item) => item.public_url)
      : raw.photo_urls?.length
      ? raw.photo_urls
      : raw.photo_url
      ? [raw.photo_url]
      : [];
  const normalizedMediaItems =
    mediaItems.length > 0
      ? mediaItems
      : photo_urls.map((url, position) => ({ public_url: url, media_type: "image" as const, position }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { review_photos: _dropped, ...rest } = raw as RawReview & { review_photos?: unknown };
  return {
    ...rest,
    items: Array.isArray(rest.items) ? rest.items : [],
    tags: Array.isArray(rest.tags) ? rest.tags : [],
    photo_urls,
    media_items: normalizedMediaItems
  } as Review;
}
