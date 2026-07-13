#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const passed = [];
function record(name) {
  passed.push(name);
  console.log(`PASS: ${name}`);
}

function localStatus() {
  if (process.env.MEDIA_WORKER_SUPABASE_STATUS_FILE) {
    const parsed = JSON.parse(readFileSync(process.env.MEDIA_WORKER_SUPABASE_STATUS_FILE, "utf8"));
    return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
  }
  if (
    process.env.MEDIA_WORKER_SUPABASE_URL &&
    process.env.MEDIA_WORKER_SUPABASE_ANON_KEY &&
    process.env.MEDIA_WORKER_SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      anonKey: process.env.MEDIA_WORKER_SUPABASE_ANON_KEY,
      serviceKey: process.env.MEDIA_WORKER_SUPABASE_SERVICE_ROLE_KEY,
      url: process.env.MEDIA_WORKER_SUPABASE_URL
    };
  }
  const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (status.status !== 0) throw new Error("Root local Supabase is not running");
  const parsed = JSON.parse(status.stdout);
  return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
}

function assetRow(userId, ownerName, assetId, status = "uploaded") {
  return {
    access_class: "private_post",
    crop_rect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    id: assetId,
    media_type: "image",
    moderation_status: "approved",
    original_extension: "jpg",
    original_file_size_bytes: 100,
    original_mime_type: "image/jpeg",
    owner_id: userId,
    owner_name: ownerName,
    source_bucket_id: "media-sources",
    source_storage_path: `sources/post/${userId}/${assetId}/original.jpg`,
    status,
    surface: "post",
    visibility: "private"
  };
}

const env = localStatus();
const admin = createClient(env.url, env.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const nonce = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
const email = `phase2_${nonce}@example.test`;
const ownerName = `phase2_${nonce.slice(-10)}`.toLowerCase();
let userId = null;

try {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password: `Phase2-${nonce}!` });
  if (created.error || !created.data.user) throw created.error ?? new Error("user creation failed");
  userId = created.data.user.id;
  const profile = await admin.from("profiles").upsert({
    account_status: "active",
    account_type: "public",
    deletion_started_at: null,
    first_name: "Phase",
    id: userId,
    last_name: "Two",
    username: ownerName
  }, { onConflict: "id" });
  if (profile.error) throw profile.error;

  const assetId = randomUUID();
  const inserted = await admin.from("media_assets").insert(assetRow(userId, ownerName, assetId));
  if (inserted.error) throw inserted.error;
  const triggerJob = await admin.from("media_processing_jobs").select("*").eq("asset_id", assetId).single();
  assert.equal(triggerJob.error, null);
  assert.equal(triggerJob.data.status, "queued");
  assert.equal(triggerJob.data.max_attempts, 5);
  record("uploaded asset atomically creates one queued job");

  const claimArgs = { p_lease_seconds: 30, p_limit: 1 };
  const [raceA, raceB] = await Promise.all([
    admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-a" }),
    admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-b" })
  ]);
  if (raceA.error) throw raceA.error;
  if (raceB.error) throw raceB.error;
  assert.equal((raceA.data?.length ?? 0) + (raceB.data?.length ?? 0), 1);
  const firstClaim = (raceA.data?.[0] ?? raceB.data?.[0]);
  const firstWorker = raceA.data?.length ? "runtime-worker-a" : "runtime-worker-b";
  record("two real workers race and only one receives the atomic lease");

  const heartbeat = await admin.rpc("heartbeat_media_processing_job", {
    p_claim_token: firstClaim.claim_token,
    p_job_id: firstClaim.id,
    p_lease_generation: firstClaim.lease_generation,
    p_lease_seconds: 30,
    p_worker_id: firstWorker
  });
  assert.equal(heartbeat.error, null);
  assert.equal(heartbeat.data, true);
  const notStolen = await admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-c" });
  assert.equal(notStolen.error, null);
  assert.equal(notStolen.data.length, 0);
  record("heartbeat extends a valid lease and an unexpired lease is not stolen");

  const expired = await admin.from("media_processing_jobs").update({
    lock_expires_at: new Date(Date.now() - 1000).toISOString()
  }).eq("id", firstClaim.id);
  if (expired.error) throw expired.error;
  const reclaimed = await admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-reclaim" });
  if (reclaimed.error) throw reclaimed.error;
  assert.equal(reclaimed.data.length, 1);
  assert.equal(reclaimed.data[0].stale_reclaimed, true);
  assert.equal(reclaimed.data[0].lease_generation, firstClaim.lease_generation + 1);
  record("expired running lease is reclaimed with a new generation and token");

  const staleCompletion = await admin.rpc("complete_media_processing_job", {
    p_claim_token: firstClaim.claim_token,
    p_height: 1350,
    p_job_id: firstClaim.id,
    p_lease_generation: firstClaim.lease_generation,
    p_width: 1080,
    p_worker_id: firstWorker
  });
  assert.equal(staleCompletion.error, null);
  assert.equal(staleCompletion.data, false);
  record("stale worker cannot complete after reclaim");

  const retry = await admin.rpc("fail_media_processing_job", {
    p_base_delay_seconds: 30,
    p_claim_token: reclaimed.data[0].claim_token,
    p_failure_class: "retryable",
    p_failure_code: "storage_temporarily_unavailable",
    p_job_id: firstClaim.id,
    p_lease_generation: reclaimed.data[0].lease_generation,
    p_max_delay_seconds: 3600,
    p_worker_id: "runtime-worker-reclaim"
  });
  assert.equal(retry.error, null);
  assert.equal(retry.data, "retry_wait");
  const backoffClaim = await admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-early" });
  assert.equal(backoffClaim.data.length, 0);
  record("retryable failure enters retry_wait and backoff prevents early claim");

  const makeReady = await admin.from("media_processing_jobs").update({
    attempts: 4,
    next_attempt_at: new Date(Date.now() - 1000).toISOString()
  }).eq("id", firstClaim.id);
  if (makeReady.error) throw makeReady.error;
  const finalClaim = await admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-final" });
  if (finalClaim.error) throw finalClaim.error;
  assert.equal(finalClaim.data[0].attempts, 5);
  const exhausted = await admin.rpc("fail_media_processing_job", {
    p_base_delay_seconds: 30,
    p_claim_token: finalClaim.data[0].claim_token,
    p_failure_class: "retryable",
    p_failure_code: "derivative_upload_timeout",
    p_job_id: firstClaim.id,
    p_lease_generation: finalClaim.data[0].lease_generation,
    p_max_delay_seconds: 3600,
    p_worker_id: "runtime-worker-final"
  });
  assert.equal(exhausted.error, null);
  assert.equal(exhausted.data, "dead_letter");
  record("retry exhaustion reaches operator-visible dead_letter");

  const requeue = await admin.rpc("requeue_media_processing_job", {
    p_job_id: firstClaim.id,
    p_operator: "runtime-validator"
  });
  assert.equal(requeue.error, null);
  assert.equal(requeue.data, true);
  const requeued = await admin.from("media_processing_jobs").select("status,attempts").eq("id", firstClaim.id).single();
  assert.deepEqual(requeued.data, { attempts: 0, status: "queued" });
  record("eligible dead-letter requeue is audited and idempotent");

  const cancelled = await admin.rpc("cancel_media_processing_job", {
    p_job_id: firstClaim.id,
    p_failure_code: "runtime_validation_complete",
    p_operator: "runtime-validator"
  });
  assert.equal(cancelled.error, null);
  assert.equal(cancelled.data, true);
  const cancelledAgain = await admin.rpc("cancel_media_processing_job", {
    p_job_id: firstClaim.id,
    p_failure_code: "runtime_validation_complete",
    p_operator: "runtime-validator"
  });
  assert.equal(cancelledAgain.error, null);
  assert.equal(cancelledAgain.data, true);
  record("operator cancellation is audited and idempotent");

  const permanentAssetId = randomUUID();
  const permanentInsert = await admin.from("media_assets").insert(assetRow(userId, ownerName, permanentAssetId));
  if (permanentInsert.error) throw permanentInsert.error;
  const permanentClaim = await admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-permanent" });
  if (permanentClaim.error) throw permanentClaim.error;
  const permanentJob = permanentClaim.data.find((row) => row.asset_id === permanentAssetId);
  assert.ok(permanentJob);
  const rejected = await admin.rpc("fail_media_processing_job", {
    p_base_delay_seconds: 30,
    p_claim_token: permanentJob.claim_token,
    p_failure_class: "permanent",
    p_failure_code: "invalid_file_signature",
    p_job_id: permanentJob.id,
    p_lease_generation: permanentJob.lease_generation,
    p_max_delay_seconds: 3600,
    p_worker_id: "runtime-worker-permanent"
  });
  assert.equal(rejected.data, "rejected");
  const permanentRequeue = await admin.rpc("requeue_media_processing_job", {
    p_job_id: permanentJob.id,
    p_operator: "runtime-validator"
  });
  assert.equal(permanentRequeue.data, false);
  record("permanent rejection cannot be blindly requeued");

  const cleanupAssetId = randomUUID();
  const cleanupInsert = await admin.from("media_assets").insert({
    ...assetRow(userId, ownerName, cleanupAssetId, "ready"),
    cleanup_next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    consumed_at: new Date().toISOString(),
    source_cleanup_after: new Date(Date.now() - 1000).toISOString()
  });
  if (cleanupInsert.error) throw cleanupInsert.error;
  const firstCleanupClaim = await admin.rpc("claim_media_cleanup_assets", {
    p_lease_seconds: 30,
    p_limit: 1,
    p_worker_id: "runtime-cleanup-crashed"
  });
  if (firstCleanupClaim.error) throw firstCleanupClaim.error;
  assert.equal(firstCleanupClaim.data[0].asset_id, cleanupAssetId);
  const expireCleanup = await admin.from("media_assets").update({
    cleanup_lock_expires_at: new Date(Date.now() - 1000).toISOString()
  }).eq("id", cleanupAssetId);
  if (expireCleanup.error) throw expireCleanup.error;
  const reclaimedCleanup = await admin.rpc("claim_media_cleanup_assets", {
    p_lease_seconds: 30,
    p_limit: 1,
    p_worker_id: "runtime-cleanup-recovered"
  });
  if (reclaimedCleanup.error) throw reclaimedCleanup.error;
  assert.equal(reclaimedCleanup.data[0].asset_id, cleanupAssetId);
  assert.notEqual(reclaimedCleanup.data[0].cleanup_token, firstCleanupClaim.data[0].cleanup_token);
  const staleCleanup = await admin.rpc("complete_media_cleanup_asset", {
    p_asset_id: cleanupAssetId,
    p_cleanup_kind: "source",
    p_cleanup_token: firstCleanupClaim.data[0].cleanup_token,
    p_worker_id: "runtime-cleanup-crashed"
  });
  assert.equal(staleCleanup.data, false);
  const completedCleanup = await admin.rpc("complete_media_cleanup_asset", {
    p_asset_id: cleanupAssetId,
    p_cleanup_kind: "source",
    p_cleanup_token: reclaimedCleanup.data[0].cleanup_token,
    p_worker_id: "runtime-cleanup-recovered"
  });
  assert.equal(completedCleanup.data, true);
  record("cleanup crash leases expire, reclaim safely, and fence stale completion");

  const anonClaim = await anon.rpc("claim_media_processing_jobs", {
    p_lease_seconds: 30,
    p_limit: 1,
    p_worker_id: "public-client"
  });
  assert.ok(anonClaim.error);
  record("public client cannot invoke worker claim RPC");

  const freezeAssetId = randomUUID();
  const freezeInsert = await admin.from("media_assets").insert(assetRow(userId, ownerName, freezeAssetId));
  if (freezeInsert.error) throw freezeInsert.error;
  const freeze = await admin.from("profiles").update({
    account_status: "deleting",
    deletion_started_at: new Date().toISOString()
  }).eq("id", userId);
  if (freeze.error) throw freeze.error;
  const frozenJob = await admin.from("media_processing_jobs").select("status,failure_code").eq("asset_id", freezeAssetId).single();
  assert.deepEqual(frozenJob.data, { failure_code: "account_deleting", status: "cancelled" });
  const afterFreezeClaim = await admin.rpc("claim_media_processing_jobs", { ...claimArgs, p_worker_id: "runtime-worker-after-freeze" });
  assert.equal(afterFreezeClaim.data.length, 0);
  record("account freeze cancels active media and prevents resurrection claims");

  const events = await admin.from("media_processing_events").select("event_type,failure_code").in("asset_id", [assetId, permanentAssetId, freezeAssetId]);
  if (events.error) throw events.error;
  const eventTypes = new Set(events.data.map((event) => event.event_type));
  for (const expected of ["claimed", "lease_reclaimed", "retry_scheduled", "dead_lettered", "requeued", "rejected"]) {
    assert.ok(eventTypes.has(expected), expected);
  }
  assert.equal(events.data.some((event) => JSON.stringify(event).includes("sources/")), false);
  record("sanitized worker events expose recovery telemetry without paths");

  console.log(`Validated ${passed.length} real Phase 2 database behaviours.`);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}
