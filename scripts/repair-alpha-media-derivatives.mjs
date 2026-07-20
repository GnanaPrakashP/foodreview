#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import mediaImageProcessing from "../lib/media-image-processing.cjs";

const {
  MEDIA_IMAGE_PROCESSING_VERSION,
  buildRevisedImageDerivativePath,
  classifyAlphaRepairCandidate,
  cropPixelsForRect,
  normalizeAlphaForJpeg,
  renderMediaImageDerivatives,
  requiredImageDerivativeKinds
} = mediaImageProcessing;

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length > 0 ? rest.join("=") : "true"];
}));
const apply = args.get("apply") === "true";
const confirmation = args.get("confirm");
const after = args.get("after") === "true" ? "" : args.get("after") ?? "";
const limit = boundedInteger(args.get("limit"), 250, 1, 1000);

if (apply && confirmation !== "MEDIA_ALPHA_DERIVATIVE_REPAIR") {
  console.error("alpha-media-repair: --apply requires --confirm=MEDIA_ALPHA_DERIVATIVE_REPAIR");
  process.exit(1);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    console.error("alpha-media-repair: invalid numeric option");
    process.exit(1);
  }
  return parsed;
}

function isLoopback(value) {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function localEnvironment() {
  // Supabase CLI's local-only demo secret is public and fixed. Deriving the
  // token in-process avoids ever printing or persisting a service credential.
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase-demo", role: "service_role", exp: 1983812996 })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", "super-secret-jwt-token-with-at-least-32-characters-long")
    .update(unsigned)
    .digest("base64url");
  return { serviceKey: `${unsigned}.${signature}`, url: "http://127.0.0.1:54321" };
}

const explicitUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const explicitKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const local = explicitUrl || explicitKey ? null : localEnvironment();
const url = explicitUrl ?? local?.url ?? "";
const serviceKey = explicitKey ?? local?.serviceKey ?? "";
if (!url || !serviceKey) {
  console.error("alpha-media-repair: Supabase URL and service-role key are required");
  process.exit(1);
}
const target = isLoopback(url) ? "local" : "hosted";
if (apply && target === "hosted" && confirmation !== "MEDIA_ALPHA_DERIVATIVE_REPAIR") {
  console.error("alpha-media-repair: refusing hosted apply without explicit repair confirmation");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const report = {
  alphaCandidates: 0,
  cleanupFailures: 0,
  failed: 0,
  failureCodes: {},
  missingDerivativeSets: 0,
  mode: apply ? "apply" : "dry-run",
  nextAfter: after || null,
  opaqueSkipped: 0,
  processingVersion: MEDIA_IMAGE_PROCESSING_VERSION,
  repaired: 0,
  scanned: 0,
  target,
  upToDateSkipped: 0
};

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function encodeBase83(value, length) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
  let output = "";
  for (let index = 1; index <= length; index += 1) {
    output += alphabet[Math.floor(value / Math.pow(83, length - index)) % 83];
  }
  return output;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  const bounded = Math.max(0, Math.min(1, value));
  const encoded = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * Math.pow(bounded, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

async function blurhashForImage(buffer) {
  const pixel = await sharp(buffer).resize(1, 1, { fit: "fill" }).raw().toBuffer();
  const red = pixel[0] ?? 0;
  const green = pixel[1] ?? red;
  const blue = pixel[2] ?? red;
  const dc = (linearToSrgb(srgbToLinear(red / 255)) << 16) +
    (linearToSrgb(srgbToLinear(green / 255)) << 8) +
    linearToSrgb(srgbToLinear(blue / 255));
  return `${encodeBase83(0, 1)}${encodeBase83(0, 1)}${encodeBase83(dc, 4)}`;
}

async function verifiedUpload(bucketId, storagePath, buffer, cacheControl) {
  const digest = sha256(buffer);
  const uploaded = await admin.storage.from(bucketId).upload(storagePath, buffer, {
    cacheControl,
    contentType: "image/jpeg",
    metadata: { contentSha256: digest, processingVersion: MEDIA_IMAGE_PROCESSING_VERSION },
    upsert: true
  });
  if (uploaded.error) throw new Error("staged_derivative_upload_failed");
  const verified = await admin.storage.from(bucketId).download(storagePath);
  if (verified.error || !verified.data) throw new Error("staged_derivative_verification_failed");
  const verifiedBytes = Buffer.from(await verified.data.arrayBuffer());
  if (verifiedBytes.byteLength !== buffer.byteLength || sha256(verifiedBytes) !== digest) {
    throw new Error("staged_derivative_checksum_mismatch");
  }
  return digest;
}

async function removeOldObjects(objects, currentPaths) {
  const byBucket = new Map();
  for (const object of objects ?? []) {
    if (!object?.bucket_id || !object?.storage_path || currentPaths.has(object.storage_path)) continue;
    const paths = byBucket.get(object.bucket_id) ?? [];
    paths.push(object.storage_path);
    byBucket.set(object.bucket_id, paths);
  }
  for (const [bucket, paths] of byBucket) {
    const removal = await admin.storage.from(bucket).remove(Array.from(new Set(paths)));
    if (removal.error) throw new Error("obsolete_derivative_cleanup_failed");
  }
}

let assetQuery = admin
  .from("media_assets")
  .select("id,owner_id,surface,source_bucket_id,source_storage_path,crop_rect,original_file_size_bytes")
  .eq("media_type", "image")
  .eq("status", "ready")
  .eq("privacy_state", "stable")
  .eq("moderation_status", "approved")
  .in("surface", ["post", "avatar"])
  .order("id", { ascending: true })
  .limit(limit);
if (after) assetQuery = assetQuery.gt("id", after);
const { data: assets, error: assetError } = await assetQuery;
if (assetError) {
  console.error("alpha-media-repair: asset scan failed", {
    code: assetError.code ?? "unknown",
    message: assetError.message ?? "database_query_failed"
  });
  throw new Error("alpha_media_asset_scan_failed");
}

for (const asset of assets ?? []) {
  report.scanned += 1;
  report.nextAfter = asset.id;
  try {
    const requiredKinds = requiredImageDerivativeKinds(asset.surface);
    const { data: rows, error: derivativeError } = await admin
      .from("media_derivatives")
      .select("asset_id,kind,bucket_id,storage_path,public_url,width,height,content_revision,content_sha256,processing_version")
      .eq("asset_id", asset.id)
      .in("kind", requiredKinds);
    if (derivativeError) throw new Error("derivative_metadata_scan_failed");
    if ((rows ?? []).length !== requiredKinds.length || requiredKinds.some((kind) => !(rows ?? []).some((row) => row.kind === kind))) {
      report.missingDerivativeSets += 1;
      continue;
    }

    const sourceResult = await admin.storage.from(asset.source_bucket_id).download(asset.source_storage_path);
    if (sourceResult.error || !sourceResult.data) throw new Error("private_source_download_failed");
    const source = Buffer.from(await sourceResult.data.arrayBuffer());
    if (source.byteLength !== Number(asset.original_file_size_bytes)) throw new Error("private_source_size_mismatch");
    const oriented = sharp(source, { failOn: "error", limitInputPixels: 80_000_001 }).rotate();
    const metadata = await oriented.clone().metadata();
    const normalized = normalizeAlphaForJpeg(oriented, metadata);
    const classification = classifyAlphaRepairCandidate({
      derivatives: rows ?? [],
      hasAlpha: normalized.hasAlpha,
      surface: asset.surface
    });
    if (classification.status === "opaque") {
      report.opaqueSkipped += 1;
      continue;
    }
    if (classification.status === "up-to-date") {
      report.upToDateSkipped += 1;
      if (apply && (rows ?? []).every((row) => /\/(canonical|feed|thumbnail)\.r[2-9][0-9]*\.jpg$/.test(row.storage_path))) {
        const obsolete = (rows ?? []).map((row) => ({
          bucket_id: row.bucket_id,
          storage_path: row.storage_path.replace(/\/(canonical|feed|thumbnail)\.r[2-9][0-9]*\.jpg$/, `/${row.kind}.jpg`)
        }));
        try {
          await removeOldObjects(obsolete, new Set((rows ?? []).map((row) => row.storage_path)));
        } catch {
          report.cleanupFailures += 1;
        }
      }
      continue;
    }
    if (classification.status !== "repair") throw new Error("derivative_revision_set_inconsistent");

    report.alphaCandidates += 1;
    if (!apply) continue;
    const expectedRevision = classification.expectedRevision;
    const nextRevision = classification.nextRevision;
    const width = metadata.autoOrient?.width ?? metadata.width ?? 0;
    const height = metadata.autoOrient?.height ?? metadata.height ?? 0;
    const crop = cropPixelsForRect(asset.crop_rect ?? {}, width, height);
    const rendered = await renderMediaImageDerivatives(asset.surface, normalized.image.clone().extract(crop));
    const blurhash = await blurhashForImage(rendered.canonical.buffer);
    const bucketId = asset.surface === "avatar" ? "media-public" : "media-private";
    const cacheControl = asset.surface === "post" ? "300" : "31536000";
    const commitRows = [];
    for (const kind of requiredKinds) {
      const derivative = rendered[kind];
      if (!derivative) throw new Error("required_derivative_render_missing");
      const storagePath = buildRevisedImageDerivativePath(asset, kind, nextRevision);
      const digest = await verifiedUpload(bucketId, storagePath, derivative.buffer, cacheControl);
      const publicUrl = asset.surface === "avatar"
        ? admin.storage.from(bucketId).getPublicUrl(storagePath).data?.publicUrl ?? null
        : null;
      commitRows.push({
        asset_id: asset.id,
        blurhash,
        bucket_id: bucketId,
        content_revision: nextRevision,
        content_sha256: digest,
        file_size_bytes: derivative.buffer.byteLength,
        height: derivative.height,
        kind,
        mime_type: "image/jpeg",
        processing_version: MEDIA_IMAGE_PROCESSING_VERSION,
        public_url: publicUrl,
        storage_path: storagePath,
        width: derivative.width
      });
    }
    const committed = await admin.rpc("commit_alpha_media_derivative_repair_v1", {
      p_asset_id: asset.id,
      p_derivatives: commitRows,
      p_expected_revision: expectedRevision,
      p_processing_version: MEDIA_IMAGE_PROCESSING_VERSION
    });
    if (committed.error || committed.data?.contentRevision !== nextRevision) {
      throw new Error("alpha_derivative_atomic_commit_failed");
    }
    report.repaired += 1;
    try {
      await removeOldObjects(committed.data.oldObjects, new Set(commitRows.map((row) => row.storage_path)));
    } catch {
      report.cleanupFailures += 1;
    }
  } catch (error) {
    report.failed += 1;
    const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : "alpha_media_repair_failed";
    report.failureCodes[code] = (report.failureCodes[code] ?? 0) + 1;
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exitCode = 1;
