#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("phase7_local_supabase_not_running");
const local = JSON.parse(status.stdout);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
const anon = createClient(local.API_URL, local.ANON_KEY, options);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const username = `phase7${suffix}`.slice(0, 20);
const mediaAssetId = randomUUID();
const moderationIntentId = randomUUID();
const deletionJobId = randomUUID();
const missedRunId = randomUUID();
let userId = null;

function allowed(result, label) {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? "failed"}`);
  return result.data;
}

try {
  const created = await admin.auth.admin.createUser({ email: `phase7.${suffix}@example.test`, email_confirm: true, password: `Phase7-${suffix}!` });
  assert.ok(created.data.user && !created.error, "fixture user creation failed");
  userId = created.data.user.id;
  allowed(await admin.from("profiles").upsert({ account_status: "active", account_type: "public", first_name: "Phase", id: userId, last_name: "Seven", username }), "profile fixture");

  allowed(await admin.from("media_assets").insert({
    crop_rect: {},
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    id: mediaAssetId,
    media_type: "image",
    original_extension: "jpg",
    original_file_size_bytes: 100,
    original_mime_type: "image/jpeg",
    owner_id: userId,
    owner_name: username,
    source_storage_path: `sources/post/${userId}/${mediaAssetId}/original.jpg`,
    status: "failed",
    surface: "post",
    visibility: "private"
  }), "media asset fixture");
  allowed(await admin.from("media_processing_jobs").insert({
    asset_id: mediaAssetId,
    attempts: 5,
    dead_lettered_at: new Date().toISOString(),
    failure_class: "retryable",
    failure_code: "phase7_fixture_failure",
    job_type: "image_derivatives",
    max_attempts: 5,
    status: "dead_letter"
  }), "media dead-letter fixture");

  allowed(await admin.from("account_deletion_jobs").insert({
    created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    id: deletionJobId,
    last_error_code: "phase7_fixture_failure",
    owner_name: username,
    status: "failed",
    user_id: userId
  }), "deletion failure fixture");

  allowed(await admin.from("review_media_upload_intents").insert({
    category: "post",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    extension: "jpg",
    file_size_bytes: 100,
    id: moderationIntentId,
    max_file_size_bytes: 1000,
    media_type: "image",
    mime_type: "image/jpeg",
    moderation_last_error_code: "provider_unavailable",
    moderation_status: "pending",
    quarantine_storage_path: `pending/${userId}/${moderationIntentId}/file.jpg`,
    status: "created",
    storage_path: `posts/${userId}/${moderationIntentId}/file.jpg`,
    user_id: userId,
    user_name: username
  }), "moderation backlog fixture");

  allowed(await admin.rpc("record_service_heartbeat", {
    p_duration_ms: 10,
    p_error_code: null,
    p_interval_seconds: 120,
    p_job_name: "media-processing",
    p_release: "phase7-local",
    p_state: "succeeded"
  }), "media heartbeat");
  allowed(await admin.rpc("record_scheduler_run", {
    p_correlation_id: randomUUID(),
    p_duration_ms: null,
    p_error_code: null,
    p_job_name: "phase7-missed-fixture",
    p_next_expected_at: new Date(Date.now() - 60_000).toISOString(),
    p_release: "phase7-local",
    p_run_id: missedRunId,
    p_state: "started"
  }), "missed scheduler fixture");

  const denied = await anon.rpc("production_operations_health");
  assert.ok(denied.error, "anonymous operations health unexpectedly succeeded");
  const health = allowed(await admin.rpc("production_operations_health"), "service operations health");
  assert.equal(health.migrationHead, "202607130010");
  assert.ok(health.media.deadLetter >= 1, "media dead letter is not visible");
  assert.ok(health.media.imageDeadLetter >= 1, "image dead letter is not classified");
  assert.equal(health.media.workerHeartbeatMissed, 0, "fresh worker heartbeat is not healthy");
  assert.ok(health.accountDeletion.failed >= 1, "account deletion failure is not visible");
  assert.ok(health.moderation.pending >= 1 && health.moderation.providerFailures >= 1, "moderation backlog/provider failure is not visible");
  assert.ok(health.scheduler.missedJobs >= 1, "missed schedule is not visible");
  const reconciliation = allowed(await admin.rpc("reconcile_push_delivery_jobs", { p_apply: false, p_limit: 10 }), "push reconciliation dry run");
  assert.equal(reconciliation.apply, false);
  console.log("Phase 7 operational runtime validation passed 9/9.");
} finally {
  await admin.from("operational_scheduler_runs").delete().eq("id", missedRunId);
  await admin.from("operational_scheduler_heartbeats").delete().eq("job_name", "phase7-missed-fixture");
  await admin.from("account_deletion_jobs").delete().eq("id", deletionJobId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
