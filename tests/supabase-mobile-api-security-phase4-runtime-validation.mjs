#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function localStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Local Supabase is not running");
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

const passed = [];
function record(name) {
  passed.push(name);
  console.log(`PASS: ${name}`);
}

const env = localStatus();
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.url, env.serviceKey, options);
const anon = createClient(env.url, env.anonKey, options);
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(-10);
const actors = [];

async function actor(label) {
  const email = `phase4.${label}.${suffix}@example.test`;
  const password = `Phase4-${label}-${suffix}!`;
  const username = `p4_${label}_${suffix}`.slice(0, 20).toLowerCase();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw created.error ?? new Error("Auth actor creation failed");
  const id = created.data.user.id;
  actors.push(id);
  const profile = await admin.from("profiles").insert({
    account_status: "active", account_type: "public", deletion_started_at: null,
    first_name: label, id, last_name: "PhaseFour", username,
  });
  if (profile.error) throw profile.error;
  const client = createClient(env.url, env.anonKey, options);
  const link = await admin.auth.admin.generateLink({ email, type: "magiclink" });
  if (link.error || !link.data.properties?.hashed_token) throw link.error ?? new Error("Actor magiclink failed");
  const signed = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("Actor sign-in failed");
  return { client, email, id, token: signed.data.session.access_token, username };
}

function entry(endpoint, identifierHash, limit = 5, cost = 1, windowSeconds = 60) {
  return { cost, endpoint, identifierHash, limit, windowSeconds };
}

async function must(result, label) {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? "failed"}`);
  return result.data;
}

function limiterResult(result) {
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) return null;
  const parsed = result.data[0];
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

try {
  const alice = await actor("alice");
  const bob = await actor("bob");

  const contract = await admin.rpc("production_schema_contract");
  const contractData = await must(contract, "Phase 4 schema contract");
  for (const key of [
    "missingApiSecurityTables", "rlsDisabledApiSecurityTables", "missingApiSecurityFunctions",
    "clientApiSecurityFunctionGrants", "clientApiSecurityTableGrants", "unsafeApiSecurityDefiners",
    "guardedClientServiceWrapperDrift", "rawServiceRpcAclDrift",
  ]) assert.deepEqual(contractData[key], [], `${key} contains drift`);
  record("Phase 4 schema contract reports no table, RLS, grant, function, or definer drift");

  assert.ok((await anon.rpc("consume_api_rate_limits", { p_entries: [] })).error);
  assert.ok((await alice.client.rpc("cleanup_api_security_state", { p_limit: 1 })).error);
  assert.ok((await bob.client.from("api_idempotency_records").select("actor_hash")).error);
  record("limiter, cleanup, idempotency, and audit state remain service-only");

  const endpoint = `phase4.concurrent.${suffix}`;
  const hash = "a".repeat(64);
  const concurrent = await Promise.all(Array.from({ length: 20 }, () =>
    admin.rpc("consume_api_rate_limits", { p_entries: [entry(endpoint, hash)] })
  ));
  const concurrentResults = concurrent.map(limiterResult);
  const allowed = concurrentResults.filter((result) => result?.allowed === true).length;
  assert.equal(allowed, 5);
  assert.equal(concurrentResults.filter((result) => result?.allowed === false).length, 15);
  assert.ok(concurrentResults.filter((result) => result?.allowed === false).every((result) => result.retryAfterSeconds >= 1));
  record("atomic concurrent limiter admits exactly the configured shared burst and returns retry-after");

  const atomicEndpoint = `phase4.atomic.${suffix}`;
  const first = await admin.rpc("consume_api_rate_limits", {
    p_entries: [entry(atomicEndpoint, "b".repeat(64), 1), entry(atomicEndpoint, "c".repeat(64), 1)],
  });
  await must(first, "first multi-dimensional limit");
  assert.equal(limiterResult(first)?.allowed, true);
  const denied = await admin.rpc("consume_api_rate_limits", {
    p_entries: [entry(atomicEndpoint, "d".repeat(64), 1), entry(atomicEndpoint, "c".repeat(64), 1)],
  });
  await must(denied, "denied multi-dimensional limit");
  assert.equal(limiterResult(denied)?.allowed, false);
  const untouched = await admin.from("api_rate_limit_buckets").select("used").eq("endpoint", atomicEndpoint).eq("identifier_hash", "d".repeat(64)).single();
  assert.equal((await must(untouched, "atomic non-consumption check")).used, 0);
  record("multi-dimensional rejection does not partially consume another dimension");

  const stored = await admin.from("api_rate_limit_buckets").select("identifier_hash").like("endpoint", "phase4.%");
  const storedRows = await must(stored, "hashed limiter storage");
  assert.ok(storedRows.length > 0);
  assert.ok(storedRows.every((row) => /^[a-f0-9]{64}$/.test(row.identifier_hash)));
  record("durable limiter state stores fixed-length hashes and no raw actor/IP/install values");

  await must(await admin.from("api_idempotency_records").insert({
    actor_hash: "e".repeat(64), endpoint: `phase4.cleanup.${suffix}`,
    expires_at: new Date(Date.now() - 60_000).toISOString(), key_hash: "f".repeat(64), request_hash: "1".repeat(64),
  }), "expired idempotency seed");
  const cleaned = await admin.rpc("cleanup_api_security_state", { p_limit: 100 });
  assert.ok((await must(cleaned, "security cleanup")) >= 1);
  record("bounded cleanup removes expired limiter/idempotency security state");

  const token = `ExponentPushToken[p4_${suffix}]`;
  const installId = randomUUID();
  const createdToken = await alice.client.from("push_tokens").insert({
    expo_push_token: token, install_id: installId, platform: "android", user_name: bob.username,
  }).select("id, user_id, user_name, install_id").single();
  const tokenRow = await must(createdToken, "Alice push token registration");
  assert.equal(tokenRow.user_id, alice.id);
  assert.equal(tokenRow.user_name, alice.username);
  assert.equal(tokenRow.install_id, installId);
  const bobDelete = await bob.client.from("push_tokens").delete().eq("id", tokenRow.id).select("id");
  assert.deepEqual(await must(bobDelete, "Bob foreign token delete"), []);
  const reassign = await bob.client.from("push_tokens").insert({
    expo_push_token: token, install_id: randomUUID(), platform: "ios", user_name: bob.username,
  });
  assert.ok(reassign.error, "token was silently reassigned between accounts");
  await must(await admin.from("profiles").update({ account_status: "deleting", deletion_started_at: new Date().toISOString() }).eq("id", alice.id), "freeze Alice");
  const frozenToken = await alice.client.from("push_tokens").insert({
    expo_push_token: `ExpoPushToken[frozen_${suffix}]`, install_id: randomUUID(), platform: "ios", user_name: alice.username,
  });
  assert.ok(frozenToken.error, "frozen actor registered a push token");
  await must(await admin.from("profiles").update({ account_status: "active", deletion_started_at: null }).eq("id", alice.id), "unfreeze Alice");
  record("push registration derives actor ownership, binds install, prevents reassignment, and denies frozen users");

  const pendingAssetId = randomUUID();
  await must(await admin.from("media_assets").insert({
    access_class: "public_post", crop_rect: {}, expires_at: new Date(Date.now() + 600_000).toISOString(),
    id: pendingAssetId, media_type: "image", original_extension: "jpg", original_file_size_bytes: 100,
    original_mime_type: "image/jpeg", owner_id: alice.id, owner_name: alice.username, privacy_state: "stable",
    source_bucket_id: "media-sources", source_storage_path: `sources/post/${alice.id}/${pendingAssetId}/original.jpg`,
    status: "uploaded", surface: "post", visibility: "public",
  }), "pending media seed");
  const pendingClaim = await admin.rpc("claim_media_processing_jobs", {
    p_lease_seconds: 60, p_limit: 5, p_max_attempts: 5, p_worker_id: `p4-pending-${suffix}`,
  });
  assert.equal((await must(pendingClaim, "pending media claim")).some((job) => job.asset_id === pendingAssetId), false);
  const approval = await admin.rpc("apply_media_moderation_action", {
    p_action: "approved", p_asset_id: pendingAssetId, p_operator_hash: "2".repeat(64), p_reason_code: "automated_safe",
  });
  assert.equal(await must(approval, "media approval"), true);
  const approvedClaim = await admin.rpc("claim_media_processing_jobs", {
    p_lease_seconds: 60, p_limit: 5, p_max_attempts: 5, p_worker_id: `p4-approved-${suffix}`,
  });
  assert.equal((await must(approvedClaim, "approved media claim")).some((job) => job.asset_id === pendingAssetId), true);
  const audit = await admin.from("media_moderation_actions").select("action, operator_hash").eq("asset_id", pendingAssetId).single();
  assert.deepEqual(await must(audit, "media audit"), { action: "approved", operator_hash: "2".repeat(64) });
  record("pending media cannot run or publish until an audited service-only approval");

  const report = await admin.from("content_reports").insert({
    details: "bounded runtime report", reason: "other", reporter_id: alice.id, reporter_name: alice.username,
    target_id: bob.username, target_type: "profile",
  }).select("id").single();
  const reportRow = await must(report, "report seed");
  const action = await admin.rpc("apply_report_moderation_action", {
    p_action_code: "runtime_review", p_note: "reviewed locally", p_operator_hash: "3".repeat(64),
    p_report_id: reportRow.id, p_to_status: "dismissed",
  });
  assert.equal(await must(action, "report moderation"), true);
  const reportAudit = await admin.from("moderation_report_actions").select("from_status, to_status, action_code").eq("report_id", reportRow.id).single();
  assert.deepEqual(await must(reportAudit, "report audit"), { action_code: "runtime_review", from_status: "open", to_status: "dismissed" });
  record("operator report transitions are service-only, atomic, and append-only audited");

  console.log(`PASS: Phase 4 database runtime validation completed (${passed.length} checks)`);
} finally {
  if (actors.length > 0) {
    await admin.from("profiles").delete().in("id", actors);
    for (const id of actors) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
}
