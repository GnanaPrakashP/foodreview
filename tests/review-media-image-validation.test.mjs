import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";

const cryptoModule = await import("node:crypto");
const source = readFileSync(new URL("../lib/server/review-media.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
});

const mod = { exports: {} };
vm.runInNewContext(outputText, {
  Buffer,
  module: mod,
  exports: mod.exports,
  require(id) {
    if (id === "node:crypto") return cryptoModule;
    if (id === "sharp") return sharp;
    throw new Error(`Unexpected require in review media image tests: ${id}`);
  }
});

const {
  REVIEW_IMAGE_OUTPUT_MIME_TYPE,
  normalizeAndValidateReviewImage,
  normalizeReviewMediaIntentInput,
  reviewMediaMaxBytes
} = mod.exports;

async function imageBuffer(format, options = {}) {
  const image = sharp({
    create: {
      background: options.background ?? { b: 80, g: 40, r: 200 },
      channels: options.channels ?? 3,
      height: options.height ?? 20,
      width: options.width ?? 20
    }
  });
  const pipeline = format === "png"
    ? image.png()
    : format === "webp"
      ? image.webp()
      : image.jpeg();
  return options.metadata ? pipeline.withMetadata().toBuffer() : pipeline.toBuffer();
}

test("review media image validation decodes JPEG, re-encodes to metadata-free JPEG", async () => {
  const input = await imageBuffer("jpeg", { metadata: true });
  const output = await normalizeAndValidateReviewImage({
    buffer: input,
    category: "post",
    expectedMimeType: "image/jpeg",
    maxOutputBytes: reviewMediaMaxBytes("post", "image")
  });

  assert.equal(output.mimeType, REVIEW_IMAGE_OUTPUT_MIME_TYPE);
  assert.equal(output.width, 20);
  assert.equal(output.height, 20);
  const metadata = await sharp(output.buffer).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
});

test("review media image validation accepts PNG input but emits controlled JPEG output", async () => {
  const input = await imageBuffer("png");
  const output = await normalizeAndValidateReviewImage({
    buffer: input,
    category: "avatar",
    expectedMimeType: "image/png",
    maxOutputBytes: reviewMediaMaxBytes("avatar", "image")
  });

  assert.equal(output.mimeType, "image/jpeg");
  assert.equal((await sharp(output.buffer).metadata()).format, "jpeg");
});

test("review media image validation rejects MIME spoofing, corrupt data, zero bytes, and huge dimensions", async () => {
  const jpeg = await imageBuffer("jpeg");
  await assert.rejects(
    normalizeAndValidateReviewImage({
      buffer: jpeg,
      category: "post",
      expectedMimeType: "image/png",
      maxOutputBytes: reviewMediaMaxBytes("post", "image")
    }),
    /review_media_detected_mime_type_mismatch/
  );

  await assert.rejects(
    normalizeAndValidateReviewImage({
      buffer: Buffer.from("not an image"),
      category: "post",
      expectedMimeType: "image/jpeg",
      maxOutputBytes: reviewMediaMaxBytes("post", "image")
    }),
    /review_media_image_decode_failed/
  );

  await assert.rejects(
    normalizeAndValidateReviewImage({
      buffer: Buffer.alloc(0),
      category: "post",
      expectedMimeType: "image/jpeg",
      maxOutputBytes: reviewMediaMaxBytes("post", "image")
    }),
    /review_media_file_size_invalid/
  );

  const huge = await imageBuffer("png", { height: 1, width: 6001 });
  await assert.rejects(
    normalizeAndValidateReviewImage({
      buffer: huge,
      category: "post",
      expectedMimeType: "image/png",
      maxOutputBytes: reviewMediaMaxBytes("post", "image")
    }),
    /review_media_image_dimensions_too_large/
  );
});

test("review media intent validation rejects HEIC and one byte above the image limit", () => {
  assert.throws(
    () => normalizeReviewMediaIntentInput({
      category: "post",
      fileName: "media.heic",
      fileSizeBytes: 100,
      mediaKind: "image",
      mimeType: "image/heic"
    }),
    /review_media_mime_type_not_allowed/
  );

  assert.throws(
    () => normalizeReviewMediaIntentInput({
      category: "post",
      fileName: "media.jpg",
      fileSizeBytes: reviewMediaMaxBytes("post", "image") + 1,
      mediaKind: "image",
      mimeType: "image/jpeg"
    }),
    /review_media_file_too_large/
  );
});

test("review media intent validation rejects videos until trusted transcoding exists", () => {
  assert.throws(
    () => normalizeReviewMediaIntentInput({
      category: "post",
      fileName: "media.mp4",
      fileSizeBytes: 100,
      mediaKind: "video",
      mimeType: "video/mp4"
    }),
    /review_media_video_not_supported/
  );
});
