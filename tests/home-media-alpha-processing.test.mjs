import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const processing = require("../lib/media-image-processing.cjs");
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function transparentInput(format = "png") {
  const image = sharp({
    create: { background: { r: 0, g: 0, b: 0, alpha: 0 }, channels: 4, height: 500, width: 400 }
  }).composite([{
    input: Buffer.from('<svg width="220" height="260" xmlns="http://www.w3.org/2000/svg"><rect width="220" height="260" rx="80" fill="#d94a28"/></svg>'),
    left: 90,
    top: 120
  }]);
  return format === "webp" ? image.webp({ lossless: true }).toBuffer() : image.png().toBuffer();
}

async function renderPost(input) {
  const oriented = sharp(input).rotate();
  const metadata = await oriented.clone().metadata();
  const normalized = processing.normalizeAlphaForJpeg(oriented, metadata);
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  const crop = processing.cropPixelsForRect(
    { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    width,
    height
  );
  return {
    hasAlpha: normalized.hasAlpha,
    rendered: await processing.renderMediaImageDerivatives("post", normalized.image.extract(crop))
  };
}

async function cornerRgb(buffer) {
  const pixel = await sharp(buffer).extract({ height: 20, left: 0, top: 0, width: 20 }).resize(1, 1).raw().toBuffer();
  return [pixel[0], pixel[1], pixel[2]];
}

function assertNeutral(actual) {
  const expected = processing.MEDIA_ALPHA_BACKGROUND;
  assert.ok(Math.abs(actual[0] - expected.r) <= 8, `${actual[0]} should be near ${expected.r}`);
  assert.ok(Math.abs(actual[1] - expected.g) <= 8, `${actual[1]} should be near ${expected.g}`);
  assert.ok(Math.abs(actual[2] - expected.b) <= 8, `${actual[2]} should be near ${expected.b}`);
  assert.ok(actual.some((channel) => channel > 200), "transparent pixels must not become black");
}

test("RGBA PNG and transparent WebP use the shared intentional neutral background", async () => {
  for (const format of ["png", "webp"]) {
    const output = await renderPost(await transparentInput(format));
    assert.equal(output.hasAlpha, true);
    for (const derivative of Object.values(output.rendered)) {
      if (derivative) assertNeutral(await cornerRgb(derivative.buffer));
    }
  }
});

test("transparent post derivatives retain exact 360x450, 720x900, and 1080x1350 geometry", async () => {
  const { rendered } = await renderPost(await transparentInput());
  assert.deepEqual([rendered.thumbnail.width, rendered.thumbnail.height], [360, 450]);
  assert.deepEqual([rendered.feed.width, rendered.feed.height], [720, 900]);
  assert.deepEqual([rendered.canonical.width, rendered.canonical.height], [1080, 1350]);
});

test("opaque JPEG bypasses flattening and keeps the existing encoding path", async () => {
  const input = await sharp({
    create: { background: { r: 110, g: 75, b: 45 }, channels: 3, height: 500, width: 400 }
  }).jpeg().toBuffer();
  const first = sharp(input).rotate();
  const metadata = await first.clone().metadata();
  const normalized = processing.normalizeAlphaForJpeg(first, metadata);
  assert.equal(normalized.hasAlpha, false);
  assert.equal(normalized.image, first);
  const normalizedResult = await processing.renderMediaImageDerivatives("post", normalized.image);
  const directResult = await processing.renderMediaImageDerivatives("post", sharp(input).rotate());
  assert.deepEqual(normalizedResult.feed.buffer, directResult.feed.buffer);
  assert.deepEqual(normalizedResult.thumbnail.buffer, directResult.thumbnail.buffer);
  assert.deepEqual(normalizedResult.canonical.buffer, directResult.canonical.buffer);
});

test("orientation normalization uses auto-oriented dimensions and JPEG outputs strip EXIF", async () => {
  const input = await sharp({
    create: { background: { r: 30, g: 130, b: 80 }, channels: 3, height: 300, width: 400 }
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const oriented = sharp(input).rotate();
  const metadata = await oriented.clone().metadata();
  assert.deepEqual(metadata.autoOrient, { height: 400, width: 300 });
  const crop = processing.cropPixelsForRect(
    { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    metadata.autoOrient.width,
    metadata.autoOrient.height
  );
  const rendered = await processing.renderMediaImageDerivatives("post", oriented.extract(crop));
  const outputMetadata = await sharp(rendered.feed.buffer).metadata();
  assert.equal(outputMetadata.width, 720);
  assert.equal(outputMetadata.height, 900);
  assert.equal(outputMetadata.orientation, undefined);
  assert.equal(outputMetadata.exif, undefined);
});

test("production worker, dataset generator, repair, and matched fixtures share one alpha implementation", () => {
  const worker = source("lib/server/media-pipeline.ts");
  const seed = source("scripts/seed-home-media-test-dataset.mjs");
  const repair = source("scripts/repair-alpha-media-derivatives.mjs");
  const fixtures = source("scripts/generate-home-media-alpha-fixtures.mjs");
  for (const implementation of [worker, seed, repair, fixtures]) {
    assert.match(implementation, /media-image-processing\.cjs/);
    assert.match(implementation, /normalizeAlphaForJpeg/);
  }
  assert.deepEqual(processing.MEDIA_ALPHA_BACKGROUND, { r: 245, g: 242, b: 236, alpha: 1 });
});

test("repair classification is selective, resumable, revisioned, and idempotent", () => {
  const oldRows = ["canonical", "feed", "thumbnail"].map((kind) => ({
    content_revision: 1,
    content_sha256: null,
    kind,
    processing_version: null
  }));
  assert.equal(processing.classifyAlphaRepairCandidate({ derivatives: oldRows, hasAlpha: false, surface: "post" }).status, "opaque");
  const candidate = processing.classifyAlphaRepairCandidate({ derivatives: oldRows, hasAlpha: true, surface: "post" });
  assert.deepEqual(candidate, { expectedRevision: 1, nextRevision: 2, status: "repair" });
  const digest = "a".repeat(64);
  const repairedRows = oldRows.map((row) => ({
    ...row,
    content_revision: 2,
    content_sha256: digest,
    processing_version: processing.MEDIA_IMAGE_PROCESSING_VERSION
  }));
  assert.equal(processing.classifyAlphaRepairCandidate({ derivatives: repairedRows, hasAlpha: true, surface: "post" }).status, "up-to-date");
  assert.equal(processing.classifyAlphaRepairCandidate({ derivatives: repairedRows.slice(0, 2), hasAlpha: true, surface: "post" }).status, "missing-derivatives");
  assert.match(
    processing.buildRevisedImageDerivativePath({ id: "asset", owner_id: "owner", surface: "post" }, "feed", 2),
    /private-posts\/owner\/asset\/feed\.r2\.jpg$/
  );
});

test("repair script is dry-run by default and commits metadata atomically without touching sources or links", () => {
  const repair = source("scripts/repair-alpha-media-derivatives.mjs");
  const migration = source("supabase/migrations/202607180005_alpha_media_derivative_repair.sql");
  assert.match(repair, /const apply = args\.get\("apply"\) === "true"/);
  assert.match(repair, /--apply requires --confirm=MEDIA_ALPHA_DERIVATIVE_REPAIR/);
  assert.match(repair, /commit_alpha_media_derivative_repair_v1/);
  assert.doesNotMatch(repair, /from\("review_photos"\).*\.(?:update|delete|insert)/s);
  assert.doesNotMatch(repair, /media-sources"\)\.upload|source_bucket_id\)\.upload/);
  assert.match(migration, /update public\.media_derivatives derivative[\s\S]*jsonb_to_recordset/);
  assert.match(migration, /content_sha256/);
  assert.match(migration, /content_revision/);
  assert.match(migration, /service_role_required/);
  assert.match(migration, /content_revision integer not null default 1/);
  assert.match(migration, /authorized_home_media_derivatives_v1[\s\S]*content_revision integer/);
});
