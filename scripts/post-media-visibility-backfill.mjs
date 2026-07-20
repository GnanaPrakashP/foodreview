import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const imagesOnly = process.argv.includes("--images-only");
const afterArg = process.argv.find((arg) => arg.startsWith("--after="))?.slice("--after=".length) ?? "";
const limitArg = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ?? 500);
const limit = Math.max(1, Math.min(Number.isFinite(limitArg) ? limitArg : 500, 5000));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const report = {
  mode: apply ? "apply" : "dry-run",
  imagesOnly,
  scanned: 0,
  byVisibility: { public: 0, circle: 0, me: 0, unknown: 0 },
  byBucket: {},
  generic: 0,
  legacy: 0,
  alreadyPrivate: 0,
  migrated: 0,
  ambiguous: 0,
  failed: 0,
  skippedVideos: 0,
  nextAfter: afterArg || null
};

function accessClass(visibility) {
  if (visibility === "public") return "public_post";
  if (visibility === "circle") return "circle_post";
  return "private_post";
}

function extension(path, mimeType) {
  const match = String(path ?? "").match(/\.([a-z0-9]+)$/i);
  if (match) return match[1].toLowerCase();
  if (mimeType === "video/mp4") return "mp4";
  return "jpg";
}

function sourceBucketFor(path) {
  if (String(path).startsWith("posts/") || String(path).startsWith("private-posts/")) return "media-public";
  return "review-photos";
}

function countBucket(bucket) {
  report.byBucket[bucket] = (report.byBucket[bucket] ?? 0) + 1;
}

async function profileIdForName(name) {
  const { data, error } = await admin.from("profiles").select("id").eq("username", name).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function verifiedPrivateCopy(bucket, oldPath, newPath, mimeType) {
  const { data: source, error: downloadError } = await admin.storage.from(bucket).download(oldPath);
  if (downloadError || !source) throw new Error("source_download_failed");
  const body = Buffer.from(await source.arrayBuffer());
  const { error: uploadError } = await admin.storage.from("media-private").upload(newPath, body, {
    contentType: mimeType || "application/octet-stream",
    upsert: true
  });
  if (uploadError) throw new Error("private_upload_failed");
  const { data: replacement, error: verifyError } = await admin.storage.from("media-private").download(newPath);
  if (verifyError || !replacement || replacement.size !== body.byteLength) throw new Error("private_copy_verification_failed");
}

async function privateCopyAlreadyVerified(path, expectedSize) {
  const { data, error } = await admin.storage.from("media-private").download(path);
  if (error || !data) return false;
  return !expectedSize || data.size === expectedSize;
}

async function deleteOldObjects(objects) {
  const grouped = new Map();
  for (const object of objects) {
    const paths = grouped.get(object.bucket) ?? [];
    paths.push(object.path);
    grouped.set(object.bucket, paths);
  }
  for (const [bucket, paths] of grouped) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw new Error("obsolete_public_delete_failed");
  }
}

async function loadJob(assetId) {
  const { data, error } = await admin.from("media_privacy_migration_jobs").select("*").eq("asset_id", assetId).maybeSingle();
  if (error) throw error;
  return data;
}

async function migrateGeneric(row, review, asset) {
  const { data: derivatives, error } = await admin.from("media_derivatives").select("*").eq("asset_id", asset.id);
  if (error) throw error;
  const oldObjects = (derivatives ?? [])
    .filter((item) => item.bucket_id !== "media-private" || item.public_url)
    .map((item) => ({ bucket: item.bucket_id, path: item.storage_path }));
  if (oldObjects.length === 0 && asset.privacy_state === "stable") {
    report.alreadyPrivate += 1;
    return;
  }

  const existingJob = await loadJob(asset.id);
  const durableOldObjects = existingJob?.old_objects?.length ? existingJob.old_objects : oldObjects;
  await admin.from("media_privacy_migration_jobs").upsert({
    asset_id: asset.id,
    review_id: review.id,
    state: "copying",
    old_objects: durableOldObjects,
    attempts: Number(existingJob?.attempts ?? 0) + 1,
    updated_at: new Date().toISOString()
  }, { onConflict: "asset_id" });
  await admin.from("media_assets").update({ privacy_state: "migrating" }).eq("id", asset.id);

  const newObjects = [];
  for (const derivative of derivatives ?? []) {
    if (derivative.bucket_id === "media-private" && !derivative.public_url) {
      newObjects.push({ bucket: "media-private", path: derivative.storage_path });
      continue;
    }
    const nextPath = `private-posts/${asset.owner_id}/${asset.id}/${derivative.kind}.${extension(derivative.storage_path, derivative.mime_type)}`;
    await verifiedPrivateCopy(derivative.bucket_id, derivative.storage_path, nextPath, derivative.mime_type);
    newObjects.push({ bucket: "media-private", path: nextPath });
    const { error: metadataError } = await admin.from("media_derivatives").update({
      bucket_id: "media-private",
      public_url: null,
      storage_path: nextPath
    }).eq("id", derivative.id);
    if (metadataError) throw metadataError;
    if (derivative.kind === "canonical") {
      const { error: photoError } = await admin.from("review_photos").update({
        public_url: null,
        storage_path: nextPath
      }).eq("id", row.id);
      if (photoError) throw photoError;
    }
  }

  await admin.from("media_privacy_migration_jobs").update({
    state: "metadata_updated",
    new_objects: newObjects,
    updated_at: new Date().toISOString()
  }).eq("asset_id", asset.id);
  await deleteOldObjects(durableOldObjects);
  const { error: assetError } = await admin.from("media_assets").update({
    access_class: accessClass(review.visibility),
    privacy_state: "stable",
    visibility: "private",
    updated_at: new Date().toISOString()
  }).eq("id", asset.id);
  if (assetError) throw assetError;
  await admin.from("media_privacy_migration_jobs").update({
    state: "complete",
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("asset_id", asset.id);
}

async function migrateLegacy(row, review) {
  const ownerId = row.owner_id || await profileIdForName(review.reviewer_name);
  if (!ownerId || !row.storage_path || !review.reviewer_name) {
    report.ambiguous += 1;
    return;
  }
  // review_photos.id is a UUID and gives legacy rows a deterministic asset id.
  // A retry after any partial failure therefore resumes the same durable job
  // instead of creating another orphaned asset/private copy.
  const assetId = row.id;
  const mimeType = row.mime_type || (row.media_type === "video" ? "video/mp4" : "image/jpeg");
  const ext = extension(row.storage_path, mimeType);
  const oldBucket = sourceBucketFor(row.storage_path);
  const nextPath = `private-posts/${ownerId}/${assetId}/canonical.${ext}`;
  const expiresAt = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existingAsset, error: existingAssetError } = await admin
    .from("media_assets")
    .select("id, owner_id, surface")
    .eq("id", assetId)
    .maybeSingle();
  if (existingAssetError) throw existingAssetError;
  if (existingAsset && (existingAsset.owner_id !== ownerId || existingAsset.surface !== "post")) {
    throw new Error("legacy_asset_identity_conflict");
  }

  const assetRow = {
    id: assetId,
    owner_id: ownerId,
    owner_name: review.reviewer_name,
    surface: "post",
    media_type: row.media_type === "video" ? "video" : "image",
    original_mime_type: mimeType,
    original_extension: ext,
    original_file_size_bytes: row.file_size_bytes || row.size_bytes || 1,
    original_width: row.width,
    original_height: row.height,
    crop_rect: {},
    source_bucket_id: "media-sources",
    source_storage_path: `sources/post/${ownerId}/${assetId}/original.${ext}`,
    status: "ready",
    visibility: "private",
    access_class: accessClass(review.visibility),
    privacy_state: "migrating",
    expires_at: expiresAt,
    uploaded_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    consumed_at: new Date().toISOString()
  };
  const assetMutation = existingAsset
    ? admin.from("media_assets").update({
        access_class: assetRow.access_class,
        privacy_state: "migrating",
        visibility: "private",
        updated_at: new Date().toISOString()
      }).eq("id", assetId)
    : admin.from("media_assets").insert(assetRow);
  const { error: assetError } = await assetMutation;
  if (assetError) throw assetError;

  const existingJob = await loadJob(assetId);
  const oldObjects = existingJob?.old_objects?.length
    ? existingJob.old_objects
    : [{ bucket: oldBucket, path: row.storage_path }];
  const { error: jobError } = await admin.from("media_privacy_migration_jobs").upsert({
    asset_id: assetId,
    review_id: review.id,
    state: "copying",
    old_objects: oldObjects,
    new_objects: [{ bucket: "media-private", path: nextPath }],
    attempts: Number(existingJob?.attempts ?? 0) + 1,
    updated_at: new Date().toISOString()
  }, { onConflict: "asset_id" });
  if (jobError) throw jobError;

  const expectedSize = row.file_size_bytes || row.size_bytes || 0;
  if (!(await privateCopyAlreadyVerified(nextPath, expectedSize))) {
    await verifiedPrivateCopy(oldBucket, row.storage_path, nextPath, mimeType);
  }

  const { error: derivativeError } = await admin.from("media_derivatives").upsert({
    asset_id: assetId,
    kind: "canonical",
    bucket_id: "media-private",
    storage_path: nextPath,
    public_url: null,
    mime_type: mimeType,
    width: row.width,
    height: row.height,
    file_size_bytes: row.file_size_bytes || row.size_bytes || 1
  }, { onConflict: "asset_id,kind" });
  if (derivativeError) throw derivativeError;
  const { error: photoError } = await admin.from("review_photos").update({
    media_asset_id: assetId,
    public_url: null,
    storage_path: nextPath
  }).eq("id", row.id).is("media_asset_id", null);
  if (photoError) throw photoError;

  await admin.from("media_privacy_migration_jobs").update({ state: "metadata_updated" }).eq("asset_id", assetId);
  await deleteOldObjects(oldObjects);
  await admin.from("media_assets").update({ privacy_state: "stable", updated_at: new Date().toISOString() }).eq("id", assetId);
  await admin.from("media_privacy_migration_jobs").update({ state: "complete", last_error: null, updated_at: new Date().toISOString() }).eq("asset_id", assetId);
}

let query = admin.from("review_photos")
  .select("id, review_id, owner_id, media_asset_id, storage_path, public_url, media_type, mime_type, file_size_bytes, size_bytes, width, height, reviews!inner(id, reviewer_name, visibility, deleted_at, hidden_at, reported_at, status)")
  .order("id", { ascending: true })
  .limit(limit);
if (afterArg) query = query.gt("id", afterArg);
const { data: rows, error: rowsError } = await query;
if (rowsError) {
  console.error("Could not build post-media backfill report:", rowsError.message);
  process.exit(1);
}

for (const row of rows ?? []) {
  report.scanned += 1;
  report.nextAfter = row.id;
  const review = Array.isArray(row.reviews) ? row.reviews[0] : row.reviews;
  const visibility = review?.visibility === "circle" || review?.visibility === "me" || review?.visibility === "public" ? review.visibility : "unknown";
  report.byVisibility[visibility] += 1;
  countBucket(row.media_asset_id ? "media-pipeline" : sourceBucketFor(row.storage_path));
  if (!review || !row.storage_path) {
    report.ambiguous += 1;
    continue;
  }
  if (imagesOnly && row.media_type === "video") {
    report.skippedVideos += 1;
    continue;
  }
  if (row.media_asset_id) report.generic += 1;
  else report.legacy += 1;
  if (!apply) continue;

  try {
    if (row.media_asset_id) {
      const { data: asset, error } = await admin.from("media_assets").select("*").eq("id", row.media_asset_id).maybeSingle();
      if (error || !asset || asset.owner_name !== review.reviewer_name) {
        report.ambiguous += 1;
        continue;
      }
      await migrateGeneric(row, review, asset);
    } else {
      await migrateLegacy(row, review);
    }

    const { count } = await admin.from("review_photos")
      .select("id", { count: "exact", head: true })
      .eq("review_id", review.id)
      .not("public_url", "is", null);
    if ((count ?? 0) === 0) {
      await admin.from("reviews").update({ photo_url: null, photo_urls: [] }).eq("id", review.id);
    }
    report.migrated += 1;
  } catch (error) {
    report.failed += 1;
    const failedAssetId = row.media_asset_id ?? row.id;
    if (failedAssetId) {
      await admin.from("media_assets").update({ privacy_state: "failed" }).eq("id", failedAssetId);
      await admin.from("media_privacy_migration_jobs").update({
        state: "failed",
        last_error: (error instanceof Error ? error.message : "migration_failed").slice(0, 500),
        updated_at: new Date().toISOString()
      }).eq("asset_id", failedAssetId);
    }
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.failed > 0 || report.ambiguous > 0) process.exitCode = 2;
