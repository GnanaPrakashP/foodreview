import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const apply = process.argv.includes("--apply");
const limitArg = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 250);
const limit = Math.max(1, Math.min(Number.isFinite(limitArg) ? limitArg : 250, 1000));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const report = {
  failed: 0,
  legacyHomeCandidates: 0,
  legacyNormalizationPath: "npm run media:home-normalize",
  missingModernFeed: 0,
  mode: apply ? "apply" : "dry-run",
  normalized: 0,
  scannedModernAssets: 0
};

const { count: legacyCount, error: legacyError } = await admin
  .from("review_photos")
  .select("id", { count: "exact", head: true })
  .is("media_asset_id", null)
  .not("public_url", "is", null);
if (legacyError) throw legacyError;
report.legacyHomeCandidates = legacyCount ?? 0;

const { data: assets, error: assetError } = await admin
  .from("media_assets")
  .select("id, owner_id")
  .eq("surface", "post")
  .eq("media_type", "image")
  .eq("status", "ready")
  .eq("privacy_state", "stable")
  .order("created_at", { ascending: true })
  .limit(limit);
if (assetError) throw assetError;
report.scannedModernAssets = assets?.length ?? 0;

for (const asset of assets ?? []) {
  const { data: rows, error } = await admin
    .from("media_derivatives")
    .select("asset_id, blurhash, bucket_id, kind, storage_path")
    .eq("asset_id", asset.id)
    .in("kind", ["canonical", "feed"]);
  if (error) throw error;
  if (rows?.some((row) => row.kind === "feed")) continue;
  const canonical = rows?.find((row) => row.kind === "canonical" && row.bucket_id === "media-private");
  if (!canonical) continue;
  report.missingModernFeed += 1;
  if (!apply) continue;
  try {
    const { data: source, error: downloadError } = await admin.storage
      .from("media-private")
      .download(canonical.storage_path);
    if (downloadError || !source) throw new Error("canonical_download_failed");
    const result = await sharp(Buffer.from(await source.arrayBuffer()), {
      failOn: "error",
      limitInputPixels: 80_000_001
    })
      .rotate()
      .resize(720, 900, { fit: "cover", position: "centre" })
      .flatten({ background: "#ffffff" })
      .jpeg({ mozjpeg: true, progressive: true, quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const storagePath = `private-posts/${asset.owner_id}/${asset.id}/feed.jpg`;
    const { error: uploadError } = await admin.storage.from("media-private").upload(storagePath, result.data, {
      cacheControl: "300",
      contentType: "image/jpeg",
      upsert: true
    });
    if (uploadError) throw new Error("feed_upload_failed");
    const { error: metadataError } = await admin.from("media_derivatives").upsert({
      asset_id: asset.id,
      blurhash: canonical.blurhash,
      bucket_id: "media-private",
      duration_ms: null,
      file_size_bytes: result.data.byteLength,
      height: result.info.height,
      kind: "feed",
      mime_type: "image/jpeg",
      public_url: null,
      storage_path: storagePath,
      width: result.info.width
    }, { onConflict: "asset_id,kind" });
    if (metadataError) throw new Error("feed_metadata_failed");
    report.normalized += 1;
  } catch {
    report.failed += 1;
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exitCode = 1;
