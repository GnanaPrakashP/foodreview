#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(import.meta.dirname, "..");
const results = [];

function record(name) {
  results.push(name);
  console.log(`PASS: ${name}`);
}

function runSupabase(args, label) {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`${label}_failed`);
}

function runNode(script, label) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`${label}_failed`);
}

function localEnvironment() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8"
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("local_supabase_status_unavailable");
  }
  return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
}

async function createFixtureData(label, version) {
  const env = localEnvironment();
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient(env.url, env.serviceKey, options);
  const nonce = `${label}${Date.now().toString(36)}`.replace(/[^a-z0-9]/g, "").slice(-12);
  const username = `up${nonce}`.slice(0, 20);
  const email = `phase3.upgrade.${nonce}@example.test`;
  const password = `Phase3-Upgrade-${nonce}!`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw new Error(`${label}_auth_seed_failed`);
  const userId = created.data.user.id;
  const profile = await admin.from("profiles").insert({
    account_type: "public",
    first_name: "Upgrade",
    id: userId,
    last_name: label,
    username
  });
  if (profile.error) throw new Error(`${label}_profile_seed_failed`);
  const review = await admin.from("reviews").insert({
    items: [], restaurant_name: `Upgrade ${label}`, reviewer_name: username, visibility: "public"
  }).select("id").single();
  if (review.error) throw new Error(`${label}_review_seed_failed`);

  const fixture = { admin, env, reviewId: review.data.id, userId, username };
  if (version === "202606020001") {
    const legacyPhoto = await admin.from("review_photos").insert({
      media_type: "image",
      position: 0,
      public_url: `legacy/${userId}/photo.jpg`,
      review_id: fixture.reviewId,
      size_bytes: 4,
      storage_path: `legacy/${userId}/photo.jpg`
    }).select("id").single();
    if (legacyPhoto.error) throw new Error(`${label}_legacy_media_seed_failed`);
    fixture.reviewPhotoId = legacyPhoto.data.id;
  }

  if (version === "202607130001" || version === "202607130003") {
    const assetId = randomUUID();
    const asset = await admin.from("media_assets").insert({
      access_class: "private_post",
      crop_rect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      id: assetId,
      media_type: "image",
      original_extension: "jpg",
      original_file_size_bytes: 4,
      original_mime_type: "image/jpeg",
      owner_id: userId,
      owner_name: username,
      source_bucket_id: "media-sources",
      source_storage_path: `sources/post/${userId}/${assetId}/original.jpg`,
      status: version === "202607130003" ? "uploaded" : "created",
      surface: "post",
      visibility: "private"
    });
    if (asset.error) throw new Error(`${label}_media_seed_failed`);
    fixture.assetId = assetId;
  }

  if (version === "202607130002") {
    const client = createClient(env.url, env.anonKey, options);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`${label}_sign_in_failed`);
    const requested = await client.rpc("request_account_deletion");
    if (requested.error || requested.data?.length !== 1) throw new Error(`${label}_deletion_seed_failed`);
    fixture.deletionJobId = requested.data[0].job_id;
  }

  return fixture;
}

async function verifyFixture(label, fixture) {
  const env = localEnvironment();
  const admin = createClient(env.url, env.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const profile = await admin.from("profiles").select("id, username").eq("id", fixture.userId).single();
  assert.equal(profile.error, null);
  assert.equal(profile.data.username, fixture.username);
  const review = await admin.from("reviews").select("id, reviewer_name").eq("id", fixture.reviewId).single();
  assert.equal(review.error, null);
  assert.equal(review.data.reviewer_name, fixture.username);
  if (fixture.reviewPhotoId) {
    const photo = await admin.from("review_photos").select("id, storage_path").eq("id", fixture.reviewPhotoId).single();
    assert.equal(photo.error, null);
    assert.ok(photo.data.storage_path.startsWith("legacy/"));
  }
  if (fixture.assetId) {
    const asset = await admin.from("media_assets").select("id, access_class, status").eq("id", fixture.assetId).single();
    assert.equal(asset.error, null);
    assert.equal(asset.data.access_class, "private_post");
    if (label === "post-phase2") {
      const job = await admin.from("media_processing_jobs").select("asset_id, status").eq("asset_id", fixture.assetId).single();
      assert.equal(job.error, null);
      assert.equal(job.data.status, "queued");
    }
  }
  if (fixture.deletionJobId) {
    const job = await admin.from("account_deletion_jobs").select("id, user_id, status").eq("id", fixture.deletionJobId).single();
    assert.equal(job.error, null);
    assert.equal(job.data.user_id, fixture.userId);
  }
  const contract = await admin.rpc("production_schema_contract");
  assert.equal(contract.error, null);
  for (const key of [
    "missingCriticalTables", "rlsDisabledTables", "privateBucketDrift",
    "missingWorkerFunctions", "clientWorkerFunctionGrants", "clientTableGrantDrift",
    "serviceTableGrantDrift", "unsafeDefinerFunctions", "invalidIndexes",
    "unvalidatedConstraints"
  ]) assert.deepEqual(contract.data[key], [], `${label}:${key}`);
}

function executableSql(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const fixtures = [
  { label: "legacy-root-only", version: "202606020001" },
  { label: "pre-phase1a", version: "202607120002" },
  { label: "post-phase1a", version: "202607130001" },
  { label: "post-phase1b", version: "202607130002" },
  { label: "post-phase2", version: "202607130003" }
];

try {
  const manifest = JSON.parse(readFileSync(path.join(root, "docs/database/migration-history-manifest.json"), "utf8"));
  assert.equal(manifest.totals.mobileOnlyVersions, 31);
  assert.ok(manifest.entries.some((entry) => entry.filename === "202607080001_circle_production_hardening.sql" && entry.sourceRoot === "mobile/supabase/migrations"));
  assert.ok(!manifest.entries.some((entry) => entry.filename === "202606020001_post_views.sql" && entry.sourceRoot === "mobile/supabase/migrations"));
  record("legacy mobile-only chain is detected as unsupported without the missing post_views dependency");

  for (const conflict of manifest.conflicts) {
    const canonicalEntry = manifest.entries.find((entry) => entry.version === conflict.version && entry.sourceRoot === "supabase/migrations");
    const canonicalSql = readFileSync(path.join(root, "supabase/migrations", canonicalEntry.filename), "utf8");
    const archivedSql = readFileSync(path.join(root, "docs/database/legacy-mobile-migrations", canonicalEntry.filename), "utf8");
    assert.equal(executableSql(canonicalSql), executableSql(archivedSql));
  }
  record("both conflicting historical versions are preserved and executable-SQL equivalent");

  for (const fixtureDefinition of fixtures) {
    runSupabase(["db", "reset", "--version", fixtureDefinition.version], `${fixtureDefinition.label}_reset`);
    const fixture = await createFixtureData(fixtureDefinition.label, fixtureDefinition.version);
    runSupabase(["migration", "up", "--local"], `${fixtureDefinition.label}_upgrade`);
    await verifyFixture(fixtureDefinition.label, fixture);
    runNode("tests/supabase-phase3-policy-validation.mjs", `${fixtureDefinition.label}_policy_validation`);
    record(`${fixtureDefinition.label} upgrades to the canonical schema with data preserved`);
  }
} catch (error) {
  const code = error instanceof Error ? error.message.split(":")[0] : "upgrade_validation_failed";
  console.error(`phase3-upgrade-validation failed:${code}`);
  process.exitCode = 1;
} finally {
  try {
    runSupabase(["db", "reset"], "restore_current_schema");
  } catch {
    console.error("phase3-upgrade-validation failed:restore_current_schema_failed");
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`Phase 3 upgrade validation passed ${results.length}/${results.length}.`);
