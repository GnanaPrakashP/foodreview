/**
 * Read-only audit for review media coverage and blank/white image assets.
 *
 * Checks:
 *   - every review has at least one media item, considering review_photos,
 *     photo_urls, and legacy photo_url
 *   - image media is reachable and not visually blank/white
 *
 * Run:
 *   node scripts/audit-review-media.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, "../tmp/review-media-audit.json");
const PAGE_SIZE = 1000;
const FETCH_TIMEOUT_MS = 15000;

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

function isActiveReview(review) {
  return (
    review.status === "active" &&
    review.deleted_at === null &&
    review.hidden_at === null &&
    review.reported_at === null
  );
}

function mediaForReview(review) {
  const items = [];
  const seen = new Set();

  for (const item of review.review_photos ?? []) {
    const url = typeof item?.public_url === "string" ? item.public_url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      mediaType: item.media_type === "video" ? "video" : "image",
      source: "review_photos",
    });
  }

  for (const url of review.photo_urls ?? []) {
    const cleanUrl = typeof url === "string" ? url.trim() : "";
    if (!cleanUrl || seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    items.push({
      url: cleanUrl,
      mediaType: guessMediaType(cleanUrl),
      source: "photo_urls",
    });
  }

  const legacyUrl = typeof review.photo_url === "string" ? review.photo_url.trim() : "";
  if (legacyUrl && !seen.has(legacyUrl)) {
    items.push({
      url: legacyUrl,
      mediaType: guessMediaType(legacyUrl),
      source: "photo_url",
    });
  }

  return items;
}

function guessMediaType(url) {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  return /\.(mp4|mov|webm|m4v)$/i.test(pathname) ? "video" : "image";
}

async function fetchBytes(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function imageAudit(url) {
  const bytes = await fetchBytes(url);
  const { data, info } = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize(32, 32, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixels = data.length / channels;
  let total = 0;
  let nearWhite = 0;
  const luminance = [];

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance.push(y);
    total += y;
    if (r >= 245 && g >= 245 && b >= 245) nearWhite += 1;
  }

  const mean = total / pixels;
  const variance = luminance.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels;
  const stddev = Math.sqrt(variance);
  const nearWhiteRatio = nearWhite / pixels;

  return {
    mean: Math.round(mean * 100) / 100,
    stddev: Math.round(stddev * 100) / 100,
    nearWhiteRatio: Math.round(nearWhiteRatio * 10000) / 10000,
    isWhite: mean >= 248 && stddev <= 6 && nearWhiteRatio >= 0.96,
  };
}

async function loadReviews() {
  const reviews = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("reviews")
      .select("id, reviewer_name, restaurant_name, photo_url, photo_urls, status, deleted_at, hidden_at, reported_at, review_photos(public_url, media_type, position)")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;
    reviews.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return reviews;
}

async function main() {
  const reviews = await loadReviews();
  const activeReviews = reviews.filter(isActiveReview);
  const missingMedia = reviews.filter((review) => mediaForReview(review).length === 0);
  const activeMissingMedia = activeReviews.filter((review) => mediaForReview(review).length === 0);
  const imageChecks = [];
  const imageProblems = [];
  const uniqueImages = new Map();

  for (const review of reviews) {
    for (const media of mediaForReview(review)) {
      if (media.mediaType !== "image") continue;
      if (!uniqueImages.has(media.url)) uniqueImages.set(media.url, []);
      uniqueImages.get(media.url).push({
        reviewId: review.id,
        reviewerName: review.reviewer_name,
        restaurantName: review.restaurant_name,
        active: isActiveReview(review),
        source: media.source,
      });
    }
  }

  let index = 0;
  for (const [url, uses] of uniqueImages.entries()) {
    index += 1;
    process.stdout.write(`Checking image ${index}/${uniqueImages.size}\r`);
    try {
      const audit = await imageAudit(url);
      imageChecks.push({ url, uses, ...audit });
      if (audit.isWhite) imageProblems.push({ reason: "white_image", url, uses, ...audit });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      imageProblems.push({ reason: "image_unreadable", url, uses, error: message });
    }
  }
  if (uniqueImages.size > 0) process.stdout.write("\n");

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      reviews: reviews.length,
      activeReviews: activeReviews.length,
      uniqueImages: uniqueImages.size,
      missingMedia: missingMedia.length,
      activeMissingMedia: activeMissingMedia.length,
      imageProblems: imageProblems.length,
      whiteImages: imageProblems.filter((item) => item.reason === "white_image").length,
      unreadableImages: imageProblems.filter((item) => item.reason === "image_unreadable").length,
    },
    missingMedia: missingMedia.map((review) => ({
      id: review.id,
      reviewerName: review.reviewer_name,
      restaurantName: review.restaurant_name,
      status: review.status,
      active: isActiveReview(review),
    })),
    imageProblems,
    imageChecks,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("Review media audit");
  console.log(`- Reviews: ${report.totals.reviews} (${report.totals.activeReviews} active)`);
  console.log(`- Missing media: ${report.totals.missingMedia} (${report.totals.activeMissingMedia} active)`);
  console.log(`- Unique images checked: ${report.totals.uniqueImages}`);
  console.log(`- White images: ${report.totals.whiteImages}`);
  console.log(`- Unreadable images: ${report.totals.unreadableImages}`);
  console.log(`- Report: ${REPORT_PATH}`);

  if (report.totals.activeMissingMedia > 0 || report.totals.whiteImages > 0 || report.totals.unreadableImages > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
