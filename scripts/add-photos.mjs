/**
 * Adds test food photos to circle friends' reviews.
 * Downloads images from Unsplash, uploads to Supabase storage, updates photo_url.
 *
 * Run: node scripts/add-photos.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Unsplash photo IDs matched to restaurant types (verified food photos)
const RESTAURANT_PHOTO = {
  "Murugan Idli Shop":        "photo-1630409346824-4f0e7b080087", // idli / south indian
  "Dindigul Thalappakatti":   "photo-1563379091339-03246963a8ef", // biryani
  "Nagi Ramen":               "photo-1569718212165-3a8278d5f624", // ramen bowl
  "Burma Burma":              "photo-1512058564366-18510be2db19", // asian noodles
  "Chettinad Kitchen":        "photo-1585937421612-70a008356fbe", // indian curry
  "Burger Lab":               "photo-1568901346375-23c9450c58cd", // burger
  "Pizza Roma":               "photo-1565299624946-b28f40a0ae38", // pizza
  "Shawarma Bros":            "photo-1561651823-34feb02250e4", // shawarma wrap
  "Madurai Mess":             "photo-1606491956689-2ea866880c84", // south indian thali
};

// Pick 2 reviews per friend to add photos to (keeps it realistic)
const CIRCLE_FRIENDS = ["Arjun Sharma", "Priya Nair", "Kiran Reddy", "Meera Pillai"];

async function downloadImage(unsplashId) {
  const url = `https://images.unsplash.com/${unsplashId}?w=800&q=80&fit=crop`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function main() {
  // Fetch all reviews for circle friends that have no photo yet
  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("id, reviewer_name, restaurant_name, photo_url")
    .in("reviewer_name", CIRCLE_FRIENDS)
    .is("photo_url", null)
    .order("created_at", { ascending: false });

  if (error) { console.error("Fetch error:", error); process.exit(1); }
  console.log(`Found ${reviews.length} reviews without photos.`);

  // Group by reviewer, pick up to 2 per friend
  const byFriend = {};
  for (const r of reviews) {
    if (!byFriend[r.reviewer_name]) byFriend[r.reviewer_name] = [];
    if (byFriend[r.reviewer_name].length < 2) byFriend[r.reviewer_name].push(r);
  }

  const targets = Object.values(byFriend).flat();
  console.log(`Will add photos to ${targets.length} reviews.\n`);

  for (const review of targets) {
    const photoId = RESTAURANT_PHOTO[review.restaurant_name];
    if (!photoId) {
      console.log(`⚠  No photo mapped for "${review.restaurant_name}" — skipping`);
      continue;
    }

    const storagePath = `public/test-${review.id}.jpg`;
    console.log(`📸 ${review.reviewer_name} @ ${review.restaurant_name}`);

    try {
      // Download
      const imgBytes = await downloadImage(photoId);
      console.log(`   Downloaded ${imgBytes.length} bytes`);

      // Upload to storage
      const { error: upErr } = await supabase.storage
        .from("review-photos")
        .upload(storagePath, imgBytes, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (upErr) throw upErr;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("review-photos")
        .getPublicUrl(storagePath);

      // Update review
      const { error: updErr } = await supabase
        .from("reviews")
        .update({ photo_url: publicUrl })
        .eq("id", review.id);
      if (updErr) throw updErr;

      console.log(`   ✅ Updated: ${publicUrl}\n`);
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
    }
  }

  console.log("Done!");
}

main();
