const MEDIA_ALPHA_BACKGROUND = Object.freeze({
  r: 245,
  g: 242,
  b: 236,
  alpha: 1
});

const MEDIA_IMAGE_PROCESSING_VERSION = "alpha-neutral-v1";
const MEDIA_POST_CANONICAL_WIDTH = 1080;
const MEDIA_POST_CANONICAL_HEIGHT = 1350;
const MEDIA_POST_THUMB_WIDTH = 360;
const MEDIA_POST_THUMB_HEIGHT = 450;
const MEDIA_POST_FEED_WIDTH = 720;
const MEDIA_POST_FEED_HEIGHT = 900;
const MEDIA_AVATAR_CANONICAL_SIZE = 512;
const MEDIA_AVATAR_THUMB_SIZE = 128;
const MEDIA_MEMORY_MAX_EDGE = 1600;
const MEDIA_MEMORY_THUMB_EDGE = 360;

function imageMetadataHasAlpha(metadata) {
  return metadata?.hasAlpha === true;
}

function normalizeAlphaForJpeg(image, metadata) {
  const hasAlpha = imageMetadataHasAlpha(metadata);
  return {
    hasAlpha,
    image: hasAlpha ? image.flatten({ background: MEDIA_ALPHA_BACKGROUND }) : image
  };
}

function normalizeCropRecord(value) {
  return {
    height: Math.max(0.000001, Number(value?.height ?? 1)),
    targetAspect: value?.targetAspect === null || value?.targetAspect === undefined
      ? null
      : Number(value.targetAspect),
    width: Math.max(0.000001, Number(value?.width ?? 1)),
    x: Math.max(0, Number(value?.x ?? 0)),
    y: Math.max(0, Number(value?.y ?? 0))
  };
}

function cropPixelsForRect(cropRect, width, height) {
  const crop = normalizeCropRecord(cropRect);
  if (width <= 0 || height <= 0) throw new Error("media_image_dimensions_too_large");

  let left = Math.max(0, Math.min(width - 1, Math.round(crop.x * width)));
  let top = Math.max(0, Math.min(height - 1, Math.round(crop.y * height)));
  let cropWidth = Math.max(1, Math.min(width - left, Math.round(crop.width * width)));
  let cropHeight = Math.max(1, Math.min(height - top, Math.round(crop.height * height)));

  if (crop.targetAspect && crop.targetAspect > 0) {
    const currentAspect = cropWidth / cropHeight;
    if (currentAspect > crop.targetAspect) {
      const nextWidth = Math.max(1, Math.round(cropHeight * crop.targetAspect));
      left += Math.floor((cropWidth - nextWidth) / 2);
      cropWidth = nextWidth;
    } else if (currentAspect < crop.targetAspect) {
      const nextHeight = Math.max(1, Math.round(cropWidth / crop.targetAspect));
      top += Math.floor((cropHeight - nextHeight) / 2);
      cropHeight = nextHeight;
    }
  }

  if (left + cropWidth > width) cropWidth = width - left;
  if (top + cropHeight > height) cropHeight = height - top;
  return { height: Math.max(1, cropHeight), left, top, width: Math.max(1, cropWidth) };
}

async function jpegResult(pipeline, options) {
  const result = await pipeline.jpeg(options).toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    height: result.info.height,
    width: result.info.width
  };
}

async function renderMediaImageDerivatives(surface, image) {
  const canonicalPipeline = surface === "post"
    ? image.clone().resize(MEDIA_POST_CANONICAL_WIDTH, MEDIA_POST_CANONICAL_HEIGHT, { fit: "fill" })
    : surface === "avatar"
      ? image.clone().resize(MEDIA_AVATAR_CANONICAL_SIZE, MEDIA_AVATAR_CANONICAL_SIZE, { fit: "fill" })
      : image.clone().resize({ fit: "inside", height: MEDIA_MEMORY_MAX_EDGE, width: MEDIA_MEMORY_MAX_EDGE, withoutEnlargement: true });
  const canonical = await jpegResult(canonicalPipeline, { mozjpeg: true, quality: 85 });

  const thumbnailPipeline = surface === "post"
    ? image.clone().resize(MEDIA_POST_THUMB_WIDTH, MEDIA_POST_THUMB_HEIGHT, { fit: "fill" })
    : surface === "avatar"
      ? image.clone().resize(MEDIA_AVATAR_THUMB_SIZE, MEDIA_AVATAR_THUMB_SIZE, { fit: "fill" })
      : image.clone().resize({ fit: "inside", height: MEDIA_MEMORY_THUMB_EDGE, width: MEDIA_MEMORY_THUMB_EDGE, withoutEnlargement: true });
  const thumbnail = await jpegResult(thumbnailPipeline, { mozjpeg: true, quality: 82 });

  const feed = surface === "post"
    ? await jpegResult(
        image.clone().resize(MEDIA_POST_FEED_WIDTH, MEDIA_POST_FEED_HEIGHT, { fit: "fill" }),
        { mozjpeg: true, progressive: true, quality: 82 }
      )
    : null;

  return { canonical, feed, thumbnail };
}

function requiredImageDerivativeKinds(surface) {
  return surface === "post" ? ["canonical", "feed", "thumbnail"] : ["canonical", "thumbnail"];
}

function buildRevisedImageDerivativePath(asset, kind, revision) {
  if (!Number.isSafeInteger(revision) || revision < 2) throw new Error("media_revision_invalid");
  const prefix = asset.surface === "avatar" ? "avatars" : asset.surface === "memory" ? "memories" : "private-posts";
  return `${prefix}/${asset.owner_id}/${asset.id}/${kind}.r${revision}.jpg`;
}

function classifyAlphaRepairCandidate({ derivatives, hasAlpha, surface }) {
  const requiredKinds = requiredImageDerivativeKinds(surface);
  if (!Array.isArray(derivatives) || requiredKinds.some((kind) => !derivatives.some((row) => row.kind === kind))) {
    return { status: "missing-derivatives" };
  }
  if (!hasAlpha) return { status: "opaque" };
  if (derivatives.every((row) =>
    row.processing_version === MEDIA_IMAGE_PROCESSING_VERSION &&
    Number.isSafeInteger(Number(row.content_revision)) &&
    Number(row.content_revision) >= 1 &&
    /^[0-9a-f]{64}$/.test(row.content_sha256 ?? "")
  )) return { status: "up-to-date" };
  const revisions = new Set(derivatives.map((row) => Number(row.content_revision ?? 1)));
  if (revisions.size !== 1) return { status: "revision-conflict" };
  const expectedRevision = revisions.values().next().value;
  return { expectedRevision, nextRevision: expectedRevision + 1, status: "repair" };
}

exports.MEDIA_ALPHA_BACKGROUND = MEDIA_ALPHA_BACKGROUND;
exports.MEDIA_IMAGE_PROCESSING_VERSION = MEDIA_IMAGE_PROCESSING_VERSION;
exports.MEDIA_POST_CANONICAL_WIDTH = MEDIA_POST_CANONICAL_WIDTH;
exports.MEDIA_POST_CANONICAL_HEIGHT = MEDIA_POST_CANONICAL_HEIGHT;
exports.MEDIA_POST_THUMB_WIDTH = MEDIA_POST_THUMB_WIDTH;
exports.MEDIA_POST_THUMB_HEIGHT = MEDIA_POST_THUMB_HEIGHT;
exports.MEDIA_POST_FEED_WIDTH = MEDIA_POST_FEED_WIDTH;
exports.MEDIA_POST_FEED_HEIGHT = MEDIA_POST_FEED_HEIGHT;
exports.MEDIA_AVATAR_CANONICAL_SIZE = MEDIA_AVATAR_CANONICAL_SIZE;
exports.MEDIA_AVATAR_THUMB_SIZE = MEDIA_AVATAR_THUMB_SIZE;
exports.MEDIA_MEMORY_MAX_EDGE = MEDIA_MEMORY_MAX_EDGE;
exports.MEDIA_MEMORY_THUMB_EDGE = MEDIA_MEMORY_THUMB_EDGE;
exports.buildRevisedImageDerivativePath = buildRevisedImageDerivativePath;
exports.classifyAlphaRepairCandidate = classifyAlphaRepairCandidate;
exports.cropPixelsForRect = cropPixelsForRect;
exports.imageMetadataHasAlpha = imageMetadataHasAlpha;
exports.normalizeAlphaForJpeg = normalizeAlphaForJpeg;
exports.renderMediaImageDerivatives = renderMediaImageDerivatives;
exports.requiredImageDerivativeKinds = requiredImageDerivativeKinds;
