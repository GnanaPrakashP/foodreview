import { stat } from "node:fs/promises";
import sharp from "sharp";
import mediaImageProcessing from "../lib/media-image-processing.cjs";

const { cropPixelsForRect, normalizeAlphaForJpeg, renderMediaImageDerivatives } = mediaImageProcessing;

const defaults = [
  "tmp/dish-categories/biryani-raw.png",
  "tmp/dish-categories/burger-raw.png",
  "tmp/dish-categories/paneer-raw.png"
];
const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const inputs = files.length > 0 ? files : defaults;
const measurements = [];

for (const file of inputs) {
  const input = sharp(file, { failOn: "error" }).rotate();
  const metadata = await input.clone().metadata();
  const width = metadata.autoOrient?.width ?? metadata.width ?? 0;
  const height = metadata.autoOrient?.height ?? metadata.height ?? 0;
  if (!width || !height) throw new Error(`invalid_image:${file}`);
  const crop = cropPixelsForRect({ height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 }, width, height);
  const normalized = normalizeAlphaForJpeg(input, metadata);
  const [derivatives, original] = await Promise.all([
    renderMediaImageDerivatives("post", normalized.image.extract(crop)),
    stat(file)
  ]);
  measurements.push({
    canonical1080x1350Bytes: derivatives.canonical.buffer.byteLength,
    feed720x900Bytes: derivatives.feed.buffer.byteLength,
    file,
    originalBytes: original.size,
    thumbnail360x450Bytes: derivatives.thumbnail.buffer.byteLength
  });
}

const average = (key) => Math.round(measurements.reduce((total, row) => total + row[key], 0) / measurements.length);
console.log(JSON.stringify({
  averages: {
    canonical1080x1350Bytes: average("canonical1080x1350Bytes"),
    feed720x900Bytes: average("feed720x900Bytes"),
    originalBytes: average("originalBytes"),
    thumbnail360x450Bytes: average("thumbnail360x450Bytes")
  },
  measurements
}, null, 2));
