import type sharp from "sharp";

export const MEDIA_ALPHA_BACKGROUND: Readonly<{ r: 245; g: 242; b: 236; alpha: 1 }>;
export const MEDIA_IMAGE_PROCESSING_VERSION: "alpha-neutral-v1";
export const MEDIA_POST_CANONICAL_WIDTH: 1080;
export const MEDIA_POST_CANONICAL_HEIGHT: 1350;
export const MEDIA_POST_THUMB_WIDTH: 360;
export const MEDIA_POST_THUMB_HEIGHT: 450;
export const MEDIA_POST_FEED_WIDTH: 720;
export const MEDIA_POST_FEED_HEIGHT: 900;
export const MEDIA_AVATAR_CANONICAL_SIZE: 512;
export const MEDIA_AVATAR_THUMB_SIZE: 128;
export const MEDIA_MEMORY_MAX_EDGE: 1600;
export const MEDIA_MEMORY_THUMB_EDGE: 360;

export type ImageSurface = "post" | "avatar" | "memory";
export type RenderedImageDerivative = { buffer: Buffer; height: number; width: number };

export function imageMetadataHasAlpha(metadata: sharp.Metadata): boolean;
export function normalizeAlphaForJpeg(image: sharp.Sharp, metadata: sharp.Metadata): {
  hasAlpha: boolean;
  image: sharp.Sharp;
};
export function cropPixelsForRect(
  cropRect: Record<string, unknown>,
  width: number,
  height: number
): { height: number; left: number; top: number; width: number };
export function renderMediaImageDerivatives(surface: ImageSurface, image: sharp.Sharp): Promise<{
  canonical: RenderedImageDerivative;
  feed: RenderedImageDerivative | null;
  thumbnail: RenderedImageDerivative;
}>;
export function requiredImageDerivativeKinds(surface: ImageSurface): Array<"canonical" | "feed" | "thumbnail">;
export function buildRevisedImageDerivativePath(
  asset: { id: string; owner_id: string; surface: ImageSurface },
  kind: "canonical" | "feed" | "thumbnail",
  revision: number
): string;
export function classifyAlphaRepairCandidate(input: {
  derivatives: Array<{ kind: string; content_revision?: number | null; content_sha256?: string | null; processing_version?: string | null }>;
  hasAlpha: boolean;
  surface: ImageSurface;
}):
  | { status: "missing-derivatives" | "opaque" | "up-to-date" | "revision-conflict" }
  | { status: "repair"; expectedRevision: number; nextRevision: number };
