import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));
const apply = args.get("apply") === "true";
const confirmation = args.get("confirm");
const pageSize = boundedNumber(args.get("page-size"), 100, 1, 500);
const maxPages = boundedNumber(args.get("max-pages"), 20, 1, 1000);
const maxStorageObjects = boundedNumber(args.get("max-storage-objects"), 5000, 1, 50_000);
const scanStorage = args.get("scan-storage") === "true";
const jobId = uuidArg(args.get("job"));
const assetId = uuidArg(args.get("asset"));
const userId = uuidArg(args.get("user"));
const requeueId = uuidArg(args.get("requeue"));
const cancelId = uuidArg(args.get("cancel"));

if (apply && confirmation !== "MEDIA_PIPELINE_RECOVERY") {
  console.error("Apply mode requires --confirm=MEDIA_PIPELINE_RECOVERY");
  process.exit(1);
}
if ((requeueId || cancelId || args.get("cleanup") === "true") && !apply) {
  console.error("Recovery actions require --apply --confirm=MEDIA_PIPELINE_RECOVERY");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
if (!supabaseUrl || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    console.error("Invalid numeric option");
    process.exit(1);
  }
  return parsed;
}

function uuidArg(value) {
  if (!value || value === "true") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    console.error("Invalid UUID option");
    process.exit(1);
  }
  return value.toLowerCase();
}

function referenceHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function paginated(table, select, configure) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    let query = admin.from(table).select(select).range(page * pageSize, (page + 1) * pageSize - 1);
    query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error("database_query_failed");
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return { complete: true, rows };
  }
  return { complete: false, rows };
}

async function listBucketObjects(bucketId) {
  const paths = new Set();
  const prefixes = [""];
  let scannedEntries = 0;
  while (prefixes.length > 0 && scannedEntries < maxStorageObjects) {
    const prefix = prefixes.shift();
    for (let offset = 0; scannedEntries < maxStorageObjects; offset += 100) {
      const { data, error } = await admin.storage.from(bucketId).list(prefix, {
        limit: Math.min(100, maxStorageObjects - scannedEntries),
        offset,
        sortBy: { column: "name", order: "asc" }
      });
      if (error) throw new Error("storage_scan_failed");
      for (const entry of data ?? []) {
        scannedEntries += 1;
        const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) paths.add(objectPath);
        else prefixes.push(objectPath);
        if (scannedEntries >= maxStorageObjects) break;
      }
      if ((data ?? []).length < 100) break;
    }
  }
  return { complete: prefixes.length === 0 && scannedEntries < maxStorageObjects, paths, scannedEntries };
}

if (requeueId) {
  const { data, error } = await admin.rpc("requeue_media_processing_job", {
    p_job_id: requeueId,
    p_operator: process.env.MEDIA_OPERATOR_ID || "media-reconcile-cli"
  });
  if (error || data !== true) throw new Error("requeue_not_applied");
  console.log(JSON.stringify({ action: "requeue", applied: true, jobId: requeueId }));
}
if (cancelId) {
  const { data, error } = await admin.rpc("cancel_media_processing_job", {
    p_failure_code: "operator_cancelled",
    p_job_id: cancelId,
    p_operator: process.env.MEDIA_OPERATOR_ID || "media-reconcile-cli"
  });
  if (error || data !== true) throw new Error("cancel_not_applied");
  console.log(JSON.stringify({ action: "cancel", applied: true, jobId: cancelId }));
}
if (args.get("cleanup") === "true") {
  const baseUrl = (process.env.MEDIA_WORKER_BASE_URL || "").replace(/\/$/, "");
  const secret = process.env.MEDIA_WORKER_SECRET || "";
  if (!baseUrl || !secret) throw new Error("cleanup_endpoint_configuration_missing");
  const response = await fetch(`${baseUrl}/api/internal/media/cleanup`, {
    body: JSON.stringify({ limit: pageSize, workerId: process.env.MEDIA_OPERATOR_ID || "media-reconcile-cli" }),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    method: "POST"
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error("cleanup_not_applied");
  console.log(JSON.stringify({ action: "cleanup", applied: true, claimed: body.claimed, cleaned: body.cleaned, failed: body.failed }));
}

const jobs = await paginated(
  "media_processing_jobs",
  `id,asset_id,status,attempts,max_attempts,failure_code,failure_class,lock_expires_at,next_attempt_at,created_at${userId ? ",media_assets!inner(owner_id)" : ""}`,
  (query) => {
    let next = query.order("created_at", { ascending: true }).order("id", { ascending: true });
    if (jobId) next = next.eq("id", jobId);
    if (assetId) next = next.eq("asset_id", assetId);
    if (userId) next = next.eq("media_assets.owner_id", userId);
    return next;
  }
);
const relevantAssetIds = new Set(jobs.rows.map((row) => row.asset_id));
const assets = await paginated(
  "media_assets",
  "id,owner_id,status,surface,media_type,consumed_at,expires_at,source_deleted_at,source_cleanup_after,source_storage_path,created_at,updated_at",
  (query) => {
    let next = query.order("created_at", { ascending: true }).order("id", { ascending: true });
    if (assetId) next = next.eq("id", assetId);
    if (userId) next = next.eq("owner_id", userId);
    if (jobId && relevantAssetIds.size > 0) next = next.in("id", Array.from(relevantAssetIds));
    return next;
  }
);
const derivatives = (jobId && relevantAssetIds.size === 0)
  ? { complete: true, rows: [] }
  : await paginated(
      "media_derivatives",
      `asset_id,kind,bucket_id,storage_path,public_url${userId ? ",media_assets!inner(owner_id)" : ""}`,
      (query) => {
        let next = query.order("asset_id", { ascending: true });
        if (assetId) next = next.eq("asset_id", assetId);
        if (jobId && relevantAssetIds.size > 0) next = next.in("asset_id", Array.from(relevantAssetIds));
        if (userId) next = next.eq("media_assets.owner_id", userId);
        return next;
      }
    );

const derivativeKinds = new Map();
for (const row of derivatives.rows) {
  const kinds = derivativeKinds.get(row.asset_id) ?? new Set();
  kinds.add(row.kind);
  derivativeKinds.set(row.asset_id, kinds);
}
const jobAssetIds = new Set(jobs.rows.map((row) => row.asset_id));
const assetsById = new Map(assets.rows.map((row) => [row.id, row]));
let storageScans = null;
if (scanStorage) {
  const [sources, privateDerivatives, publicDerivatives] = await Promise.all([
    listBucketObjects("media-sources"),
    listBucketObjects("media-private"),
    listBucketObjects("media-public")
  ]);
  storageScans = {
    "media-private": privateDerivatives,
    "media-public": publicDerivatives,
    "media-sources": sources
  };
}
const now = Date.now();
const counts = {
  abandonedIntent: 0,
  cleanupCandidates: 0,
  deadLetter: 0,
  expiredIntents: 0,
  missingDerivativeObjects: scanStorage ? 0 : null,
  missingJob: 0,
  missingSources: scanStorage ? 0 : null,
  orphanedDerivativeObjects: scanStorage ? 0 : null,
  orphanedSourceObjects: scanStorage ? 0 : null,
  partialDerivatives: 0,
  queued: 0,
  readyButUnattached: 0,
  readyMetadataMismatch: 0,
  retryWaiting: 0,
  running: 0,
  staleRunning: 0
};
const failureCodes = {};
for (const job of jobs.rows) {
  if (job.status === "queued") counts.queued += 1;
  if (job.status === "running") {
    counts.running += 1;
    if (new Date(job.lock_expires_at ?? 0).getTime() <= now) counts.staleRunning += 1;
  }
  if (job.status === "retry_wait") counts.retryWaiting += 1;
  if (job.status === "dead_letter") counts.deadLetter += 1;
  if (job.failure_code) failureCodes[job.failure_code] = (failureCodes[job.failure_code] ?? 0) + 1;
}
const candidateRefs = [];
for (const asset of assets.rows) {
  const expected = asset.media_type === "image" ? ["canonical", "thumbnail"] : ["canonical", "poster"];
  const kinds = derivativeKinds.get(asset.id) ?? new Set();
  if (asset.status === "ready" && expected.some((kind) => !kinds.has(kind))) {
    counts.partialDerivatives += 1;
    counts.readyMetadataMismatch += 1;
    candidateRefs.push({ issue: "partial_derivatives", reference: referenceHash(asset.id) });
  }
  if (asset.status === "uploaded" && !jobAssetIds.has(asset.id)) counts.missingJob += 1;
  if (asset.status === "ready" && !asset.consumed_at) counts.readyButUnattached += 1;
  if (asset.status === "created" && new Date(asset.expires_at).getTime() <= now) {
    counts.expiredIntents += 1;
    counts.abandonedIntent += 1;
  }
  if (
    (asset.status === "ready" && asset.consumed_at && !asset.source_deleted_at && new Date(asset.source_cleanup_after ?? 0).getTime() <= now) ||
    (asset.status === "ready" && !asset.consumed_at && new Date(asset.created_at).getTime() <= now - 7 * 86400_000) ||
    ["failed", "rejected", "expired", "abandoned", "cancelled"].includes(asset.status)
  ) counts.cleanupCandidates += 1;
  if (
    storageScans &&
    ["uploaded", "processing", "ready"].includes(asset.status) &&
    !asset.source_deleted_at &&
    !storageScans["media-sources"].paths.has(asset.source_storage_path)
  ) {
    counts.missingSources += 1;
    candidateRefs.push({ issue: "missing_source", reference: referenceHash(asset.id) });
  }
}

for (const derivative of derivatives.rows) {
  const asset = assetsById.get(derivative.asset_id);
  if (!asset) continue;
  const expectedBucket = asset.surface === "avatar" ? "media-public" : "media-private";
  const invalidMetadata = derivative.bucket_id !== expectedBucket ||
    (asset.surface !== "avatar" && derivative.public_url !== null);
  if (asset.status === "ready" && invalidMetadata) counts.readyMetadataMismatch += 1;
  if (storageScans && !storageScans[derivative.bucket_id]?.paths.has(derivative.storage_path)) {
    counts.missingDerivativeObjects += 1;
    if (asset.status === "ready") counts.readyMetadataMismatch += 1;
    candidateRefs.push({ issue: "missing_derivative_object", reference: referenceHash(derivative.asset_id) });
  }
}

const completeDatabaseScan = jobs.complete && assets.complete && derivatives.complete;
const unfilteredGlobalScan = !jobId && !assetId && !userId;
if (storageScans && completeDatabaseScan && unfilteredGlobalScan) {
  const knownSources = new Set(assets.rows.map((row) => row.source_storage_path));
  const knownDerivatives = new Map([
    ["media-private", new Set(derivatives.rows.filter((row) => row.bucket_id === "media-private").map((row) => row.storage_path))],
    ["media-public", new Set(derivatives.rows.filter((row) => row.bucket_id === "media-public").map((row) => row.storage_path))]
  ]);
  counts.orphanedSourceObjects = Array.from(storageScans["media-sources"].paths).filter((objectPath) => !knownSources.has(objectPath)).length;
  counts.orphanedDerivativeObjects = ["media-private", "media-public"].reduce((total, bucketId) => (
    total + Array.from(storageScans[bucketId].paths).filter((objectPath) => !knownDerivatives.get(bucketId).has(objectPath)).length
  ), 0);
} else if (storageScans) {
  counts.orphanedSourceObjects = null;
  counts.orphanedDerivativeObjects = null;
}

console.log(JSON.stringify({
  apply,
  completeScan: completeDatabaseScan && (!storageScans || Object.values(storageScans).every((scan) => scan.complete)),
  counts,
  failureCodes,
  filters: {
    asset: assetId,
    job: jobId,
    user: userId ? referenceHash(userId) : null
  },
  storageScan: storageScans ? {
    complete: Object.values(storageScans).every((scan) => scan.complete),
    enabled: true,
    scannedEntries: Object.fromEntries(Object.entries(storageScans).map(([bucket, scan]) => [bucket, scan.scannedEntries]))
  } : { enabled: false },
  sampleIssues: candidateRefs.slice(0, 25)
}, null, 2));
