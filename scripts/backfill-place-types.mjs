#!/usr/bin/env node

// Backfill Google Places venue types (restaurant_primary_type / restaurant_types)
// onto existing reviews that have a restaurant_id (Google place id) but no types
// captured yet. Going-forward capture only fills new reviews, so this reaches
// back over historical places. A later curation pass aggregates these per place
// into an Explore "kind of place" category.
//
// Usage:
//   node scripts/backfill-place-types.mjs --dry-run [--limit 200]
//   node scripts/backfill-place-types.mjs --apply   [--limit 200]
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      GOOGLE_API_KEY | GOOGLE_PLACES_API_KEY | GOOGLE_MAPS_API_KEY

import { createClient } from "@supabase/supabase-js";

function readArgs(argv) {
  const options = { apply: false, dryRun: false, limit: 200 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--limit") options.limit = boundedLimit(argv[index += 1]);
    else if (arg.startsWith("--limit=")) options.limit = boundedLimit(arg.slice("--limit=".length));
  }
  if (!options.apply && !options.dryRun) options.dryRun = true;
  if (options.apply && options.dryRun) throw new Error("Choose either --apply or --dry-run, not both");
  return options;
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(Math.max(Math.trunc(parsed), 1), 2000);
}

const options = readArgs(process.argv.slice(2));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = (
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  ""
).trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!apiKey) {
  throw new Error("A Google API key (GOOGLE_API_KEY / GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_API_KEY) is required");
}

const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const GOOGLE_QPS_DELAY_MS = 120;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTypes(types) {
  if (!Array.isArray(types)) return [];
  return Array.from(
    new Set(
      types
        .filter((type) => typeof type === "string" && type.trim().length > 0)
        .map((type) => type.trim().slice(0, 80))
    )
  ).slice(0, 24);
}

async function fetchPlaceTypes(placeId) {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("regionCode", "in");
  const response = await fetch(url.toString(), {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id,primaryType,types" }
  });
  if (!response.ok) return { ok: false, status: response.status };
  const payload = await response.json();
  return {
    ok: true,
    primaryType: typeof payload.primaryType === "string" ? payload.primaryType.trim().slice(0, 80) : null,
    types: sanitizeTypes(payload.types)
  };
}

async function distinctPlaceIds(limit) {
  const { data, error } = await db
    .from("reviews")
    .select("restaurant_id")
    .not("restaurant_id", "is", null)
    .is("restaurant_types", null)
    .limit(Math.min(limit * 25, 5000));
  if (error) throw new Error(`Query failed: ${error.message}`);

  const ids = [];
  const seen = new Set();
  for (const row of data ?? []) {
    const id = (row.restaurant_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function pendingReviewCount(placeId) {
  const { count, error } = await db
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", placeId)
    .is("restaurant_types", null);
  if (error) throw new Error(`Count failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const placeIds = await distinctPlaceIds(options.limit);
  console.log(
    `${options.apply ? "APPLY" : "DRY-RUN"}: ${placeIds.length} place(s) missing venue types (limit ${options.limit}).`
  );

  let classified = 0;
  let affectedReviews = 0;
  let skipped = 0;
  let failed = 0;

  for (const placeId of placeIds) {
    let result;
    try {
      result = await fetchPlaceTypes(placeId);
    } catch (error) {
      failed += 1;
      console.warn(`  ✗ ${placeId}: fetch error ${error?.message ?? error}`);
      await delay(GOOGLE_QPS_DELAY_MS);
      continue;
    }

    if (!result.ok) {
      failed += 1;
      console.warn(`  ✗ ${placeId}: Google returned ${result.status}`);
      await delay(GOOGLE_QPS_DELAY_MS);
      continue;
    }

    if (!result.primaryType && result.types.length === 0) {
      skipped += 1;
      console.log(`  – ${placeId}: no venue types available`);
      await delay(GOOGLE_QPS_DELAY_MS);
      continue;
    }

    const pending = await pendingReviewCount(placeId);
    classified += 1;
    console.log(
      `  • ${placeId}: primaryType=${result.primaryType ?? "-"} types=[${result.types.join(", ")}] (${pending} review row(s))`
    );

    if (options.apply) {
      const { error } = await db
        .from("reviews")
        .update({ restaurant_primary_type: result.primaryType, restaurant_types: result.types })
        .eq("restaurant_id", placeId)
        .is("restaurant_types", null);
      if (error) {
        failed += 1;
        console.warn(`  ✗ ${placeId}: update failed ${error.message}`);
        await delay(GOOGLE_QPS_DELAY_MS);
        continue;
      }
    }
    affectedReviews += pending;
    await delay(GOOGLE_QPS_DELAY_MS);
  }

  console.log(
    `Done. ${classified} place(s) classified, ${affectedReviews} review row(s) ${options.apply ? "updated" : "would update"}, ${skipped} without types, ${failed} failure(s).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
