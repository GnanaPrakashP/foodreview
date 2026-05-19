import type { Review, ReviewMedia, ReviewMediaType } from "@/lib/types";

function guessMediaType(url: string): ReviewMediaType {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (/\.(mp4|webm|mov|m4v)$/.test(pathname)) return "video";
  } catch {
    if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return "video";
  }
  return "image";
}

export function reviewMediaItems(review: Review): ReviewMedia[] {
  if (review.media_items?.length) return review.media_items;

  const urls = review.photo_urls?.length
    ? review.photo_urls
    : review.photo_url
    ? [review.photo_url]
    : [];

  return urls.map((url, position) => ({
    public_url: url,
    media_type: guessMediaType(url),
    position,
  }));
}

export function primaryReviewMediaUrl(review: Review): string | null {
  return reviewMediaItems(review)[0]?.public_url ?? null;
}
