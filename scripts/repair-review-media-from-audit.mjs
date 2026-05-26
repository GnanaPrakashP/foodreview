/**
 * Repairs review media problems found by scripts/audit-review-media.mjs.
 *
 * Uses tmp/review-media-audit.json by default:
 *   - adds one food image to reviews with no media
 *   - replaces image URLs flagged as blank/white
 *
 * Run:
 *   node scripts/repair-review-media-from-audit.mjs
 *
 * Optional:
 *   LIMIT=20 node scripts/repair-review-media-from-audit.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, "../tmp/review-media-audit.json");
const BUCKET = "review-photos";

const FOOD_PHOTO_IDS = [
  "photo-1569718212165-3a8278d5f624",
  "photo-1512058564366-18510be2db19",
  "photo-1568901346375-23c9450c58cd",
  "photo-1565299624946-b28f40a0ae38",
  "photo-1606491956689-2ea866880c84",
  "photo-1585937421612-70a008356fbe",
  "photo-1551782450-a2132b4ba21d",
  "photo-1574894709920-11b28e7367e3",
  "photo-1547592180-85f173990554",
  "photo-1617093727343-374698b1b08d",
  "photo-1571066811602-716837d681de",
];

function loadEnv() {
  return Object.fromEntries(
    readFileSync(resolve(__dirname, "../.env.local"), "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const env = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hashIndex(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % FOOD_PHOTO_IDS.length;
}

async function downloadReplacementImage(key) {
  const start = hashIndex(key);
  let lastError;

  for (let offset = 0; offset < FOOD_PHOTO_IDS.length; offset++) {
    const photoId = FOOD_PHOTO_IDS[(start + offset) % FOOD_PHOTO_IDS.length];
    const url = `https://images.unsplash.com/${photoId}?w=1080&h=1350&fit=crop&q=82`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unsplash ${response.status}`);
      const original = Buffer.from(await response.arrayBuffer());
      return await sharp(original)
        .rotate()
        .resize(1080, 1350, { fit: "cover" })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No replacement image source worked");
}

async function uploadReplacement(reviewId, key, prefix) {
  const bytes = await downloadReplacementImage(key);
  const storagePath = `public/${prefix}-${reviewId}-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return { publicUrl, storagePath, sizeBytes: bytes.length };
}

async function fetchReview(reviewId) {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, reviewer_name, restaurant_name, photo_url, photo_urls")
    .eq("id", reviewId)
    .single();
  if (error) throw error;
  return data;
}

async function addMediaToMissingReview(review) {
  const photo = await uploadReplacement(review.id, `${review.id}:${review.restaurantName}`, "repair-missing");

  const { error: reviewError } = await supabase
    .from("reviews")
    .update({
      photo_url: photo.publicUrl,
      photo_urls: [photo.publicUrl],
    })
    .eq("id", review.id);
  if (reviewError) throw reviewError;

  const { error: photoError } = await supabase.from("review_photos").insert({
    review_id: review.id,
    storage_path: photo.storagePath,
    public_url: photo.publicUrl,
    media_type: "image",
    size_bytes: photo.sizeBytes,
    position: 0,
  });
  if (photoError) throw photoError;

  return photo;
}

function replaceUrlList(urls, oldUrl, newUrl) {
  return Array.isArray(urls)
    ? urls.map((url) => (url === oldUrl ? newUrl : url))
    : [];
}

async function replaceWhiteImage(use, oldUrl, imageIndex) {
  const review = await fetchReview(use.reviewId);
  const photo = await uploadReplacement(
    use.reviewId,
    `${use.reviewId}:${review.restaurant_name}:${imageIndex}`,
    "repair-white"
  );

  const nextPhotoUrl = review.photo_url === oldUrl ? photo.publicUrl : review.photo_url;
  const nextPhotoUrls = replaceUrlList(review.photo_urls, oldUrl, photo.publicUrl);

  const { error: reviewError } = await supabase
    .from("reviews")
    .update({
      photo_url: nextPhotoUrl,
      photo_urls: nextPhotoUrls,
    })
    .eq("id", use.reviewId);
  if (reviewError) throw reviewError;

  const { error: photoError } = await supabase
    .from("review_photos")
    .update({
      storage_path: photo.storagePath,
      public_url: photo.publicUrl,
      media_type: "image",
      size_bytes: photo.sizeBytes,
    })
    .eq("review_id", use.reviewId)
    .eq("public_url", oldUrl);
  if (photoError) throw photoError;

  return photo;
}

async function main() {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  const limit = Number.parseInt(process.env.LIMIT ?? "", 10);
  const limitEnabled = Number.isFinite(limit) && limit > 0;

  const missing = limitEnabled ? report.missingMedia.slice(0, limit) : report.missingMedia;
  const whiteProblems = report.imageProblems.filter((problem) => problem.reason === "white_image");
  const whiteUses = whiteProblems.flatMap((problem, problemIndex) =>
    problem.uses.map((use) => ({
      ...use,
      oldUrl: problem.url,
      imageIndex: problemIndex,
    }))
  );
  const whiteTargets = limitEnabled ? whiteUses.slice(0, limit) : whiteUses;

  let repairedMissing = 0;
  let repairedWhite = 0;
  let failed = 0;

  console.log(`Repairing ${missing.length} missing-media review${missing.length === 1 ? "" : "s"}.`);
  for (const review of missing) {
    process.stdout.write(`missing ${repairedMissing + failed + 1}/${missing.length}: ${review.id}\r`);
    try {
      await addMediaToMissingReview(review);
      repairedMissing += 1;
    } catch (error) {
      failed += 1;
      console.error(`\nfailed missing ${review.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (missing.length > 0) process.stdout.write("\n");

  console.log(`Repairing ${whiteTargets.length} white image use${whiteTargets.length === 1 ? "" : "s"}.`);
  for (const target of whiteTargets) {
    process.stdout.write(`white ${repairedWhite + 1}/${whiteTargets.length}: ${target.reviewId}\r`);
    try {
      await replaceWhiteImage(target, target.oldUrl, target.imageIndex);
      repairedWhite += 1;
    } catch (error) {
      failed += 1;
      console.error(`\nfailed white ${target.reviewId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (whiteTargets.length > 0) process.stdout.write("\n");

  console.log(`Done. Missing repaired: ${repairedMissing}. White repaired: ${repairedWhite}. Failed: ${failed}.`);
  if (failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
