#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const NEXT_PORT = Number(process.env.POST_MEDIA_RUNTIME_NEXT_PORT ?? 3037);
const NEXT_BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const WORKER_SECRET = "local-phase1a-media-worker-secret";
const SOURCE_BUCKET = "media-sources";
const PRIVATE_BUCKET = "media-private";
const LEGACY_BUCKET = "review-photos";
const SIGNED_URL_TTL_SECONDS = 300;

const results = [];
let nextProcess = null;

function record(name, detail = "") {
  results.push(name);
  console.log(`PASS: ${name}${detail ? ` - ${detail}` : ""}`);
}

function supabaseStatus() {
  if (process.env.POST_MEDIA_SUPABASE_STATUS_FILE) {
    const parsed = JSON.parse(readFileSync(process.env.POST_MEDIA_SUPABASE_STATUS_FILE, "utf8"));
    return { anonKey: parsed.ANON_KEY, serviceRoleKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
  }
  if (
    process.env.POST_MEDIA_SUPABASE_URL &&
    process.env.POST_MEDIA_SUPABASE_ANON_KEY &&
    process.env.POST_MEDIA_SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      anonKey: process.env.POST_MEDIA_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.POST_MEDIA_SUPABASE_SERVICE_ROLE_KEY,
      url: process.env.POST_MEDIA_SUPABASE_URL
    };
  }
  const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (status.status !== 0) throw new Error("root Supabase stack is not running; pass the POST_MEDIA_SUPABASE_* local variables");
  const parsed = JSON.parse(status.stdout);
  return {
    anonKey: parsed.ANON_KEY,
    serviceRoleKey: parsed.SERVICE_ROLE_KEY,
    url: parsed.API_URL
  };
}

function startNext(env) {
  nextProcess = spawn("npx", ["next", "dev", "-p", String(NEXT_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MEDIA_WORKER_SECRET: WORKER_SECRET,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [nextProcess.stdout, nextProcess.stderr]) {
    stream.on("data", (chunk) => {
      const text = String(chunk);
      if (/error|failed/i.test(text)) process.stderr.write(text);
    });
  }
}

async function stopNext() {
  if (!nextProcess) return;
  nextProcess.kill("SIGTERM");
  await delay(800);
  if (nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
}

async function waitForNext() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${NEXT_BASE_URL}/api/media/upload-intent`, { method: "OPTIONS" });
      if (response.status === 204) return;
    } catch {
      // Continue until the local development server is ready.
    }
    await delay(500);
  }
  throw new Error("Next Phase 1A routes did not become ready");
}

async function routeJson(pathname, token, body, method = "POST") {
  const response = await fetch(`${NEXT_BASE_URL}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    method
  });
  return { json: await response.json().catch(() => null), response };
}

async function createUser(admin, prefix) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const username = `p1${prefix[0]}_${nonce.replaceAll("-", "").slice(-8)}`;
  const email = `${username}@example.test`;
  const password = `Phase1A-${nonce}!`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw created.error ?? new Error("runtime user creation failed");
  const profile = await admin.from("profiles").insert({
    account_type: "public",
    first_name: prefix,
    id: created.data.user.id,
    last_name: "Phase1A",
    username
  });
  if (profile.error) throw profile.error;
  return { email, id: created.data.user.id, password, username };
}

async function signIn(env, user) {
  const client = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signed = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("runtime sign in failed");
  return { client, token: signed.data.session.access_token };
}

async function postImage() {
  return sharp({
    create: { background: { b: 48, g: 124, r: 220 }, channels: 3, height: 50, width: 40 }
  }).jpeg({ quality: 88 }).toBuffer();
}

function expectedAccessClass(visibility) {
  return visibility === "public" ? "public_post" : visibility === "circle" ? "circle_post" : "private_post";
}

async function createPostAsset({ admin, image, owner, ownerSession, visibility }) {
  const intent = await routeJson("/api/media/upload-intent", ownerSession.token, {
    cropRect: { height: 1, width: 1, x: 0, y: 0 },
    fileName: "food.jpg",
    fileSizeBytes: image.byteLength,
    height: 50,
    intendedVisibility: visibility,
    mediaType: "image",
    mimeType: "image/jpeg",
    surface: "post",
    width: 40
  });
  assert.equal(intent.response.status, 200, JSON.stringify(intent.json));
  assert.equal(intent.json.accessClass, expectedAccessClass(visibility));
  assert.equal(intent.json.uploadBucket, SOURCE_BUCKET);

  const upload = await ownerSession.client.storage.from(SOURCE_BUCKET).upload(intent.json.uploadPath, image, {
    contentType: "image/jpeg",
    upsert: false
  });
  assert.equal(upload.error, null, upload.error?.message);
  const finalized = await routeJson("/api/media/finalize-upload", ownerSession.token, {
    assetId: intent.json.assetId,
    uploadPath: intent.json.uploadPath
  });
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.json));

  const worker = await routeJson("/api/internal/media/process", null, { limit: 5 });
  assert.equal(worker.response.status, 404);
  const authorizedWorker = await fetch(`${NEXT_BASE_URL}/api/internal/media/process`, {
    body: JSON.stringify({ limit: 5 }),
    headers: { Authorization: `Bearer ${WORKER_SECRET}`, "Content-Type": "application/json" },
    method: "POST"
  });
  const workerBody = await authorizedWorker.json();
  assert.equal(authorizedWorker.status, 200, JSON.stringify(workerBody));

  let asset = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const loaded = await admin.from("media_assets").select("*").eq("id", intent.json.assetId).maybeSingle();
    if (loaded.error) throw loaded.error;
    asset = loaded.data;
    if (asset?.status === "ready") break;
    await delay(200);
  }
  assert.equal(asset?.status, "ready", asset?.failure_reason ?? "asset did not become ready");
  assert.equal(asset.access_class, expectedAccessClass(visibility));
  assert.equal(asset.visibility, "private");
  assert.equal(asset.privacy_state, "stable");

  const derivative = await admin.from("media_derivatives")
    .select("*")
    .eq("asset_id", asset.id)
    .eq("kind", "canonical")
    .single();
  if (derivative.error) throw derivative.error;
  assert.equal(derivative.data.bucket_id, PRIVATE_BUCKET);
  assert.equal(derivative.data.public_url, null);
  assert.match(derivative.data.storage_path, new RegExp(`^private-posts/${owner.id}/${asset.id}/canonical\\.jpg$`));

  const status = await fetch(`${NEXT_BASE_URL}/api/media/status?ids=${encodeURIComponent(asset.id)}`, {
    headers: { Authorization: `Bearer ${ownerSession.token}` }
  });
  const statusBody = await status.json();
  assert.equal(status.status, 200);
  assert.equal(statusBody.assets[0].assetId, asset.id);
  assert.doesNotMatch(JSON.stringify(statusBody), /private-posts|storagePath|bucketId|signedUrl/i);

  const review = await routeJson("/api/reviews", ownerSession.token, {
    body: `Phase 1A ${visibility} runtime post`,
    items: [{ name: "Runtime dish", rating: 5 }],
    media: [{ assetId: asset.id, mediaType: "image" }],
    restaurantName: `Phase 1A ${visibility} restaurant`,
    visibility
  });
  assert.equal(review.response.status, 200, JSON.stringify(review.json));
  return { assetId: asset.id, path: derivative.data.storage_path, reviewId: review.json.id, visibility };
}

async function mediaAccess(assetId, token, expectedCount) {
  const access = await routeJson("/api/media/access", token, { assetIds: [assetId] });
  assert.equal(access.response.status, 200);
  assert.equal(access.response.headers.get("cache-control"), "private, no-store");
  assert.equal(access.json.media.length, expectedCount);
  for (const item of access.json.media) {
    assert.equal(Object.hasOwn(item, "storagePath"), false);
    assert.equal(Object.hasOwn(item, "bucketId"), false);
  }
  return access.json.media[0] ?? null;
}

async function transition({ admin, assetId, reviewId, token, visibility }) {
  const changed = await routeJson(`/api/reviews/${reviewId}`, token, { visibility }, "PATCH");
  assert.equal(changed.response.status, 200, JSON.stringify(changed.json));
  const asset = await admin.from("media_assets").select("access_class, visibility").eq("id", assetId).single();
  if (asset.error) throw asset.error;
  assert.equal(asset.data.access_class, expectedAccessClass(visibility));
  assert.equal(asset.data.visibility, "private");
}

async function publicObjectStatus(env, bucket, path) {
  const encodedPath = encodeURIComponent(path).replaceAll("%2F", "/");
  return fetch(`${env.url}/storage/v1/object/public/${bucket}/${encodedPath}`, { cache: "no-store" });
}

function runBackfill(env, args) {
  const result = spawnSync(process.execPath, ["scripts/post-media-visibility-backfill.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
      SUPABASE_URL: env.url
    }
  });
  const report = JSON.parse(result.stdout);
  if (result.status !== 0 && result.status !== 2) throw new Error("post media backfill command failed");
  return report;
}

async function seedLegacyBackfill({ admin, image, owner, visibility, simulateCopiedCrash = false }) {
  const review = await admin.from("reviews").insert({
    body: "legacy Phase 1A backfill fixture",
    items: [{ name: "Legacy dish", rating: 4 }],
    photo_url: "legacy-placeholder",
    photo_urls: ["legacy-placeholder"],
    restaurant_name: `Legacy ${visibility}`,
    reviewer_name: owner.username,
    status: "active",
    visibility
  }).select("id").single();
  if (review.error) throw review.error;
  const photoId = crypto.randomUUID();
  const oldPath = `phase1a-legacy/${photoId}.jpg`;
  const upload = await admin.storage.from(LEGACY_BUCKET).upload(oldPath, image, { contentType: "image/jpeg", upsert: false });
  if (upload.error) throw upload.error;
  const publicUrl = admin.storage.from(LEGACY_BUCKET).getPublicUrl(oldPath).data.publicUrl;
  const photo = await admin.from("review_photos").insert({
    file_size_bytes: image.byteLength,
    height: 50,
    id: photoId,
    media_type: "image",
    mime_type: "image/jpeg",
    position: 0,
    public_url: publicUrl,
    review_id: review.data.id,
    size_bytes: image.byteLength,
    storage_path: oldPath,
    width: 40
  });
  if (photo.error) throw photo.error;

  if (simulateCopiedCrash) {
    const privatePath = `private-posts/${owner.id}/${photoId}/canonical.jpg`;
    const asset = await admin.from("media_assets").insert({
      access_class: expectedAccessClass(visibility),
      consumed_at: new Date().toISOString(),
      crop_rect: {},
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      id: photoId,
      media_type: "image",
      original_extension: "jpg",
      original_file_size_bytes: image.byteLength,
      original_height: 50,
      original_mime_type: "image/jpeg",
      original_width: 40,
      owner_id: owner.id,
      owner_name: owner.username,
      privacy_state: "migrating",
      processed_at: new Date().toISOString(),
      source_bucket_id: SOURCE_BUCKET,
      source_storage_path: `sources/post/${owner.id}/${photoId}/original.jpg`,
      status: "ready",
      surface: "post",
      uploaded_at: new Date().toISOString(),
      visibility: "private"
    });
    if (asset.error) throw asset.error;
    const copied = await admin.storage.from(PRIVATE_BUCKET).upload(privatePath, image, { contentType: "image/jpeg", upsert: true });
    if (copied.error) throw copied.error;
    const job = await admin.from("media_privacy_migration_jobs").insert({
      asset_id: photoId,
      attempts: 1,
      new_objects: [{ bucket: PRIVATE_BUCKET, path: privatePath }],
      old_objects: [{ bucket: LEGACY_BUCKET, path: oldPath }],
      review_id: review.data.id,
      state: "copying"
    });
    if (job.error) throw job.error;
  }
  return { oldPath, photoId, reviewId: review.data.id, visibility };
}

async function main() {
  const env = supabaseStatus();
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  startNext(env);
  await waitForNext();
  record("real Next Phase 1A routes booted against the complete canonical root Supabase chain");

  const [owner, member, stranger, blocked] = await Promise.all([
    createUser(admin, "owner"),
    createUser(admin, "member"),
    createUser(admin, "stranger"),
    createUser(admin, "blocked")
  ]);
  const [ownerSession, memberSession, strangerSession, blockedSession] = await Promise.all([
    signIn(env, owner), signIn(env, member), signIn(env, stranger), signIn(env, blocked)
  ]);
  record("four real Auth actors created and signed in");

  const membership = await admin.from("circle_memberships").insert({ member_name: member.username, user_name: owner.username });
  if (membership.error) throw membership.error;
  const image = await postImage();
  const publicPost = await createPostAsset({ admin, image, owner, ownerSession, visibility: "public" });
  const circlePost = await createPostAsset({ admin, image, owner, ownerSession, visibility: "circle" });
  const privatePost = await createPostAsset({ admin, image, owner, ownerSession, visibility: "me" });
  record("public, circle, and me posts processed into private canonical derivatives");

  const publicMedia = await mediaAccess(publicPost.assetId, null, 1);
  const publicSignedUrl = publicMedia.displayUrl;
  const publicUrlIssuedAt = Date.now();
  assert.equal((await fetch(publicSignedUrl, { cache: "no-store" })).status, 200);
  await mediaAccess(circlePost.assetId, ownerSession.token, 1);
  await mediaAccess(circlePost.assetId, memberSession.token, 1);
  await mediaAccess(circlePost.assetId, strangerSession.token, 0);
  await mediaAccess(circlePost.assetId, null, 0);
  await mediaAccess(privatePost.assetId, ownerSession.token, 1);
  await mediaAccess(privatePost.assetId, memberSession.token, 0);
  record("current public/circle/me authorization matrix");

  const directPublic = await publicObjectStatus(env, PRIVATE_BUCKET, publicPost.path);
  assert.ok(directPublic.status < 200 || directPublic.status >= 300);
  const directMember = await memberSession.client.storage.from(PRIVATE_BUCKET).download(publicPost.path);
  assert.ok(directMember.error);
  const oneSecond = await admin.storage.from(PRIVATE_BUCKET).createSignedUrl(publicPost.path, 1);
  if (oneSecond.error) throw oneSecond.error;
  assert.equal((await fetch(oneSecond.data.signedUrl, { cache: "no-store" })).status, 200);
  await delay(2_000);
  assert.notEqual((await fetch(oneSecond.data.signedUrl, { cache: "no-store" })).status, 200);
  record("direct private reads denied and live signed URL expiry enforced");

  const anonymousProxy = await fetch(`${NEXT_BASE_URL}/api/media/object/${publicPost.assetId}/canonical`, { redirect: "manual" });
  assert.equal(anonymousProxy.status, 307);
  assert.equal(anonymousProxy.headers.get("cache-control"), "private, no-store");
  const circleProxy = await fetch(`${NEXT_BASE_URL}/api/media/object/${circlePost.assetId}/canonical`, { redirect: "manual" });
  assert.equal(circleProxy.status, 404);
  record("web media proxy reauthorizes and does not cache redirects");

  await transition({ admin, assetId: publicPost.assetId, reviewId: publicPost.reviewId, token: ownerSession.token, visibility: "circle" });
  await mediaAccess(publicPost.assetId, strangerSession.token, 0);
  await mediaAccess(publicPost.assetId, memberSession.token, 1);
  await transition({ admin, assetId: publicPost.assetId, reviewId: publicPost.reviewId, token: ownerSession.token, visibility: "me" });
  await mediaAccess(publicPost.assetId, memberSession.token, 0);

  await transition({ admin, assetId: circlePost.assetId, reviewId: circlePost.reviewId, token: ownerSession.token, visibility: "public" });
  await mediaAccess(circlePost.assetId, strangerSession.token, 1);
  await transition({ admin, assetId: circlePost.assetId, reviewId: circlePost.reviewId, token: ownerSession.token, visibility: "me" });
  await mediaAccess(circlePost.assetId, strangerSession.token, 0);

  await transition({ admin, assetId: privatePost.assetId, reviewId: privatePost.reviewId, token: ownerSession.token, visibility: "public" });
  await mediaAccess(privatePost.assetId, strangerSession.token, 1);
  await transition({ admin, assetId: privatePost.assetId, reviewId: privatePost.reviewId, token: ownerSession.token, visibility: "me" });
  await transition({ admin, assetId: privatePost.assetId, reviewId: privatePost.reviewId, token: ownerSession.token, visibility: "circle" });
  await mediaAccess(privatePost.assetId, memberSession.token, 1);
  record("all six visibility transitions atomically change fresh authorization");

  const unauthorisedTransition = await routeJson(`/api/reviews/${privatePost.reviewId}`, strangerSession.token, { visibility: "public" }, "PATCH");
  assert.equal(unauthorisedTransition.response.status, 403);
  const publicRpc = await anon.rpc("set_review_visibility_with_media_access", {
    p_owner_id: owner.id,
    p_owner_name: owner.username,
    p_review_id: privatePost.reviewId,
    p_visibility: "public"
  });
  assert.ok(publicRpc.error);
  record("visibility RPC remains service-role-only and routes enforce ownership");

  await admin.from("circle_memberships").delete().eq("user_name", owner.username).eq("member_name", member.username);
  await mediaAccess(privatePost.assetId, memberSession.token, 0);
  await admin.from("circle_memberships").insert({ member_name: member.username, user_name: owner.username });
  await mediaAccess(privatePost.assetId, memberSession.token, 1);
  const blockInsert = await admin.from("blocked_users").insert({ blocker_name: owner.username, blocked_name: blocked.username });
  if (blockInsert.error) throw blockInsert.error;
  await mediaAccess(privatePost.assetId, blockedSession.token, 0);
  await admin.from("blocked_users").delete().eq("blocker_name", owner.username).eq("blocked_name", blocked.username);
  record("membership removal and blocking revoke fresh media delivery");

  await admin.from("reviews").update({ hidden_at: new Date().toISOString() }).eq("id", privatePost.reviewId);
  await mediaAccess(privatePost.assetId, ownerSession.token, 0);
  await admin.from("reviews").update({ hidden_at: null }).eq("id", privatePost.reviewId);
  await mediaAccess(privatePost.assetId, ownerSession.token, 1);
  record("suppression state fails closed even for the owner");

  const legacy = [
    await seedLegacyBackfill({ admin, image, owner, visibility: "public" }),
    await seedLegacyBackfill({ admin, image, owner, visibility: "circle", simulateCopiedCrash: true }),
    await seedLegacyBackfill({ admin, image, owner, visibility: "me" })
  ];
  const dryRun = runBackfill(env, ["--limit=500"]);
  assert.ok(dryRun.legacy >= 3);
  assert.equal(dryRun.failed, 0);
  assert.equal(dryRun.ambiguous, 0);
  const applied = runBackfill(env, ["--apply", "--limit=500"]);
  assert.equal(applied.failed, 0, JSON.stringify(applied));
  assert.equal(applied.ambiguous, 0, JSON.stringify(applied));
  for (const fixture of legacy) {
    const photo = await admin.from("review_photos").select("media_asset_id, public_url, storage_path").eq("id", fixture.photoId).single();
    if (photo.error) throw photo.error;
    assert.equal(photo.data.media_asset_id, fixture.photoId);
    assert.equal(photo.data.public_url, null);
    assert.match(photo.data.storage_path, /^private-posts\//);
    const asset = await admin.from("media_assets").select("access_class, privacy_state").eq("id", fixture.photoId).single();
    if (asset.error) throw asset.error;
    assert.equal(asset.data.access_class, expectedAccessClass(fixture.visibility));
    assert.equal(asset.data.privacy_state, "stable");
    const job = await admin.from("media_privacy_migration_jobs").select("state").eq("asset_id", fixture.photoId).single();
    if (job.error) throw job.error;
    assert.equal(job.data.state, "complete");
    const oldObject = await publicObjectStatus(env, LEGACY_BUCKET, fixture.oldPath);
    assert.ok(oldObject.status < 200 || oldObject.status >= 300);
  }
  const idempotent = runBackfill(env, ["--apply", "--limit=500"]);
  assert.equal(idempotent.failed, 0);
  assert.equal(idempotent.ambiguous, 0);
  assert.equal(idempotent.legacy, 0);
  record("legacy backfill inventory, verified private copy, copied-state recovery, public deletion, and idempotent rerun");

  const deleted = await routeJson(`/api/reviews/${privatePost.reviewId}`, ownerSession.token, undefined, "DELETE");
  assert.ok(deleted.response.status === 200 || deleted.response.status === 202, JSON.stringify(deleted.json));
  await mediaAccess(privatePost.assetId, ownerSession.token, 0);
  const deletedObject = await admin.storage.from(PRIVATE_BUCKET).download(privatePost.path);
  assert.ok(deletedObject.error);
  record("post deletion revokes authorization and removes the underlying private object");

  const waitUntil = publicUrlIssuedAt + (SIGNED_URL_TTL_SECONDS + 3) * 1000;
  while (Date.now() < waitUntil) {
    const remaining = Math.ceil((waitUntil - Date.now()) / 1000);
    console.log(`WAIT: exact 300-second signed URL expiry check (${remaining}s remaining)`);
    await delay(Math.min(30_000, waitUntil - Date.now()));
  }
  const expired = await fetch(publicSignedUrl, { cache: "no-store" });
  assert.notEqual(expired.status, 200);
  record("route-issued 300-second signed URL is unusable after expiry");

  console.log(`\nPhase 1A runtime validation complete: ${results.length}/${results.length} checks passed.`);
}

try {
  await main();
} finally {
  await stopNext();
}
