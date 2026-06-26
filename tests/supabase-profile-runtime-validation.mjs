#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const NEXT_PORT = Number(process.env.PROFILE_RUNTIME_NEXT_PORT ?? 3026);
const NEXT_BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const CLEANUP_SECRET = "local-profile-runtime-cleanup-secret";
const REVIEW_MEDIA_BUCKET = "review-photos";
const QUARANTINE_BUCKET = "review-media-quarantine";

const results = [];
const createdUserIds = new Set();
let nextProcess = null;

function record(name, status, detail = "") {
  results.push({ name, status, detail });
  console.log(`${status}: ${name}${detail ? ` - ${detail}` : ""}`);
}

function runSupabaseStatus() {
  const status = spawnSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: "mobile",
    encoding: "utf8"
  });
  if (status.status !== 0) {
    throw new Error(`supabase status failed: ${status.stderr || status.stdout}`);
  }
  const parsed = JSON.parse(status.stdout);
  return {
    anonKey: parsed.ANON_KEY,
    serviceRoleKey: parsed.SERVICE_ROLE_KEY,
    url: parsed.API_URL
  };
}

async function waitForRoute() {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${NEXT_BASE_URL}/api/mobile/review-media/upload-intent`, { method: "OPTIONS" });
      if (res.status === 204) return;
      lastError = `status ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(750);
  }
  throw new Error(`Next route did not become ready: ${lastError}`);
}

function startNext(env) {
  nextProcess = spawn("npx", ["next", "dev", "-p", String(NEXT_PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACCOUNT_MEDIA_CLEANUP_SECRET: CLEANUP_SECRET,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  nextProcess.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (/error|failed/i.test(text)) process.stdout.write(text);
  });
  nextProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/error|failed/i.test(text)) process.stderr.write(text);
  });
}

async function stopNext() {
  if (!nextProcess) return;
  nextProcess.kill("SIGTERM");
  await delay(1000);
  if (nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
}

async function createRuntimeUser(admin, emailPrefix, username) {
  const email = `${emailPrefix}.${Date.now()}@example.test`;
  const password = `Password-${Date.now()}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username }
  });
  if (error || !data.user) throw error ?? new Error("user_create_failed");
  createdUserIds.add(data.user.id);

  const { error: profileError } = await admin.from("profiles").insert({
    first_name: username,
    id: data.user.id,
    last_name: "Runtime",
    username
  });
  if (profileError) throw profileError;

  return { email, id: data.user.id, password, username };
}

async function signedClient(env, user) {
  const client = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password
  });
  if (error || !data.session) throw error ?? new Error("sign_in_failed");
  return { client, token: data.session.access_token };
}

async function routeJson(path, token, body, init = {}) {
  const res = await fetch(`${NEXT_BASE_URL}${path}`, {
    ...init,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    },
    method: init.method ?? "POST"
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { json, res };
}

async function imageBuffer(format, options = {}) {
  const width = options.width ?? 16;
  const height = options.height ?? 16;
  let pipeline = sharp({
    create: {
      background: options.background ?? { alpha: 1, b: 64, g: 128, r: 200 },
      channels: 4,
      height,
      width
    }
  });
  if (format === "jpeg") pipeline = pipeline.jpeg({ quality: 90 });
  if (format === "png") pipeline = pipeline.png();
  if (format === "webp") pipeline = pipeline.webp();
  return pipeline.toBuffer();
}

async function createIntent(token, input) {
  const { res, json } = await routeJson("/api/mobile/review-media/upload-intent", token, input);
  assert.equal(res.status, 200, `intent failed: ${JSON.stringify(json)}`);
  assert.equal(json.uploadBucket, QUARANTINE_BUCKET);
  assert.ok(json.intentId);
  assert.ok(json.uploadPath);
  return json;
}

async function uploadToQuarantine(client, path, buffer, contentType, options = {}) {
  return client.storage.from(QUARANTINE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: options.upsert ?? false
  });
}

async function finalize(token, intent, category = intent.category) {
  return routeJson("/api/mobile/review-media/finalize-upload", token, {
    category,
    intentId: intent.intentId,
    uploadPath: intent.uploadPath
  });
}

async function publicObjectStatus(env, bucket, path) {
  const url = `${env.url}/storage/v1/object/public/${bucket}/${encodeURIComponent(path).replaceAll("%2F", "/")}`;
  const res = await fetch(url);
  return { contentType: res.headers.get("content-type") ?? "", status: res.status, url };
}

function assertNotPubliclyRetrievable(status, label) {
  assert.ok(status < 200 || status >= 300, `${label} returned public success status ${status}`);
}

async function validateImageRouteCase({ admin, buffer, contentType, name, token, userClient }) {
  const intent = await createIntent(token, {
    category: "post",
    fileName: `runtime.${contentType.split("/")[1]}`,
    fileSizeBytes: buffer.byteLength,
    mediaKind: "image",
    mimeType: contentType
  });
  const upload = await uploadToQuarantine(userClient, intent.uploadPath, buffer, contentType);
  assert.equal(upload.error, null, `${name} upload failed: ${upload.error?.message}`);
  const finalized = await finalize(token, intent);
  assert.equal(finalized.res.status, 200, `${name} finalize failed: ${JSON.stringify(finalized.json)}`);
  assert.equal(finalized.json.mimeType, "image/jpeg");
  assert.match(finalized.json.storagePath, new RegExp(`^posts/.+/${intent.intentId}/media\\.jpg$`));

  const { data: finalObject, error: downloadError } = await admin.storage
    .from(REVIEW_MEDIA_BUCKET)
    .download(finalized.json.storagePath);
  assert.equal(downloadError, null, `${name} final download failed: ${downloadError?.message}`);
  const finalBuffer = Buffer.from(await finalObject.arrayBuffer());
  const metadata = await sharp(finalBuffer).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);

  const quarantineAfter = await admin.storage.from(QUARANTINE_BUCKET).download(intent.uploadPath);
  assert.ok(quarantineAfter.error, `${name} quarantine object should be deleted after finalization`);
  record(`image validation ${name}`, "PASS", `${contentType} -> image/jpeg ${metadata.width}x${metadata.height}`);
  return { finalized: finalized.json, intent };
}

async function main() {
  const env = runSupabaseStatus();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const anon = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  startNext(env);
  await waitForRoute();
  record("Next HTTP routes booted with local Supabase env", "PASS", NEXT_BASE_URL);

  const userA = await createRuntimeUser(admin, "runtime-a", "runtime_a");
  const userB = await createRuntimeUser(admin, "runtime-b", "runtime_b");
  const userC = await createRuntimeUser(admin, "runtime-c", "runtime_c");
  const a = await signedClient(env, userA);
  const b = await signedClient(env, userB);
  const c = await signedClient(env, userC);
  record("real auth users created and signed in", "PASS", "User A, User B, User C");

  const buckets = await admin.storage.listBuckets();
  assert.equal(buckets.error, null);
  const quarantineBucket = buckets.data.find((bucket) => bucket.id === QUARANTINE_BUCKET);
  const reviewBucket = buckets.data.find((bucket) => bucket.id === REVIEW_MEDIA_BUCKET);
  assert.equal(quarantineBucket?.public, false);
  assert.equal(reviewBucket?.public, true);
  record("bucket visibility", "PASS", "quarantine private, review-photos public");

  const anonIntent = await routeJson("/api/mobile/review-media/upload-intent", null, {
    category: "post",
    fileName: "x.jpg",
    fileSizeBytes: 1,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  assert.equal(anonIntent.res.status, 401);
  record("anonymous upload intent denied", "PASS");

  const jpeg = await imageBuffer("jpeg");
  const intent = await createIntent(a.token, {
    category: "post",
    fileName: "food.jpg",
    fileSizeBytes: jpeg.byteLength,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  assert.ok(intent.uploadPath.includes(`/`));
  assert.ok(intent.uploadPath.startsWith(`pending/${userA.id}/${intent.intentId}/`));
  assert.ok(intent.storagePath.startsWith(`posts/${userA.id}/${intent.intentId}/`));
  record("User A upload intent owner-scoped", "PASS");

  const anonUpload = await anon.storage.from(QUARANTINE_BUCKET).upload(intent.uploadPath, jpeg, { contentType: "image/jpeg" });
  assert.ok(anonUpload.error);
  const arbitraryUpload = await uploadToQuarantine(a.client, `pending/${userA.id}/not-an-intent/original.jpg`, jpeg, "image/jpeg");
  assert.ok(arbitraryUpload.error);
  const crossUpload = await uploadToQuarantine(b.client, intent.uploadPath, jpeg, "image/jpeg");
  assert.ok(crossUpload.error);
  record("quarantine upload policy denies anonymous/arbitrary/cross-user paths", "PASS");

  const upload = await uploadToQuarantine(a.client, intent.uploadPath, jpeg, "image/jpeg");
  assert.equal(upload.error, null, upload.error?.message);
  const publicPending = await publicObjectStatus(env, QUARANTINE_BUCKET, intent.uploadPath);
  assertNotPubliclyRetrievable(publicPending.status, "pending public GET");
  const userBDownload = await b.client.storage.from(QUARANTINE_BUCKET).download(intent.uploadPath);
  assert.ok(userBDownload.error);
  record("pending quarantine media is not readable by anonymous or User B", "PASS", `anon GET ${publicPending.status}`);

  const userBFinalize = await finalize(b.token, intent);
  assert.equal(userBFinalize.res.status, 404);
  const finalized = await finalize(a.token, intent);
  assert.equal(finalized.res.status, 200, JSON.stringify(finalized.json));
  assert.equal(finalized.json.mimeType, "image/jpeg");
  const publicFinal = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, finalized.json.storagePath);
  assert.equal(publicFinal.status, 200);
  assert.match(publicFinal.contentType, /image\/jpeg/);
  const oldQuarantine = await publicObjectStatus(env, QUARANTINE_BUCKET, intent.uploadPath);
  assertNotPubliclyRetrievable(oldQuarantine.status, "old quarantine GET");
  record("finalization owner/path boundary", "PASS", "User B denied, User A finalized to public JPEG, quarantine removed");

  const png = await imageBuffer("png");
  const webp = await imageBuffer("webp");
  await validateImageRouteCase({ admin, buffer: png, contentType: "image/png", name: "png", token: a.token, userClient: a.client });
  await validateImageRouteCase({ admin, buffer: webp, contentType: "image/webp", name: "webp", token: a.token, userClient: a.client });

  const zeroIntent = await routeJson("/api/mobile/review-media/upload-intent", a.token, {
    category: "post",
    fileName: "zero.jpg",
    fileSizeBytes: 0,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  assert.equal(zeroIntent.res.status, 400);
  const heicIntent = await routeJson("/api/mobile/review-media/upload-intent", a.token, {
    category: "post",
    fileName: "photo.heic",
    fileSizeBytes: 10,
    mediaKind: "image",
    mimeType: "image/heic"
  });
  assert.equal(heicIntent.res.status, 400);
  const videoIntent = await routeJson("/api/mobile/review-media/upload-intent", a.token, {
    category: "post",
    fileName: "video.mp4",
    fileSizeBytes: 10,
    mediaKind: "video",
    mimeType: "video/mp4"
  });
  assert.equal(videoIntent.res.status, 400);
  record("unsupported media intent requests rejected", "PASS", "zero-byte, HEIC, video");

  const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
  const corruptIntent = await createIntent(a.token, {
    category: "post",
    fileName: "corrupt.jpg",
    fileSizeBytes: corrupt.byteLength,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  assert.equal((await uploadToQuarantine(a.client, corruptIntent.uploadPath, corrupt, "image/jpeg")).error, null);
  const corruptFinalize = await finalize(a.token, corruptIntent);
  assert.equal(corruptFinalize.res.status, 415);

  const spoofIntent = await createIntent(a.token, {
    category: "post",
    fileName: "spoof.png",
    fileSizeBytes: jpeg.byteLength,
    mediaKind: "image",
    mimeType: "image/png"
  });
  assert.equal((await uploadToQuarantine(a.client, spoofIntent.uploadPath, jpeg, "image/png")).error, null);
  const spoofFinalize = await finalize(a.token, spoofIntent);
  assert.equal(spoofFinalize.res.status, 415);

  const hugeDimension = await imageBuffer("png", { height: 1, width: 6001 });
  const hugeIntent = await createIntent(a.token, {
    category: "post",
    fileName: "huge.png",
    fileSizeBytes: hugeDimension.byteLength,
    mediaKind: "image",
    mimeType: "image/png"
  });
  assert.equal((await uploadToQuarantine(a.client, hugeIntent.uploadPath, hugeDimension, "image/png")).error, null);
  const hugeFinalize = await finalize(a.token, hugeIntent);
  assert.equal(hugeFinalize.res.status, 415);
  record("invalid image finalization rejected", "PASS", "corrupt, MIME spoof, oversized dimensions");

  const review = await routeJson("/api/reviews", a.token, {
    body: "runtime validation review",
    items: [{ name: "runtime dish", rating: 5 }],
    media: [{ intentId: finalized.json.intentId, mediaType: "image" }],
    restaurantName: "Runtime Cafe",
    visibility: "public"
  });
  assert.equal(review.res.status, 200, JSON.stringify(review.json));
  assert.ok(review.json.id);
  const replayReview = await routeJson("/api/reviews", a.token, {
    body: "runtime validation replay",
    items: [{ name: "runtime dish", rating: 5 }],
    media: [{ intentId: finalized.json.intentId, mediaType: "image" }],
    restaurantName: "Runtime Cafe",
    visibility: "public"
  });
  assert.equal(replayReview.res.status, 403);
  const userBReview = await routeJson("/api/reviews", b.token, {
    body: "runtime validation cross user",
    items: [{ name: "runtime dish", rating: 5 }],
    media: [{ intentId: finalized.json.intentId, mediaType: "image" }],
    restaurantName: "Runtime Cafe",
    visibility: "public"
  });
  assert.equal(userBReview.res.status, 403);
  record("post media lifecycle rejects consumed and cross-user intents", "PASS");

  const rawReviewInsert = await a.client.from("reviews").insert({
    items: [],
    photo_url: "https://attacker.example/media.jpg",
    restaurant_name: "Runtime Raw",
    reviewer_name: userA.username,
    visibility: "public"
  });
  assert.ok(rawReviewInsert.error);
  record("direct arbitrary review media URL insert rejected", "PASS");

  const anonUsername = await anon.rpc("update_current_username", { p_username: "anon_try" });
  assert.ok(anonUsername.error);
  const validUsername = await a.client.rpc("update_current_username", { p_username: " runtime_a2 " });
  assert.equal(validUsername.error, null, validUsername.error?.message);
  assert.equal(validUsername.data?.[0]?.username, "runtime_a2");
  const duplicateUsername = await b.client.rpc("update_current_username", { p_username: "RUNTIME_A2" });
  assert.ok(duplicateUsername.error);

  const race = await Promise.allSettled([
    b.client.rpc("update_current_username", { p_username: "runtime_race" }),
    c.client.rpc("update_current_username", { p_username: "runtime_race" })
  ]);
  const successes = race.filter((item) => item.status === "fulfilled" && !item.value.error);
  const failures = race.filter((item) => item.status === "fulfilled" && item.value.error);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  record("username RPC auth, normalization, duplicate, and race checks", "PASS");

  const stats = await a.client.rpc("profile_post_stats", { p_username: "runtime_a2" });
  assert.equal(stats.error, null, stats.error?.message);
  assert.equal(stats.data?.[0]?.total_visits, 1);
  assert.equal(stats.data?.[0]?.unique_places, 1);
  assert.equal(stats.data?.[0]?.unique_dishes, 1);
  record("profile stats RPC counts complete visible data for runtime user", "PASS");

  const { error: jobError } = await admin.from("account_media_cleanup_jobs").insert({
    bucket_id: REVIEW_MEDIA_BUCKET,
    owner_names: ["runtime_a2"],
    status: "pending",
    storage_paths: [finalized.json.storagePath, `posts/${userB.id}/not-owned/media.jpg`],
    user_id: userA.id
  });
  assert.equal(jobError, null, jobError?.message);
  const noSecret = await routeJson("/api/internal/account-media-cleanup", null, { limit: 10 });
  assert.equal(noSecret.res.status, 404);
  const wrongSecret = await routeJson("/api/internal/account-media-cleanup", null, { limit: 10 }, {
    headers: { Authorization: "Bearer wrong" }
  });
  assert.equal(wrongSecret.res.status, 404);
  const cleanup = await routeJson("/api/internal/account-media-cleanup", null, { limit: 10 }, {
    headers: { Authorization: `Bearer ${CLEANUP_SECRET}` }
  });
  assert.equal(cleanup.res.status, 200, JSON.stringify(cleanup.json));
  assert.ok(cleanup.json.processed >= 1);
  const finalAfterCleanup = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, finalized.json.storagePath);
  assertNotPubliclyRetrievable(finalAfterCleanup.status, "cleanup final object GET");
  record("cleanup worker protected and idempotent for owned paths", "PASS");

  const passed = results.filter((item) => item.status === "PASS").length;
  console.log(`\nRuntime validation complete: ${passed}/${results.length} checks passed.`);
}

try {
  await main();
} finally {
  const env = (() => {
    try {
      return runSupabaseStatus();
    } catch {
      return null;
    }
  })();
  if (env) {
    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    await Promise.all([...createdUserIds].map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)));
  }
  await stopNext();
}
