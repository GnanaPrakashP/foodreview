#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import {
  assertNodeRuntime,
  capacityConclusion,
  invariant,
  loadCapacityConfig,
  safeTargetMetadata,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config);
const serviceKey = process.env.LOAD_STAGING_SERVICE_ROLE_KEY;
invariant(Boolean(serviceKey), "reconcile_service_role_required");
const admin = createClient(process.env.LOAD_STAGING_SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const startedAt = new Date().toISOString();
const violations = [];

async function fetchAll(table, columns, configure = (query) => query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const query = configure(admin.from(table).select(columns).range(offset, offset + 999));
    const { data, error } = await query;
    if (error) throw new Error(`reconcile_query_failed:${table}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

function assertUnique(label, rows, key) {
  const seen = new Set();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) violations.push(`${label}_duplicate`);
    seen.add(value);
  }
}

const profiles = await fetchAll("profiles", "id,username,account_status", (query) => query.like("username", "load9_%"));
const profileIds = new Set(profiles.map((profile) => profile.id));
const [reviews, likes, comments, reactions, notifications, rooms, members, messages, fixtureAssets, derivatives, mediaJobs, fixtureDeletionJobs, pushJobs, reports] = await Promise.all([
  fetchAll("reviews", "id,reviewer_name,status,deleted_at,hidden_at", (query) => query.like("reviewer_name", "load9_%")),
  fetchAll("likes", "id,post_id,user_name", (query) => query.like("user_name", "load9_%")),
  fetchAll("comments", "id,post_id,user_name", (query) => query.like("user_name", "load9_%")),
  fetchAll("recommendation_feedback", "id,post_id,feedback_user_id,feedback_value"),
  fetchAll("notifications", "id,recipient_name,is_read,read", (query) => query.like("recipient_name", "load9_%")),
  fetchAll("shared_memory_rooms", "id,created_by,status", (query) => query.like("created_by", "load9_%")),
  fetchAll("shared_memory_members", "id,room_id,user_name"),
  fetchAll("shared_memory_messages", "id,room_id,author_name"),
  profileIds.size ? fetchAll("media_assets", "id,owner_id,surface,status,visibility,access_class,source_storage_path", (query) => query.in("owner_id", [...profileIds])) : [],
  fetchAll("media_derivatives", "id,asset_id,kind,bucket_id,storage_path"),
  fetchAll("media_processing_jobs", "id,asset_id,status,attempts,max_attempts"),
  profileIds.size ? fetchAll("account_deletion_jobs", "id,user_id,status,attempts,max_attempts", (query) => query.in("user_id", [...profileIds])) : [],
  fetchAll("push_delivery_jobs", "id,dedupe_key,status,attempts,max_attempts"),
  fetchAll("content_reports", "id,reporter_name,status", (query) => query.like("reporter_name", "load9_%"))
]);

const fixtureAssetIds = new Set(fixtureAssets.map((asset) => asset.id));
const fixtureDerivatives = derivatives.filter((row) => fixtureAssetIds.has(row.asset_id));
const fixtureJobs = mediaJobs.filter((row) => fixtureAssetIds.has(row.asset_id));

assertUnique("like", likes, (row) => `${row.post_id}:${row.user_name}`);
assertUnique("reaction", reactions.filter((row) => profileIds.has(row.feedback_user_id)), (row) => `${row.post_id}:${row.feedback_user_id}`);
assertUnique("room_member", members.filter((row) => row.user_name?.startsWith("load9_")), (row) => `${row.room_id}:${row.user_name}`);
assertUnique("media_job_asset", fixtureJobs, (row) => row.asset_id);
assertUnique("push_dedupe", pushJobs, (row) => row.dedupe_key);

const roomIds = new Set(rooms.map((room) => room.id));
const reviewIds = new Set(reviews.map((review) => review.id));
for (const row of likes) if (!reviewIds.has(row.post_id)) violations.push("like_orphan_review");
for (const row of comments) if (!reviewIds.has(row.post_id)) violations.push("comment_orphan_review");
for (const row of members.filter((entry) => entry.user_name?.startsWith("load9_"))) if (!roomIds.has(row.room_id)) violations.push("member_orphan_room");
for (const row of messages.filter((entry) => entry.author_name?.startsWith("load9_"))) if (!roomIds.has(row.room_id)) violations.push("message_orphan_room");
for (const row of fixtureDerivatives) if (!fixtureAssetIds.has(row.asset_id)) violations.push("derivative_orphan_asset");

const canonicalByAsset = new Set(fixtureDerivatives.filter((row) => row.kind === "canonical").map((row) => row.asset_id));
for (const asset of fixtureAssets) {
  if (asset.status === "ready" && !canonicalByAsset.has(asset.id)) violations.push("ready_asset_missing_canonical");
  if (asset.surface === "post" && (!asset.access_class.endsWith("_post") || asset.visibility !== "private")) violations.push("post_asset_privacy_invalid");
  if (asset.surface === "memory" && (asset.access_class !== "memory_private" || asset.visibility !== "private")) violations.push("memory_asset_privacy_invalid");
  if (asset.surface === "avatar" && (asset.access_class !== "avatar_public" || asset.visibility !== "public")) violations.push("avatar_asset_privacy_invalid");
}
for (const job of [...fixtureJobs, ...fixtureDeletionJobs, ...pushJobs]) {
  if (job.attempts < 0 || job.attempts > job.max_attempts) violations.push("job_attempts_out_of_bounds");
}
for (const notification of notifications) {
  if (notification.is_read !== notification.read) violations.push("notification_read_projection_drift");
}

const uniqueViolations = [...new Set(violations)];
const thresholdFailures = uniqueViolations;
const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "reconciliation",
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  metrics: {
    profiles: profiles.length, reviews: reviews.length, likes: likes.length, comments: comments.length,
    notifications: notifications.length, rooms: rooms.length, messages: messages.length, mediaAssets: fixtureAssets.length,
    mediaJobs: fixtureJobs.length, deletionJobs: fixtureDeletionJobs.length, contentReports: reports.length
  },
  thresholds: { unexplainedViolations: 0 },
  thresholdFailures,
  correctness: { dryRun: true, violations: violations.length, codes: uniqueViolations },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, "reconciliation");
console.log(JSON.stringify({ resultFile, status: thresholdFailures.length ? "failed" : "passed", violations: violations.length }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
