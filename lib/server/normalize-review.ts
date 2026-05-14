import type { Review } from "@/lib/types";

type RawReviewPhoto = { public_url: string; position: number };

// Raw shape returned by Supabase when review_photos is included via relational select.
type RawReview = Omit<Review, "photo_urls"> & {
  review_photos?: RawReviewPhoto[] | null;
};

// Converts a raw Supabase row (with review_photos relation) into the canonical Review shape.
// Falls back to legacy photo_url for reviews created before the review_photos table.
export function normalizeReview(raw: RawReview): Review {
  const photos = (raw.review_photos ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((p) => p.public_url);

  const photo_urls =
    photos.length > 0
      ? photos
      : raw.photo_url
      ? [raw.photo_url]
      : [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { review_photos: _dropped, ...rest } = raw as RawReview & { review_photos?: unknown };
  return { ...rest, photo_urls } as Review;
}
