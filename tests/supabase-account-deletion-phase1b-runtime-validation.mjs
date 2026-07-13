#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.ACCOUNT_DELETION_RUNTIME_NEXT_PORT ?? 3041);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WORKER_SECRET = "local-phase1b-account-deletion-secret";
const INSTALL_ID = crypto.randomUUID();
const TEST_IP = `203.0.113.${(parseInt(INSTALL_ID.slice(0, 2), 16) % 200) + 1}`;
let nextProcess = null;
const passed = [];

function record(name) {
  passed.push(name);
  console.log(`PASS: ${name}`);
}

function localStatus() {
  if (process.env.ACCOUNT_DELETION_SUPABASE_STATUS_FILE) {
    const parsed = JSON.parse(readFileSync(process.env.ACCOUNT_DELETION_SUPABASE_STATUS_FILE, "utf8"));
    return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
  }
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Local Supabase is not running");
  const parsed = JSON.parse(result.stdout);
  return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
}

function startNext(env) {
  nextProcess = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACCOUNT_DELETION_WORKER_SECRET: WORKER_SECRET,
      API_RATE_LIMIT_HMAC_SECRET: "phase1b-local-runtime-hmac-secret-0123456789",
      API_TRUSTED_PROXY_HOPS: "1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [nextProcess.stdout, nextProcess.stderr]) {
    stream.on("data", (chunk) => {
      const output = String(chunk);
      if (/error|failed/i.test(output)) process.stderr.write(output);
    });
  }
}

async function stopNext() {
  if (!nextProcess) return;
  nextProcess.kill("SIGTERM");
  await delay(750);
  if (nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
}

async function waitForNext() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/media/upload-intent`, { method: "OPTIONS" });
      if (response.status === 204) return;
    } catch {}
    await delay(400);
  }
  throw new Error("Next server did not start");
}

async function route(path, token, body, method = "POST", secret = null) {
  const response = await fetch(`${BASE_URL}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "X-FoodReview-Install-Id": INSTALL_ID,
      "X-Forwarded-For": TEST_IP,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(secret ? { "x-account-deletion-secret": secret } : {})
    },
    method
  });
  return { body: await response.json().catch(() => null), response };
}

async function createActor(admin, env, label) {
  const nonce = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const username = `d${label[0]}_${nonce.slice(-8)}`.toLowerCase();
  const email = `${username}@example.test`;
  const password = `Phase1B-${nonce}!`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw created.error ?? new Error("Auth user creation failed");
  const profile = await admin.from("profiles").insert({
    account_type: "public",
    first_name: label,
    id: created.data.user.id,
    last_name: "Phase1B",
    username
  });
  if (profile.error) throw profile.error;
  const client = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("Sign-in failed");
  return { client, id: created.data.user.id, token: signed.data.session.access_token, username };
}

async function upload(admin, bucket, path, contents) {
  const result = await admin.storage.from(bucket).upload(path, Buffer.from(contents), {
    contentType: "image/jpeg",
    upsert: true
  });
  if (result.error) throw result.error;
}

async function objectExists(admin, bucket, path) {
  const separator = path.lastIndexOf("/");
  const directory = separator < 0 ? "" : path.slice(0, separator);
  const name = separator < 0 ? path : path.slice(separator + 1);
  const { data, error } = await admin.storage.from(bucket).list(directory, { limit: 20, search: name });
  if (error) throw error;
  return (data ?? []).some((item) => item.name === name);
}

async function seed(admin, owner, other) {
  const otherReviewId = crypto.randomUUID();
  const reviewId = crypto.randomUUID();
  await admin.from("reviews").insert([
    { id: otherReviewId, items: [{ name: "Other dish", rating: 4 }], restaurant_name: "Other place", reviewer_name: other.username, visibility: "public" },
    { id: reviewId, items: [{ name: "Owner dish", rating: 5 }], restaurant_name: "Owner place", reviewer_name: owner.username, visibility: "public" }
  ]).throwOnError();

  const assetId = crypto.randomUUID();
  const sourcePath = `sources/post/${owner.id}/${assetId}/original.jpg`;
  const derivativePaths = ["canonical", "thumbnail", "poster"].map((kind) => `private-posts/${owner.id}/${assetId}/${kind}.jpg`);
  await admin.from("media_assets").insert({
    access_class: "public_post",
    crop_rect: {},
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    id: assetId,
    media_type: "image",
    original_extension: "jpg",
    original_file_size_bytes: 8,
    original_mime_type: "image/jpeg",
    owner_id: owner.id,
    owner_name: owner.username,
    privacy_state: "stable",
    source_bucket_id: "media-sources",
    source_storage_path: sourcePath,
    status: "ready",
    surface: "post",
    visibility: "private"
  }).throwOnError();
  await admin.from("media_derivatives").insert(derivativePaths.map((path, index) => ({
    asset_id: assetId,
    bucket_id: "media-private",
    file_size_bytes: 8,
    kind: ["canonical", "thumbnail", "poster"][index],
    mime_type: "image/jpeg",
    storage_path: path
  }))).throwOnError();
  await admin.from("review_photos").insert({
    media_asset_id: assetId,
    media_type: "image",
    owner_id: owner.id,
    position: 0,
    public_url: null,
    review_id: reviewId,
    storage_path: derivativePaths[0]
  }).throwOnError();
  await upload(admin, "media-sources", sourcePath, "source");
  for (const path of derivativePaths) await upload(admin, "media-private", path, path);

  const legacyPath = `posts/${owner.id}/legacy/media.jpg`;
  await admin.from("review_photos").insert({
    media_type: "image",
    owner_id: owner.id,
    position: 1,
    public_url: `${admin.storage.from("review-photos").getPublicUrl(legacyPath).data.publicUrl}`,
    review_id: reviewId,
    storage_path: legacyPath
  }).throwOnError();
  await upload(admin, "review-photos", legacyPath, "legacy");

  const reviewIntentId = crypto.randomUUID();
  const quarantinePath = `pending/${owner.id}/${reviewIntentId}/original.jpg`;
  const finalPath = `avatars/${owner.id}/${reviewIntentId}/avatar.jpg`;
  await admin.from("review_media_upload_intents").insert({
    category: "avatar",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    extension: "jpg",
    file_size_bytes: 7,
    final_bucket_id: "review-photos",
    id: reviewIntentId,
    max_file_size_bytes: 10 * 1024 * 1024,
    media_type: "image",
    mime_type: "image/jpeg",
    quarantine_bucket_id: "review-media-quarantine",
    quarantine_storage_path: quarantinePath,
    status: "created",
    storage_path: finalPath,
    user_id: owner.id,
    user_name: owner.username
  }).throwOnError();
  await upload(admin, "review-media-quarantine", quarantinePath, "pending");
  await upload(admin, "review-photos", finalPath, "avatar");

  const sharedRoomId = crypto.randomUUID();
  const soloRoomId = crypto.randomUUID();
  await admin.from("shared_memory_rooms").insert([
    { created_by: owner.username, id: sharedRoomId, restaurant_name: "Shared room" },
    { created_by: owner.username, id: soloRoomId, restaurant_name: "Solo room" }
  ]).throwOnError();
  await admin.from("shared_memory_members").insert([
    { role: "owner", room_id: sharedRoomId, user_name: owner.username },
    { role: "participant", room_id: sharedRoomId, user_name: other.username },
    { role: "owner", room_id: soloRoomId, user_name: owner.username }
  ]).throwOnError();
  const ownerMemoryPath = `memories/${sharedRoomId}/${owner.id}/${crypto.randomUUID()}/owner.jpg`;
  const otherMemoryPath = `memories/${sharedRoomId}/${other.id}/${crypto.randomUUID()}/other.jpg`;
  const soloMemoryPath = `memories/${soloRoomId}/${owner.id}/${crypto.randomUUID()}/solo.jpg`;
  await admin.from("shared_memory_photos").insert([
    { room_id: sharedRoomId, storage_path: ownerMemoryPath, uploader_id: owner.id, uploader_name: owner.username },
    { room_id: sharedRoomId, storage_path: otherMemoryPath, uploader_id: other.id, uploader_name: other.username },
    { room_id: soloRoomId, storage_path: soloMemoryPath, uploader_id: owner.id, uploader_name: owner.username }
  ]).throwOnError();
  await admin.from("shared_memory_messages").insert([
    { author_name: owner.username, body: "owner message", room_id: sharedRoomId },
    { author_name: other.username, body: "other message", room_id: sharedRoomId },
    { author_name: owner.username, body: "solo message", room_id: soloRoomId }
  ]).throwOnError();
  const ownerDish = await admin.from("shared_memory_dishes").insert({ added_by: owner.username, dish_name: "Owner dish", room_id: sharedRoomId }).select("id").single();
  if (ownerDish.error) throw ownerDish.error;
  await admin.from("shared_memory_dishes").insert({ added_by: other.username, dish_name: "Other dish", room_id: sharedRoomId }).throwOnError();
  await admin.from("shared_memory_dish_ratings").insert({ dish_id: ownerDish.data.id, rated_by: owner.username, rating: 5, room_id: sharedRoomId }).throwOnError();
  for (const path of [ownerMemoryPath, otherMemoryPath, soloMemoryPath]) await upload(admin, "memory-media", path, path);

  await admin.from("comments").insert({ content: "owner comment", post_id: otherReviewId, user_name: owner.username }).throwOnError();
  await admin.from("likes").insert({ post_id: otherReviewId, user_name: owner.username }).throwOnError();
  await admin.from("wishlist").insert({ post_id: otherReviewId, restaurant_name: "Other place", user_name: owner.username }).throwOnError();
  await admin.from("circle_memberships").insert({ member_name: other.username, user_name: owner.username }).throwOnError();
  await admin.from("circle_requests").insert({ receiver_name: other.username, sender_name: owner.username }).throwOnError();
  await admin.from("blocked_users").insert({ blocked_name: other.username, blocker_name: owner.username }).throwOnError();
  await admin.from("notification_settings").insert({ user_name: owner.username }).throwOnError();
  await admin.from("push_tokens").insert({ expo_push_token: `ExponentPushToken[${crypto.randomUUID()}]`, platform: "android", user_name: owner.username }).throwOnError();
  await admin.from("notifications").insert({ actor_name: owner.username, actor_user_id: owner.id, message: "redacted after deletion", recipient_name: other.username, recipient_user_id: other.id, type: "POST_LIKED" }).throwOnError();
  const reportId = crypto.randomUUID();
  await admin.from("content_reports").insert({ id: reportId, details: "private reporter details", reason: "other", reporter_id: owner.id, reporter_name: owner.username, target_id: otherReviewId, target_type: "review" }).throwOnError();

  const otherAssetId = crypto.randomUUID();
  const otherPath = `private-posts/${other.id}/${otherAssetId}/canonical.jpg`;
  await admin.from("media_assets").insert({
    access_class: "public_post", crop_rect: {}, expires_at: new Date(Date.now() + 600_000).toISOString(), id: otherAssetId,
    media_type: "image", original_extension: "jpg", original_file_size_bytes: 8, original_mime_type: "image/jpeg",
    owner_id: other.id, owner_name: other.username, privacy_state: "stable", source_bucket_id: "media-sources",
    source_storage_path: `sources/post/${other.id}/${otherAssetId}/original.jpg`, status: "ready", surface: "post", visibility: "private"
  }).throwOnError();
  await admin.from("media_derivatives").insert({ asset_id: otherAssetId, bucket_id: "media-private", file_size_bytes: 8, kind: "canonical", mime_type: "image/jpeg", storage_path: otherPath }).throwOnError();
  await upload(admin, "media-private", otherPath, "other-owned");

  return { assetId, otherMemoryPath, otherPath, ownerPaths: [sourcePath, ...derivativePaths, legacyPath, quarantinePath, finalPath, ownerMemoryPath, soloMemoryPath], reportId, reviewId, sharedRoomId, soloRoomId };
}

async function main() {
  const env = localStatus();
  const admin = createClient(env.url, env.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  startNext(env);
  await waitForNext();

  const owner = await createActor(admin, env, "Owner");
  const other = await createActor(admin, env, "Other");
  const fixture = await seed(admin, owner, other);
  record("real Auth actors and cross-subsystem deletion fixture created");

  const actorStatus = await route("/api/mobile/auth/account-status", owner.token, undefined, "GET");
  assert.equal(actorStatus.response.status, 200, JSON.stringify(actorStatus.body));
  assert.equal(actorStatus.body.status, "active", JSON.stringify(actorStatus.body));

  const requested = await route("/api/delete-account", owner.token);
  assert.equal(requested.response.status, 202, JSON.stringify(requested.body));
  assert.equal(requested.body.accepted, true);
  const repeated = await route("/api/delete-account", owner.token);
  assert.equal(repeated.response.status, 202, JSON.stringify(repeated.body));
  assert.equal(repeated.body.jobId, requested.body.jobId);
  record("owner-only request freezes atomically and repeated request reuses the durable job");

  const profile = await admin.from("profiles").select("account_status, deletion_started_at").eq("id", owner.id).single();
  assert.equal(profile.data.account_status, "deleting");
  assert.ok(profile.data.deletion_started_at);
  const review = await admin.from("reviews").select("status, deleted_at").eq("id", fixture.reviewId).single();
  assert.equal(review.data.status, "deleted");
  assert.ok(review.data.deleted_at);

  const deniedLike = await owner.client.from("likes").insert({ post_id: fixture.reviewId, user_name: owner.username });
  assert.ok(deniedLike.error);
  const deniedIntent = await route("/api/media/upload-intent", owner.token, {
    fileName: "blocked.jpg", fileSizeBytes: 8, mediaType: "image", mimeType: "image/jpeg", surface: "post", intendedVisibility: "public"
  });
  assert.equal(deniedIntent.response.status, 401);
  const deniedMedia = await route("/api/media/access", null, { assetIds: [fixture.assetId] });
  assert.equal(deniedMedia.response.status, 200);
  assert.equal(deniedMedia.body.media.length, 0);
  record("freeze denies direct writes, upload intents, discovery, and fresh Phase 1A media URLs");

  const unauthorisedWorker = await route("/api/internal/account-deletion", null, { jobId: requested.body.jobId, limit: 1 });
  assert.equal(unauthorisedWorker.response.status, 404);

  let jobState = "";
  for (let step = 0; step < 30; step += 1) {
    const worker = await route("/api/internal/account-deletion", null, { jobId: requested.body.jobId, limit: 1 }, "POST", WORKER_SECRET);
    assert.equal(worker.response.status, 200);
    const job = await admin.from("account_deletion_jobs").select("status").eq("id", requested.body.jobId).single();
    jobState = job.data.status;
    if (jobState === "completed") break;
  }
  assert.equal(jobState, "completed");
  record("protected bounded worker inventories, deletes Storage, cleans database, and deletes Auth last");

  for (const path of fixture.ownerPaths) {
    const bucket = path.startsWith("sources/") ? "media-sources"
      : path.startsWith("private-posts/") ? "media-private"
        : path.startsWith("pending/") ? "review-media-quarantine"
          : path.startsWith("memories/") ? "memory-media"
            : "review-photos";
    assert.equal(await objectExists(admin, bucket, path), false);
  }
  assert.equal(await objectExists(admin, "media-private", fixture.otherPath), true);
  assert.equal(await objectExists(admin, "memory-media", fixture.otherMemoryPath), true);
  record("all owner variants are missing while another user's private objects remain");

  const ownerAuth = await admin.auth.admin.getUserById(owner.id);
  assert.ok(ownerAuth.error);
  assert.equal((await admin.from("profiles").select("id", { count: "exact", head: true }).eq("id", owner.id)).count, 0);
  assert.equal((await admin.from("media_assets").select("id", { count: "exact", head: true }).eq("owner_id", owner.id)).count, 0);
  assert.equal((await admin.from("comments").select("id", { count: "exact", head: true }).eq("user_name", owner.username)).count, 0);
  assert.equal((await admin.from("push_tokens").select("id", { count: "exact", head: true }).eq("user_name", owner.username)).count, 0);

  const sharedRoom = await admin.from("shared_memory_rooms").select("created_by").eq("id", fixture.sharedRoomId).single();
  assert.equal(sharedRoom.data.created_by, "deleted-account");
  assert.equal((await admin.from("shared_memory_members").select("id", { count: "exact", head: true }).eq("room_id", fixture.sharedRoomId).eq("user_name", other.username)).count, 1);
  assert.equal((await admin.from("shared_memory_messages").select("id", { count: "exact", head: true }).eq("room_id", fixture.sharedRoomId).eq("author_name", other.username)).count, 1);
  assert.equal((await admin.from("shared_memory_rooms").select("id", { count: "exact", head: true }).eq("id", fixture.soloRoomId)).count, 0);
  record("shared room remains for the other member, deleted-member content is gone, and sole room is removed");

  const report = await admin.from("content_reports").select("reporter_id, reporter_name, details").eq("id", fixture.reportId).single();
  assert.equal(report.data.reporter_id, null);
  assert.equal(report.data.reporter_name, "deleted-account");
  assert.equal(report.data.details, null);
  record("moderation report is retained only in anonymised form");

  const completedRerun = await route("/api/internal/account-deletion", null, { jobId: requested.body.jobId, limit: 1 }, "POST", WORKER_SECRET);
  assert.equal(completedRerun.response.status, 200);
  assert.equal(completedRerun.body.claimed, 0);
  const remaining = await admin.from("account_deletion_storage_items").select("id", { count: "exact", head: true }).eq("job_id", requested.body.jobId).not("status", "in", "(deleted,already_missing)");
  assert.equal(remaining.count, 0);
  record("completed job is idempotent and reconciliation has zero unexpected Storage remnants");

  await admin.from("account_deletion_jobs")
    .update({ retain_until: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", requested.body.jobId)
    .throwOnError();
  const purge = await route("/api/internal/account-deletion", null, { limit: 1 }, "POST", WORKER_SECRET);
  assert.equal(purge.response.status, 200);
  assert.equal(purge.body.purged, 1);
  assert.equal((await admin.from("account_deletion_jobs").select("id", { count: "exact", head: true }).eq("id", requested.body.jobId)).count, 0);
  assert.equal((await admin.from("account_deletion_storage_items").select("id", { count: "exact", head: true }).eq("job_id", requested.body.jobId)).count, 0);
  record("expired completed operational metadata is purged in bounded service-only batches");

  console.log(`\nPhase 1B runtime validation complete: ${passed.length}/${passed.length} checks passed.`);
}

main().catch((error) => {
  const diagnostic = error instanceof Error
    ? error.message
    : error && typeof error === "object"
      ? JSON.stringify({
          code: error.code ?? null,
          details: error.details ?? null,
          message: error.message ?? null,
          status: error.status ?? null
        })
      : "unknown_error";
  console.error(`Phase 1B runtime validation failed: ${diagnostic}`);
  process.exitCode = 1;
}).finally(stopNext);
