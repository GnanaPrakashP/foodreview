/**
 * Backfills random food photos onto existing reviews that do not have media.
 *
 * Run:
 *   node scripts/backfill-random-review-photos.mjs
 *
 * Optional:
 *   LIMIT=6 node scripts/backfill-random-review-photos.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function hasMedia(review) {
  return Boolean(review.photo_url) || (Array.isArray(review.photo_urls) && review.photo_urls.length > 0);
}

function photoIndexForReview(review, index) {
  const key = `${review.id}:${review.restaurant_name}:${index}`;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % FOOD_PHOTO_IDS.length;
}

async function downloadImage(photoId) {
  const url = `https://images.unsplash.com/${photoId}?w=1080&h=1350&fit=crop&q=82`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unsplash ${response.status} for ${photoId}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function downloadImageForReview(review, index) {
  const startIndex = photoIndexForReview(review, index);
  let lastError;

  for (let offset = 0; offset < FOOD_PHOTO_IDS.length; offset++) {
    const photoId = FOOD_PHOTO_IDS[(startIndex + offset) % FOOD_PHOTO_IDS.length];
    try {
      return await downloadImage(photoId);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("No backfill image source was available");
}

async function uploadReviewPhoto(review, bytes, index) {
  const path = `public/backfill-${review.id}-${index}.jpg`;
  const { error } = await supabase.storage
    .from("review-photos")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage.from("review-photos").getPublicUrl(path);
  return { publicUrl, storagePath: path };
}

async function main() {
  const limit = Number.parseInt(process.env.LIMIT ?? "", 10);
  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("id, reviewer_name, restaurant_name, photo_url, photo_urls")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const targets = (reviews ?? []).filter((review) => !hasMedia(review));
  const selected = Number.isFinite(limit) && limit > 0 ? targets.slice(0, limit) : targets;

  console.log(`Found ${targets.length} reviews without media.`);
  console.log(`Backfilling ${selected.length} review${selected.length === 1 ? "" : "s"}.\n`);

  let updatedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const review = selected[i];
    console.log(`[${i + 1}/${selected.length}] ${review.reviewer_name} @ ${review.restaurant_name}`);

    try {
      const bytes = await downloadImageForReview(review, i);
      const photo = await uploadReviewPhoto(review, bytes, 0);

      const { error: updateError } = await supabase
        .from("reviews")
        .update({
          photo_url: photo.publicUrl,
          photo_urls: [photo.publicUrl],
        })
        .eq("id", review.id);

      if (updateError) throw updateError;
      updatedCount += 1;
      console.log(`  updated ${photo.storagePath}`);
    } catch (err) {
      failedCount += 1;
      console.error(`  failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. Updated ${updatedCount}, failed ${failedCount}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
