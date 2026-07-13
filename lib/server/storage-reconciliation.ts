import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type StorageBucket = "media-sources" | "media-public" | "media-private" | "review-photos" | "review-media-quarantine" | "memory-media";

async function boundedObjectPaths(admin: AdminClient, bucket: StorageBucket, maximum: number) {
  const paths: string[] = [];
  const prefixes = [""];
  let visitedPrefixes = 0;
  while (prefixes.length > 0 && paths.length < maximum && visitedPrefixes < 1000) {
    const prefix = prefixes.shift() ?? "";
    visitedPrefixes += 1;
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error("storage_reconciliation_list_failed");
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) paths.push(path);
      else prefixes.push(path);
      if (paths.length >= maximum) break;
    }
  }
  return { paths, truncated: paths.length >= maximum || prefixes.length > 0 };
}

async function referencedPaths(admin: AdminClient, bucket: StorageBucket, paths: string[]) {
  if (paths.length === 0) return new Set<string>();
  if (bucket === "media-sources") {
    const { data, error } = await admin.from("media_assets").select("source_storage_path").in("source_storage_path", paths);
    if (error) throw new Error("storage_reconciliation_reference_failed");
    return new Set((data ?? []).map((row) => row.source_storage_path));
  }
  if (bucket === "media-public" || bucket === "media-private") {
    const { data, error } = await admin.from("media_derivatives").select("storage_path").eq("bucket_id", bucket).in("storage_path", paths);
    if (error) throw new Error("storage_reconciliation_reference_failed");
    return new Set((data ?? []).map((row) => row.storage_path));
  }
  if (bucket === "review-photos") {
    const { data, error } = await admin.from("review_photos").select("storage_path").in("storage_path", paths);
    if (error) throw new Error("storage_reconciliation_reference_failed");
    return new Set((data ?? []).map((row) => row.storage_path).filter(Boolean));
  }
  if (bucket === "review-media-quarantine") {
    const { data, error } = await admin.from("review_media_upload_intents").select("quarantine_storage_path").in("quarantine_storage_path", paths);
    if (error) throw new Error("storage_reconciliation_reference_failed");
    return new Set((data ?? []).map((row) => row.quarantine_storage_path));
  }
  const [photos, intents] = await Promise.all([
    admin.from("shared_memory_photos").select("storage_path").in("storage_path", paths),
    admin.from("shared_memory_upload_intents").select("storage_path").in("storage_path", paths)
  ]);
  if (photos.error || intents.error) throw new Error("storage_reconciliation_reference_failed");
  return new Set([...(photos.data ?? []), ...(intents.data ?? [])].map((row) => row.storage_path));
}

export async function inspectOrphanedStorageObjects(admin: AdminClient, maximum = 500) {
  const buckets: StorageBucket[] = ["media-sources", "media-public", "media-private", "review-photos", "review-media-quarantine", "memory-media"];
  let scannedObjects = 0;
  let unreferencedObjects = 0;
  let truncatedBuckets = 0;
  const perBucketLimit = Math.max(1, Math.floor(Math.min(Math.max(maximum, 1), 3000) / buckets.length));
  for (const bucket of buckets) {
    const scan = await boundedObjectPaths(admin, bucket, perBucketLimit);
    const references = await referencedPaths(admin, bucket, scan.paths);
    scannedObjects += scan.paths.length;
    unreferencedObjects += scan.paths.filter((path) => !references.has(path)).length;
    if (scan.truncated) truncatedBuckets += 1;
  }
  return { buckets: buckets.length, scannedObjects, truncatedBuckets, unreferencedObjects };
}
