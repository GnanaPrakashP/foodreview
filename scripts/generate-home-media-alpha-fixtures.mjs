#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import mediaImageProcessing from "../lib/media-image-processing.cjs";

const {
  MEDIA_ALPHA_BACKGROUND,
  MEDIA_IMAGE_PROCESSING_VERSION,
  cropPixelsForRect,
  normalizeAlphaForJpeg,
  renderMediaImageDerivatives
} = mediaImageProcessing;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "tmp/home-media-alpha-profile");
const SOURCE = path.join(ROOT, "mobile/assets/categories/dishes/biryani.png");

await mkdir(OUTPUT, { recursive: true, mode: 0o700 });

const cutoutSource = await sharp(SOURCE)
  .rotate()
  .resize(1200, 1500, {
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    fit: "contain",
    position: "centre"
  })
  .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
  .toBuffer();
await writeFile(path.join(OUTPUT, "transparent-cutout-source.png"), cutoutSource);

const fullFrameSource = await sharp({
  create: {
    background: { r: 171, g: 92, b: 45, alpha: 1 },
    channels: 4,
    height: 1500,
    width: 1200
  }
})
  .composite([{ input: cutoutSource, blend: "over" }])
  .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
  .toBuffer();
await writeFile(path.join(OUTPUT, "full-frame-source.png"), fullFrameSource);

async function renderCase(caseId, input, background) {
  const oriented = sharp(input, { failOn: "error", limitInputPixels: 80_000_001 }).rotate();
  const metadata = await oriented.clone().metadata();
  const image = background === "neutral"
    ? normalizeAlphaForJpeg(oriented, metadata).image
    : background === "black"
      ? oriented.flatten({ background: { r: 0, g: 0, b: 0, alpha: 1 } })
      : oriented;
  const crop = cropPixelsForRect(
    { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    metadata.autoOrient?.width ?? metadata.width,
    metadata.autoOrient?.height ?? metadata.height
  );
  const rendered = await renderMediaImageDerivatives("post", image.extract(crop));
  const measurements = {};
  for (const [kind, derivative] of Object.entries(rendered)) {
    if (!derivative) continue;
    const fileName = `${caseId}-${kind}.jpg`;
    await writeFile(path.join(OUTPUT, fileName), derivative.buffer);
    const decoded = await sharp(derivative.buffer).metadata();
    const corner = await sharp(derivative.buffer).extract({ height: 12, left: 0, top: 0, width: 12 }).resize(1, 1).raw().toBuffer();
    measurements[kind] = {
      bytes: derivative.buffer.byteLength,
      cornerRgb: [corner[0], corner[1], corner[2]],
      height: decoded.height,
      sha256: createHash("sha256").update(derivative.buffer).digest("hex"),
      width: decoded.width
    };
  }
  return measurements;
}

const report = {
  alphaBackground: MEDIA_ALPHA_BACKGROUND,
  cases: {
    oldBlackDiagnostic: await renderCase("A-old-black", cutoutSource, "black"),
    neutralProduction: await renderCase("B-neutral", cutoutSource, "neutral"),
    opaqueFullFrame: await renderCase("C-full-frame", fullFrameSource, "opaque")
  },
  processingVersion: MEDIA_IMAGE_PROCESSING_VERSION,
  sourceSha256: createHash("sha256").update(cutoutSource).digest("hex")
};
await writeFile(path.join(OUTPUT, "measurements.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: "tmp/home-media-alpha-profile", ...report }, null, 2));
