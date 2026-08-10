#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "WitohDishImageBackfill/0.1 (canonical dish image curation)";

function readNumberArg(argv, index, name) {
  const value = argv[index + 1];
  if (value == null) throw new Error(`${name} requires a value`);
  return Number(value);
}

function readArgs(argv) {
  const options = {
    apply: false,
    includeExisting: false,
    json: false,
    limit: 50
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--include-existing") {
      options.includeExisting = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--limit") {
      options.limit = readNumberArg(argv, index, "--limit");
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run dish:image-backfill -- [options]",
        "",
        "Find Wikimedia image candidates for canonical dishes and store them as pending rows.",
        "Approved card images are still manual: the mobile app only displays status='approved'.",
        "",
        "Options:",
        "  --dry-run             Print candidates without writing; default",
        "  --apply               Insert pending canonical_dish_images rows",
        "  --limit <n>           Canonical dishes to scan, default 50, max 500",
        "  --include-existing    Also scan dishes that already have pending/approved images",
        "  --json                Print machine-readable JSON"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.limit = Math.min(Math.max(Math.trunc(options.limit), 1), 500);
  return options;
}

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function plainMetadataValue(metadata) {
  const value = metadata?.value;
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function commonsSearchUrl(dishName) {
  const url = new URL(COMMONS_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "8");
  url.searchParams.set("gsrsearch", `"${dishName}" food dish`);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|mime|size|extmetadata");
  url.searchParams.set("iiurlwidth", "800");
  return url;
}

function candidateConfidence(dishName, pageTitle) {
  const dish = normalizedText(dishName);
  const title = normalizedText(pageTitle.replace(/^file\s+/, ""));
  const dishTokens = dish.split(" ").filter(Boolean);
  const titleTokens = new Set(title.split(" ").filter(Boolean));
  const matchedTokens = dishTokens.filter((token) => titleTokens.has(token)).length;
  const tokenScore = dishTokens.length === 0 ? 0 : matchedTokens / dishTokens.length;
  const foodSignal = /\b(food|dish|cuisine|meal|biryani|pizza|burger|dessert|sweet|chicken|paneer|shawarma|mandi)\b/.test(title) ? 0.1 : 0;
  return Math.min(0.85, Number((0.35 + tokenScore * 0.4 + foodSignal).toFixed(2)));
}

function imageCandidateFromPage(dishName, page) {
  const imageInfo = page.imageinfo?.[0];
  if (!imageInfo || typeof imageInfo.mime !== "string" || !imageInfo.mime.startsWith("image/")) return null;
  const imageUrl = imageInfo.thumburl || imageInfo.url;
  if (typeof imageUrl !== "string" || !/^https?:\/\//i.test(imageUrl)) return null;

  return {
    attribution_text: plainMetadataValue(imageInfo.extmetadata?.Artist) ?? plainMetadataValue(imageInfo.extmetadata?.Credit),
    attribution_url: imageInfo.descriptionurl ?? null,
    confidence: candidateConfidence(dishName, page.title ?? ""),
    image_height: Number.isFinite(imageInfo.thumbheight) ? imageInfo.thumbheight : Number.isFinite(imageInfo.height) ? imageInfo.height : null,
    image_url: imageUrl,
    image_width: Number.isFinite(imageInfo.thumbwidth) ? imageInfo.thumbwidth : Number.isFinite(imageInfo.width) ? imageInfo.width : null,
    license: plainMetadataValue(imageInfo.extmetadata?.LicenseShortName) ?? plainMetadataValue(imageInfo.extmetadata?.UsageTerms),
    provider_image_id: String(page.pageid ?? page.title ?? ""),
    source: "wikimedia",
    source_url: imageInfo.descriptionurl ?? null
  };
}

async function findWikimediaImageCandidate(dishName) {
  const response = await fetch(commonsSearchUrl(dishName), {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!response.ok) throw new Error(`Wikimedia request failed with ${response.status}`);

  const payload = await response.json();
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  const candidates = pages
    .map((page) => imageCandidateFromPage(dishName, page))
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
  return candidates[0] ?? null;
}

async function loadCanonicalDishes(db, limit) {
  const { data, error } = await db
    .from("canonical_dishes")
    .select("id, display_name")
    .in("status", ["verified", "generated"])
    .is("merged_into_dish_id", null)
    .order("display_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message ?? "Could not load canonical dishes");
  return data ?? [];
}

async function loadExistingImageKeys(db) {
  const { data, error } = await db
    .from("canonical_dish_images")
    .select("canonical_dish_id, source, provider_image_id, status")
    .in("status", ["pending", "approved"]);
  if (error) throw new Error(error.message ?? "Could not load canonical dish images. Run the canonical_dish_images migration first.");

  return new Set((data ?? []).map((row) => [
    row.canonical_dish_id,
    row.source ?? "",
    row.provider_image_id ?? "",
    row.status ?? ""
  ].join("::")));
}

function hasExistingDishImage(existingKeys, canonicalDishId) {
  for (const key of existingKeys) {
    if (key.startsWith(`${canonicalDishId}::`)) return true;
  }
  return false;
}

async function insertPendingImage(db, dish, candidate) {
  const { error } = await db.from("canonical_dish_images").insert({
    ...candidate,
    canonical_dish_id: dish.id,
    is_primary: true,
    notes: `Wikimedia candidate for ${dish.display_name}`,
    status: "pending"
  });
  return error;
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const existingKeys = await loadExistingImageKeys(db);
  const loadedDishes = await loadCanonicalDishes(db, options.limit);
  const dishes = loadedDishes
    .filter((dish) => options.includeExisting || !hasExistingDishImage(existingKeys, dish.id));
  const summary = {
    apply: options.apply,
    candidates: [],
    errors: [],
    inserted: 0,
    scanned: dishes.length,
    skippedExisting: options.includeExisting ? 0 : loadedDishes.length - dishes.length
  };

  for (const dish of dishes) {
    try {
      const candidate = await findWikimediaImageCandidate(dish.display_name);
      if (!candidate) {
        summary.errors.push({ dishId: dish.id, dishName: dish.display_name, error: "No Wikimedia image candidate found" });
        continue;
      }

      summary.candidates.push({ dishId: dish.id, dishName: dish.display_name, ...candidate });
      if (options.apply) {
        const error = await insertPendingImage(db, dish, candidate);
        if (error) summary.errors.push({ dishId: dish.id, dishName: dish.display_name, error: error.message ?? "Insert failed" });
        else summary.inserted += 1;
      }
    } catch (error) {
      summary.errors.push({
        dishId: dish.id,
        dishName: dish.display_name,
        error: error instanceof Error ? error.message : "Unexpected image lookup failure"
      });
    }
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("Canonical Dish Image Backfill");
  console.log(`Mode: ${options.apply ? "apply pending rows" : "dry-run"}`);
  console.log(`Scanned: ${summary.scanned}`);
  console.log(`Candidates: ${summary.candidates.length}`);
  console.log(`Inserted: ${summary.inserted}`);
  console.log(`Errors: ${summary.errors.length}`);
  for (const candidate of summary.candidates.slice(0, 12)) {
    console.log(`- ${candidate.dishName}: ${candidate.image_url} (${candidate.license ?? "unknown license"})`);
  }
}

await main();
