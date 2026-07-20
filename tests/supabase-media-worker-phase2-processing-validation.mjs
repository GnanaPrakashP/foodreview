#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const passed = [];
function record(name) {
  passed.push(name);
  console.log(`PASS: ${name}`);
}

function localStatus() {
  const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (status.status !== 0) throw new Error("Root local Supabase is not running");
  const parsed = JSON.parse(status.stdout);
  return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
}

function assertNoError(result, operation) {
  if (result.error) throw new Error(`${operation}_failed`);
  return result.data;
}

async function waitForHealth(baseUrl, secret, server) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error("media_server_exited");
    try {
      // Phase 7 adds scheduler-heartbeat freshness to the steady-state health
      // endpoint. Processing validation needs the explicit startup probe so it
      // verifies database/ffmpeg/ffprobe readiness before a scheduler exists.
      const response = await fetch(`${baseUrl}/api/internal/media/health?startup=1`, {
        headers: { Authorization: `Bearer ${secret}` }
      });
      if (response.ok && (await response.json()).ready === true) return;
    } catch {
      // The local Next server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("media_server_health_timeout");
}

async function internalRequest(baseUrl, secret, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    method: "POST"
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.ok, true, `${route} failed with ${response.status}`);
  assert.equal(payload?.ok, true);
  return payload;
}

async function objectExists(admin, bucket, objectPath) {
  const segments = objectPath.split("/");
  const name = segments.pop();
  const { data, error } = await admin.storage.from(bucket).list(segments.join("/"), { limit: 10, search: name });
  if (error) throw new Error("storage_list_failed");
  return (data ?? []).some((entry) => entry.name === name);
}

const env = localStatus();
const admin = createClient(env.url, env.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const nonce = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
const ownerName = `p2m_${nonce.slice(-8)}`.toLowerCase();
const email = `${ownerName}@example.test`;
const port = 3042;
const baseUrl = `http://127.0.0.1:${port}`;
const secret = "phase2-local-processing-secret-validated-42";
const root = await mkdtemp(path.join(tmpdir(), "foodreview-phase2-processing-"));
const mediaTemp = path.join(root, "worker-temp");
const videoPath = path.join(root, "source.mp4");
let server = null;
let serverOutput = "";
let userId = null;

try {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password: `Phase2-${nonce}!` });
  if (created.error || !created.data.user) throw new Error("user_creation_failed");
  userId = created.data.user.id;
  assertNoError(await admin.from("profiles").upsert({
    account_status: "active",
    account_type: "public",
    deletion_started_at: null,
    first_name: "Media",
    id: userId,
    last_name: "Worker",
    username: ownerName
  }, { onConflict: "id" }), "profile_upsert");

  const image = await sharp({
    create: { background: { b: 40, g: 120, r: 230 }, channels: 3, height: 800, width: 640 }
  }).jpeg({ quality: 90 }).toBuffer();
  const ffmpeg = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x400:rate=24",
    "-t", "1.25", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath
  ], { encoding: "utf8" });
  assert.equal(ffmpeg.status, 0, "real test-video generation failed");
  const video = await readFile(videoPath);
  const invalid = Buffer.from("not-a-real-image-phase2");
  record("generated real JPEG and H.264 MP4 fixtures with the installed media toolchain");

  const fixtures = [
    { buffer: image, extension: "jpg", id: randomUUID(), mediaType: "image", mimeType: "image/jpeg" },
    { buffer: video, extension: "mp4", id: randomUUID(), mediaType: "video", mimeType: "video/mp4" },
    { buffer: invalid, extension: "jpg", id: randomUUID(), mediaType: "image", mimeType: "image/jpeg" }
  ].map((fixture) => ({
    ...fixture,
    sourcePath: `sources/post/${userId}/${fixture.id}/original.${fixture.extension}`
  }));

  for (const fixture of fixtures) {
    assertNoError(await admin.from("media_assets").insert({
      access_class: "private_post",
      crop_rect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      id: fixture.id,
      media_type: fixture.mediaType,
      original_extension: fixture.extension,
      original_file_size_bytes: fixture.buffer.byteLength,
      original_mime_type: fixture.mimeType,
      owner_id: userId,
      owner_name: ownerName,
      source_bucket_id: "media-sources",
      source_storage_path: fixture.sourcePath,
      status: "created",
      surface: "post",
      visibility: "private"
    }), "asset_insert");
    assertNoError(await admin.storage.from("media-sources").upload(fixture.sourcePath, fixture.buffer, {
      contentType: fixture.mimeType,
      upsert: false
    }), "source_upload");
    assertNoError(await admin.from("media_assets").update({
      status: "uploaded",
      uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", fixture.id), "asset_finalize");
    const moderation = await admin.rpc("apply_media_moderation_action", {
      p_action: "approved",
      p_asset_id: fixture.id,
      p_operator_hash: "a".repeat(64),
      p_reason_code: "phase2_processing_verified"
    });
    assertNoError(moderation, "asset_moderation");
    assert.equal(moderation.data, true, "test operator should release the quarantined asset");
  }
  const queued = assertNoError(await admin.from("media_processing_jobs").select("asset_id,status").in("asset_id", fixtures.map((row) => row.id)), "queued_jobs");
  assert.equal(queued.length, 3);
  assert.ok(queued.every((row) => row.status === "queued"));
  record("real Storage sources transition atomically to one queued job per asset");

  server = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MEDIA_WORKER_CONCURRENCY: "3",
      MEDIA_WORKER_HEARTBEAT_MS: "10000",
      MEDIA_WORKER_LEASE_SECONDS: "60",
      MEDIA_WORKER_SECRET: secret,
      MEDIA_WORKER_TEMP_DIR: mediaTemp,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const capture = (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-100_000);
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  await waitForHealth(baseUrl, secret, server);
  record("protected readiness verifies database, ffmpeg, and ffprobe dependencies");

  const hidden = await fetch(`${baseUrl}/api/internal/media/health`);
  assert.equal(hidden.status, 404);
  const oversized = await fetch(`${baseUrl}/api/internal/media/process`, {
    body: JSON.stringify({ padding: "x".repeat(5000) }),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    method: "POST"
  });
  assert.equal(oversized.status, 413);
  record("internal routes fail closed and reject oversized request bodies");

  const processing = await internalRequest(baseUrl, secret, "/api/internal/media/process", {
    limit: 3,
    workerId: "phase2-real-processing"
  });
  assert.equal(processing.processed, 3);
  assert.equal(processing.succeeded, 2);
  assert.equal(processing.rejected, 1);

  const assets = assertNoError(await admin.from("media_assets")
    .select("id,status,failure_code,duration_ms,source_storage_path")
    .in("id", fixtures.map((row) => row.id)), "processed_assets");
  const byId = new Map(assets.map((row) => [row.id, row]));
  assert.equal(byId.get(fixtures[0].id).status, "ready");
  assert.equal(byId.get(fixtures[1].id).status, "ready");
  assert.ok(byId.get(fixtures[1].id).duration_ms >= 1000);
  assert.equal(byId.get(fixtures[2].id).status, "rejected");
  assert.equal(byId.get(fixtures[2].id).failure_code, "invalid_file_signature");
  const jobs = assertNoError(await admin.from("media_processing_jobs").select("asset_id,status,attempts,failure_code").in("asset_id", fixtures.map((row) => row.id)), "processed_jobs");
  assert.deepEqual(jobs.map((row) => row.status).sort(), ["rejected", "succeeded", "succeeded"]);
  record("real image and video processing succeeds while a spoofed source is permanently rejected");

  const derivatives = assertNoError(await admin.from("media_derivatives")
    .select("asset_id,kind,bucket_id,storage_path,public_url,mime_type,width,height,duration_ms")
    .in("asset_id", [fixtures[0].id, fixtures[1].id]), "derivatives");
  assert.equal(derivatives.length, 5);
  assert.deepEqual(derivatives.filter((row) => row.asset_id === fixtures[0].id).map((row) => row.kind).sort(), ["canonical", "feed", "thumbnail"]);
  assert.deepEqual(derivatives.filter((row) => row.asset_id === fixtures[1].id).map((row) => row.kind).sort(), ["canonical", "poster"]);
  assert.ok(derivatives.every((row) => row.bucket_id === "media-private" && row.public_url === null));
  for (const derivative of derivatives) {
    assert.equal(await objectExists(admin, derivative.bucket_id, derivative.storage_path), true);
    assert.equal(derivative.storage_path, `private-posts/${userId}/${derivative.asset_id}/${derivative.kind}.${derivative.kind === "canonical" && derivative.asset_id === fixtures[1].id ? "mp4" : "jpg"}`);
  }
  const bucket = assertNoError(await admin.storage.getBucket("media-private"), "private_bucket");
  assert.equal(bucket.public, false);
  record("deterministic derivatives exist only in the private bucket with no permanent public URL");

  const reconcile = spawnSync(process.execPath, [
    "scripts/media-reconcile.mjs",
    `--user=${userId}`,
    "--scan-storage=true",
    "--max-pages=5",
    "--max-storage-objects=500"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    }
  });
  assert.equal(reconcile.status, 0, "user-scoped reconciliation failed");
  const report = JSON.parse(reconcile.stdout);
  assert.equal(report.apply, false);
  assert.equal(report.counts.missingSources, 0);
  assert.equal(report.counts.missingDerivativeObjects, 0);
  assert.equal(report.counts.partialDerivatives, 0);
  assert.equal(report.counts.readyMetadataMismatch, 0);
  assert.equal(report.counts.orphanedDerivativeObjects, null);
  assert.equal(report.storageScan.enabled, true);
  assert.equal(reconcile.stdout.includes(userId), false);
  assert.equal(reconcile.stdout.includes(env.serviceKey), false);
  record("dry-run reconciliation verifies user-scoped database and Storage consistency with redacted output");

  assert.deepEqual(await readdir(mediaTemp), []);
  assert.equal(serverOutput.includes(env.serviceKey), false);
  assert.equal(serverOutput.includes(secret), false);
  assert.ok(fixtures.every((fixture) => !serverOutput.includes(fixture.sourcePath)));
  record("successful and rejected jobs leave no temporary files or sensitive path/credential logs");

  const past = new Date(Date.now() - 60_000).toISOString();
  assertNoError(await admin.from("media_assets").update({
    cleanup_next_attempt_at: past,
    consumed_at: new Date().toISOString(),
    source_cleanup_after: past
  }).in("id", [fixtures[0].id, fixtures[1].id]), "ready_cleanup_schedule");
  assertNoError(await admin.from("media_assets").update({
    cleanup_next_attempt_at: past,
    source_cleanup_after: past
  }).eq("id", fixtures[2].id), "rejected_cleanup_schedule");
  const firstCleanup = await internalRequest(baseUrl, secret, "/api/internal/media/cleanup", {
    limit: 10,
    workerId: "phase2-real-cleanup"
  });
  assert.equal(firstCleanup.claimed, 3);
  assert.equal(firstCleanup.cleaned, 3);
  assert.equal(firstCleanup.failed, 0);
  for (const fixture of fixtures) assert.equal(await objectExists(admin, "media-sources", fixture.sourcePath), false);
  const retained = assertNoError(await admin.from("media_assets").select("id,status,source_deleted_at").in("id", [fixtures[0].id, fixtures[1].id]), "retained_assets");
  assert.equal(retained.length, 2);
  assert.ok(retained.every((row) => row.status === "ready" && row.source_deleted_at));
  assert.equal(assertNoError(await admin.from("media_assets").select("id").eq("id", fixtures[2].id), "rejected_deleted").length, 0);
  for (const derivative of derivatives) assert.equal(await objectExists(admin, derivative.bucket_id, derivative.storage_path), true);
  record("retention cleanup removes consumed sources, preserves derivatives, and deletes terminal invalid assets");

  assertNoError(await admin.from("media_assets").update({
    cleanup_next_attempt_at: past,
    consumed_at: null,
    created_at: new Date(Date.now() - 8 * 86_400_000).toISOString()
  }).in("id", [fixtures[0].id, fixtures[1].id]), "abandoned_schedule");
  const abandonedCleanup = await internalRequest(baseUrl, secret, "/api/internal/media/cleanup", {
    limit: 10,
    workerId: "phase2-abandoned-cleanup"
  });
  assert.equal(abandonedCleanup.claimed, 2);
  assert.equal(abandonedCleanup.cleaned, 2);
  assert.equal(assertNoError(await admin.from("media_assets").select("id").in("id", [fixtures[0].id, fixtures[1].id]), "abandoned_deleted").length, 0);
  for (const derivative of derivatives) assert.equal(await objectExists(admin, derivative.bucket_id, derivative.storage_path), false);
  record("seven-day unattached ready assets and all derivatives are swept without storage leaks");

  console.log(`Validated ${passed.length} real Phase 2 processing and cleanup behaviours.`);
} catch (error) {
  if (serverOutput) {
    const safeTail = serverOutput
      .replaceAll(env.serviceKey, "[service-key-redacted]")
      .replaceAll(secret, "[worker-secret-redacted]")
      .slice(-4000);
    console.error(safeTail);
  }
  throw error;
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 10_000))
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await rm(root, { force: true, recursive: true });
}
