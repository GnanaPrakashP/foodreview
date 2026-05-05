/**
 * Adds multiple photos to a few circle friends' reviews for testing.
 * Run: node scripts/add-multi-photos.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env.local"), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 2-3 Unsplash photo IDs per restaurant type
const MULTI_PHOTOS = {
  "Burma Burma":            ["photo-1512058564366-18510be2db19", "photo-1569050467447-ce54b3bbc37d", "photo-1455619452474-d2be8b1e70cd"],
  "Burger Lab":             ["photo-1568901346375-23c9450c58cd", "photo-1551782450-a2132b4ba21d", "photo-1565299507177-b0ac66763828"],
  "Murugan Idli Shop":      ["photo-1630409346824-4f0e7b080087", "photo-1606491956689-2ea866880c84", "photo-1599487488170-d11ec9c172f0"],
  "Dindigul Thalappakatti": ["photo-1589302168068-964664d93dc0", "photo-1631452180519-c014fe946bc7", "photo-1574894709920-11b28e7367e3"],
  "Chettinad Kitchen":      ["photo-1585937421612-70a008356fbe", "photo-1547592180-85f173990554", "photo-1565557623262-b51c2513a641"],
  "Shawarma Bros":          ["photo-1561651823-34feb02250e4", "photo-1529193591184-b1d58069ecdd"],
  "Madurai Mess":           ["photo-1606491956689-2ea866880c84", "photo-1630409346824-4f0e7b080087"],
  "Nagi Ramen":             ["photo-1569718212165-3a8278d5f624", "photo-1617093727343-374698b1b08d"],
  "Pizza Roma":             ["photo-1565299624946-b28f40a0ae38", "photo-1571066811602-716837d681de"],
};

async function downloadImage(id) {
  const url = `https://images.unsplash.com/${id}?w=800&q=80&fit=crop`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${id}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function uploadPhoto(bytes, path) {
  const { error } = await supabase.storage.from("review-photos").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from("review-photos").getPublicUrl(path);
  return publicUrl;
}

async function main() {
  // Fetch reviews that already have a photo_url (our test posts)
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, reviewer_name, restaurant_name, photo_url")
    .in("reviewer_name", ["Arjun Sharma", "Priya Nair", "Kiran Reddy", "Meera Pillai"])
    .not("photo_url", "is", null);

  if (!reviews?.length) { console.log("No reviews with photos found."); return; }
  console.log(`Found ${reviews.length} reviews with photos. Adding extra photos...\n`);

  for (const review of reviews) {
    const photoIds = MULTI_PHOTOS[review.restaurant_name];
    if (!photoIds || photoIds.length < 2) continue;

    console.log(`📸 ${review.reviewer_name} @ ${review.restaurant_name} (${photoIds.length} photos)`);
    const urls = [];

    for (let i = 0; i < photoIds.length; i++) {
      try {
        const bytes = await downloadImage(photoIds[i]);
        const url = await uploadPhoto(bytes, `public/multi-${review.id}-${i}.jpg`);
        urls.push(url);
        console.log(`   [${i + 1}/${photoIds.length}] uploaded`);
      } catch (e) {
        console.warn(`   [${i + 1}] failed: ${e.message}`);
      }
    }

    if (urls.length > 0) {
      const { error } = await supabase.from("reviews").update({ photo_urls: urls }).eq("id", review.id);
      if (error) console.error(`   Update failed: ${error.message}`);
      else console.log(`   ✅ Set ${urls.length} photos\n`);
    }
  }

  console.log("Done!");
}

main();
