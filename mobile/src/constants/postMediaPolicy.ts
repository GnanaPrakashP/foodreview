// Keep these values in sync with MAX_BYTES and MAX_VIDEO_DURATION_MS in
// lib/server/media-pipeline.ts. The server is authoritative; these exist so the
// device can refuse a file it already knows will be rejected, and so capture
// settings cannot produce one.
export const POST_IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const POST_VIDEO_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const POST_VIDEO_MAX_DURATION_MS = 30_000;

// A full-length post recording has to fit the byte ceiling above. At 1080p and
// 8 Mbps the camera produced roughly 1 MB per second, so a 30 s take was ~30 MB
// against a 20 MB limit — the app let you record something it could not post.
// 4.5 Mbps plus AAC audio lands a 30 s take near 17 MB, leaving room for the
// overshoot a device encoder is allowed on a complex scene. Resolution stays at
// 1080p: the post canonical is 1080x1350, so detail here is worth paying for.
export const POST_VIDEO_CAPTURE_QUALITY = "1080p" as const;
export const POST_VIDEO_CAPTURE_BITRATE = 4_500_000;

export function postMediaMaxUploadBytes(mediaKind: "image" | "video") {
  return mediaKind === "video" ? POST_VIDEO_MAX_UPLOAD_BYTES : POST_IMAGE_MAX_UPLOAD_BYTES;
}
