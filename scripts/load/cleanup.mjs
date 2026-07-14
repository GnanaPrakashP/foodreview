#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import {
  assertNodeRuntime,
  hasFlag,
  invariant,
  loadCapacityConfig,
  safeTargetMetadata,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
const localContract = hasFlag("local-contract");
if (!hasFlag("apply")) {
  console.log(JSON.stringify({ apply: false, deletesProductionData: false, scope: config.seed.emailPrefix, status: "dry-run" }, null, 2));
  process.exit(0);
}
assertNodeRuntime(config, { localValidation: localContract });
const target = safeTargetMetadata(config, process.env, localContract
  ? { allowLocal: true }
  : { confirmation: config.safety.cleanupConfirmation });
const serviceKey = process.env.LOAD_STAGING_SERVICE_ROLE_KEY;
invariant(Boolean(serviceKey), "cleanup_service_role_required");
const admin = createClient(process.env.LOAD_STAGING_SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const startedAt = new Date().toISOString();

async function listFixtureUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("cleanup_auth_user_list_failed");
    users.push(...data.users.filter((user) => user.email?.toLowerCase().startsWith(config.seed.emailPrefix)));
    if (data.users.length < 1000) break;
  }
  return users;
}

const users = await listFixtureUsers();
const userIds = users.map((user) => user.id);
const prefix = "load9_%";
const deleteErrors = [];
async function removeWhere(table, column, operator = "like", value = prefix) {
  if (operator === "in" && (!Array.isArray(value) || value.length === 0)) return;
  let query = admin.from(table).delete();
  query = operator === "in" ? query.in(column, value) : query.like(column, value);
  const { error } = await query;
  if (error) deleteErrors.push(table);
}

const { data: mediaAssets } = userIds.length
  ? await admin.from("media_assets").select("id,source_bucket_id,source_storage_path").in("owner_id", userIds)
  : { data: [] };
const assetIds = (mediaAssets ?? []).map((asset) => asset.id);
const { data: derivatives } = assetIds.length
  ? await admin.from("media_derivatives").select("bucket_id,storage_path").in("asset_id", assetIds)
  : { data: [] };
const { data: memoryPhotos } = await admin.from("shared_memory_photos").select("storage_path,shared_memory_rooms!inner(created_by)").like("shared_memory_rooms.created_by", prefix);

const storageGroups = new Map();
for (const object of [
  ...(mediaAssets ?? []).map((asset) => ({ bucket: asset.source_bucket_id, path: asset.source_storage_path })),
  ...(derivatives ?? []).map((item) => ({ bucket: item.bucket_id, path: item.storage_path })),
  ...(memoryPhotos ?? []).map((item) => ({ bucket: "memory-media", path: item.storage_path }))
]) {
  if (!object.bucket || !object.path) continue;
  const paths = storageGroups.get(object.bucket) ?? [];
  paths.push(object.path);
  storageGroups.set(object.bucket, paths);
}
for (const [bucket, paths] of storageGroups) {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
    if (error) deleteErrors.push(`storage:${bucket}`);
  }
}

await removeWhere("account_deletion_jobs", "user_id", "in", userIds);
await removeWhere("content_reports", "reporter_id", "in", userIds);
await removeWhere("review_dish_mentions", "user_id", "in", userIds);
await removeWhere("post_views", "user_id", "in", userIds);
await removeWhere("recommendation_feedback", "feedback_user_id", "in", userIds);
await removeWhere("notifications", "recipient_name");
await removeWhere("shared_memory_rooms", "created_by");
await removeWhere("wishlist", "user_name");
await removeWhere("comments", "user_name");
await removeWhere("likes", "user_name");
await removeWhere("reviews", "reviewer_name");
await removeWhere("blocked_users", "blocker_name");
await removeWhere("blocked_users", "blocked_name");
await removeWhere("circle_memberships", "user_name");
await removeWhere("circle_memberships", "member_name");
await removeWhere("profiles", "id", "in", userIds);

for (let offset = 0; offset < users.length; offset += 5) {
  await Promise.all(users.slice(offset, offset + 5).map(async (user) => {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) deleteErrors.push("auth.users");
  }));
}

const thresholdFailures = [...new Set(deleteErrors)];
const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "cleanup",
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  metrics: { fixtureUsers: users.length, storageObjects: [...storageGroups.values()].reduce((sum, paths) => sum + paths.length, 0) },
  thresholds: { failuresAllowed: 0 },
  thresholdFailures,
  correctness: { violations: thresholdFailures.length },
  capacityConclusion: "NOT PROVEN — cleanup is not capacity evidence"
};
const resultFile = await writeResult(result, "cleanup");
console.log(JSON.stringify({ resultFile, status: thresholdFailures.length ? "failed" : "cleaned", thresholdFailures: thresholdFailures.length }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
