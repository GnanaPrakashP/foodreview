#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_CWD = path.resolve(".");
const NEXT_PORT = Number(process.env.PROFILE_STAGING_NEXT_PORT ?? 3036);
const NEXT_BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const CLEANUP_SECRET = "local-profile-staging-cleanup-secret";
const PRE_HARDENING_VERSION = "202606220001";
const REVIEW_MEDIA_BUCKET = "review-photos";
const QUARANTINE_BUCKET = "review-media-quarantine";
const PROFILE_PAGE_SIZE = 24;

const results = [];
const createdUserIds = new Set();
let nextProcess = null;

function record(name, status = "PASS", detail = "") {
  results.push({ detail, name, status });
  console.log(`${status}: ${name}${detail ? ` - ${detail}` : ""}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 1024 * 1024 * 20
  });
  if (options.expectFailure) {
    assert.notEqual(result.status, 0, `${command} ${args.join(" ")} unexpectedly succeeded`);
    return result;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}

function supabase(args, options = {}) {
  return run(process.execPath, ["scripts/run-supabase.mjs", ...args], { cwd: SUPABASE_CWD, ...options });
}

function runSupabaseStatus() {
  const status = supabase(["status", "-o", "json"]);
  const parsed = JSON.parse(status.stdout);
  return {
    anonKey: parsed.ANON_KEY,
    serviceRoleKey: parsed.SERVICE_ROLE_KEY,
    url: parsed.API_URL
  };
}

function dbQuery(sql, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "profile-gates-sql-"));
  const file = path.join(dir, "query.sql");
  writeFileSync(file, sql);
  try {
    return supabase(["db", "query", "--local", "--file", file], options);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

async function waitForRoute() {
  const deadline = Date.now() + 60_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${NEXT_BASE_URL}/api/mobile/review-media/upload-intent`, { method: "OPTIONS" });
      if (res.status === 204) return;
      last = `status ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(750);
  }
  throw new Error(`Next routes did not become ready: ${last}`);
}

function startNext(env) {
  if (nextProcess) return;
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
  nextProcess = null;
}

async function routeJson(pathname, token, body, init = {}) {
  let res = null;
  let lastNetworkError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      res = await fetch(`${NEXT_BASE_URL}${pathname}`, {
        ...init,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {})
        },
        method: init.method ?? "POST"
      });
      break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt === 4) throw error;
      await delay(250 * (attempt + 1));
    }
  }
  if (!res) throw lastNetworkError ?? new Error("route_request_failed");
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { json, res };
}

async function imageBuffer(format = "jpeg", options = {}) {
  let pipeline = sharp({
    create: {
      background: options.background ?? { alpha: 1, b: 64, g: 128, r: 200 },
      channels: 4,
      height: options.height ?? 12,
      width: options.width ?? 12
    }
  });
  if (format === "png") pipeline = pipeline.png();
  else if (format === "webp") pipeline = pipeline.webp();
  else pipeline = pipeline.jpeg({ quality: 88 });
  return pipeline.toBuffer();
}

async function createRuntimeUser(admin, emailPrefix, username, extraProfile = {}) {
  const email = `${emailPrefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
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
    account_type: "public",
    first_name: username,
    id: data.user.id,
    last_name: "Gate",
    username,
    ...extraProfile
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

async function createIntent(token, input) {
  const { json, res } = await routeJson("/api/mobile/review-media/upload-intent", token, input);
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.uploadBucket, QUARANTINE_BUCKET);
  return json;
}

async function uploadQuarantine(client, uploadPath, buffer, contentType, upsert = false) {
  return client.storage.from(QUARANTINE_BUCKET).upload(uploadPath, buffer, { contentType, upsert });
}

async function finalizeIntent(token, intent, overrides = {}) {
  return routeJson("/api/mobile/review-media/finalize-upload", token, {
    category: overrides.category ?? intent.category,
    intentId: overrides.intentId ?? intent.intentId,
    uploadPath: overrides.uploadPath ?? intent.uploadPath
  });
}

async function publicObjectStatus(env, bucket, objectPath) {
  const url = `${env.url}/storage/v1/object/public/${bucket}/${encodeURIComponent(objectPath).replaceAll("%2F", "/")}`;
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get("content-type") ?? "", url };
}

function assertNotPublic(status, label) {
  assert.ok(status < 200 || status >= 300, `${label} was publicly retrievable with ${status}`);
}

function reviewRow(username, index, overrides = {}) {
  const createdAt = overrides.created_at ?? new Date(Date.UTC(2026, 0, 1, 12, Math.floor(index / 10), 0)).toISOString();
  return {
    body: `Seeded profile post ${index}`,
    created_at: createdAt,
    items: [{ name: `Dish ${index % 7}`, rating: 4 }],
    restaurant_id: `place-${index % 11}`,
    restaurant_name: `Place ${index % 11}`,
    reviewer_name: username,
    status: "active",
    visibility: "public",
    ...overrides
  };
}

async function insertReviews(admin, rows) {
  const inserted = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { data, error } = await admin.from("reviews").insert(chunk).select("id, created_at, reviewer_name, visibility, status");
    if (error) throw error;
    inserted.push(...(data ?? []));
  }
  return inserted;
}

async function fetchProfilePage(client, username, cursor = null) {
  let query = client
    .from("reviews")
    .select("id, created_at, reviewer_name, visibility, deleted_at, hidden_at, status")
    .eq("reviewer_name", username)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active");

  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PROFILE_PAGE_SIZE + 1);
  if (error) throw error;
  const rows = data ?? [];
  const pageRows = rows.slice(0, PROFILE_PAGE_SIZE);
  return {
    cursor: rows.length > PROFILE_PAGE_SIZE && pageRows.length
      ? { createdAt: pageRows.at(-1).created_at, id: pageRows.at(-1).id }
      : null,
    rows: pageRows
  };
}

async function fetchAllProfileRows(client, username, mutateAfterFirstPage = null) {
  const seen = new Set();
  const rows = [];
  let cursor = null;
  let pageIndex = 0;
  for (;;) {
    const page = await fetchProfilePage(client, username, cursor);
    for (const row of page.rows) {
      assert.equal(seen.has(row.id), false, `duplicate row ${row.id}`);
      seen.add(row.id);
      rows.push(row);
    }
    cursor = page.cursor;
    pageIndex += 1;
    if (pageIndex === 1 && mutateAfterFirstPage) await mutateAfterFirstPage(page);
    if (!cursor) break;
  }
  return rows;
}

async function uploadMany(storageClient, bucket, prefix, count, buffer, contentType) {
  const failures = [];
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= count) return;
      const objectPath = `${prefix}/object-${String(index).padStart(4, "0")}.jpg`;
      const { error } = await storageClient.from(bucket).upload(objectPath, buffer, { contentType, upsert: false });
      if (error) failures.push(`${objectPath}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: 20 }, () => worker()));
  assert.deepEqual(failures, []);
}

async function validateDuplicatePreflight() {
  supabase(["db", "reset", "--version", PRE_HARDENING_VERSION]);
  const env = runSupabaseStatus();
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const invalidUser = await createRuntimeUser(admin, "invalid-user", "invalid_seed");
  const nullProfile = await admin.from("profiles").insert({
    first_name: "Null",
    id: randomUUID(),
    last_name: "User",
    username: null
  });
  assert.ok(nullProfile.error, "pre-hardening schema should reject null username through normal path");
  const malformedProfile = await admin.from("profiles").insert({
    first_name: "Bad",
    id: invalidUser.id,
    last_name: "Name",
    username: "Bad.Name"
  });
  assert.ok(malformedProfile.error, "pre-hardening schema should reject malformed username through normal path");
  record("pre-hardening schema rejects null and malformed usernames through normal constraints");

  await createRuntimeUser(admin, "dup-a", "legacy_dup");
  const dupB = await createRuntimeUser(admin, "dup-b", "legacy_other");
  dbQuery("alter table public.profiles drop constraint if exists profiles_username_format");
  dbQuery(`update public.profiles set username = 'Legacy_Dup' where id = '${dupB.id}'`);
  const migration = supabase(["migration", "up", "--local"], { expectFailure: true });
  const output = `${migration.stdout}\n${migration.stderr}`;
  assert.match(output, /profiles_username_lower_unique_preflight_failed|duplicate key value|23505/i);
  record("hardening migration fails safely on case-insensitive duplicate usernames");
}

async function seedValidExistingData() {
  supabase(["db", "reset", "--version", PRE_HARDENING_VERSION]);
  const env = runSupabaseStatus();
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const jpeg = await imageBuffer("jpeg");
  const legacyMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("mp42isom", "ascii")
  ]);

  const profile0 = await createRuntimeUser(admin, "profile-0", "profile_zero");
  const profile24 = await createRuntimeUser(admin, "profile-24", "profile_24");
  const profile25 = await createRuntimeUser(admin, "profile-25", "profile_25");
  const profile500 = await createRuntimeUser(admin, "profile-500", "profile_500");
  const observer = await createRuntimeUser(admin, "profile-observer", "profile_observer");
  const legacy = await createRuntimeUser(admin, "legacy-media", "legacy_media");
  const deleteUser = await createRuntimeUser(admin, "delete-user", "delete_user");
  const rollbackUser = await createRuntimeUser(admin, "rollback-user", "rollback_user");

  await insertReviews(admin, Array.from({ length: 24 }, (_, index) => reviewRow(profile24.username, index)));
  await insertReviews(admin, [
    ...Array.from({ length: 25 }, (_, index) => reviewRow(profile25.username, index)),
    reviewRow(profile25.username, 900, { visibility: "me" }),
    reviewRow(profile25.username, 901, { deleted_at: new Date().toISOString(), status: "deleted" }),
    reviewRow(profile25.username, 902, { hidden_at: new Date().toISOString(), status: "hidden" })
  ]);
  const profile500Rows = await insertReviews(admin, [
    ...Array.from({ length: 500 }, (_, index) => reviewRow(profile500.username, index, {
      created_at: new Date(Date.UTC(2026, 1, 1, 12, Math.floor(index / 10), 0)).toISOString()
    })),
    ...Array.from({ length: 5 }, (_, index) => reviewRow(profile500.username, 700 + index, { visibility: "me" })),
    reviewRow(profile500.username, 800, { deleted_at: new Date().toISOString(), status: "deleted" }),
    reviewRow(profile500.username, 801, { hidden_at: new Date().toISOString(), status: "hidden" })
  ]);
  await insertReviews(admin, [reviewRow(rollbackUser.username, 1)]);

  const legacyReview = await insertReviews(admin, [reviewRow(legacy.username, 1)]);
  const legacyImagePath = `public/mobile/${legacy.id}/legacy-image.jpg`;
  const legacyAvatarPath = `public/avatars/${legacy.id}/legacy-avatar.jpg`;
  const legacyVideoPath = `public/mobile/${legacy.id}/legacy-video.mp4`;
  dbQuery(`
    update storage.buckets
    set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
    where id = '${REVIEW_MEDIA_BUCKET}'
  `);
  assert.equal((await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(legacyImagePath, jpeg, { contentType: "image/jpeg" })).error, null);
  assert.equal((await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(legacyAvatarPath, jpeg, { contentType: "image/jpeg" })).error, null);
  assert.equal((await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(legacyVideoPath, legacyMp4, { contentType: "video/mp4" })).error, null);
  await admin.from("profiles").update({
    avatar_url: `${env.url}/storage/v1/object/public/${REVIEW_MEDIA_BUCKET}/${legacyAvatarPath}`
  }).eq("id", legacy.id);
  await admin.from("review_photos").insert([
    {
      media_type: "image",
      public_url: `${env.url}/storage/v1/object/public/${REVIEW_MEDIA_BUCKET}/${legacyImagePath}`,
      review_id: legacyReview[0].id,
      size_bytes: jpeg.byteLength,
      storage_path: legacyImagePath
    },
    {
      media_type: "video",
      public_url: `${env.url}/storage/v1/object/public/${REVIEW_MEDIA_BUCKET}/${legacyVideoPath}`,
      review_id: legacyReview[0].id,
      size_bytes: 24,
      storage_path: legacyVideoPath
    }
  ]);
  assert.equal((await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(`posts/${legacy.id}/orphan/orphan-image.jpg`, jpeg, { contentType: "image/jpeg" })).error, null);
  assert.equal((await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(`avatars/${legacy.id}/orphan/avatar.jpg`, jpeg, { contentType: "image/jpeg" })).error, null);

  await uploadMany(admin.storage, REVIEW_MEDIA_BUCKET, `posts/${deleteUser.id}/bulk`, 1005, jpeg, "image/jpeg");
  assert.equal((await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(`posts/${deleteUser.id}/single/delete-me.jpg`, jpeg, { contentType: "image/jpeg" })).error, null);
  const publicDeleteBefore = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, `posts/${deleteUser.id}/single/delete-me.jpg`);
  assert.equal(publicDeleteBefore.status, 200);

  const migration = supabase(["migration", "up", "--local"]);
  assert.match(migration.stdout + migration.stderr, /202606250001_profile_media_username_hardening|Applying migration|Finished/i);
  record("hardening migration applies over representative valid existing data");

  return {
    deleteUser,
    env: runSupabaseStatus(),
    legacy,
    legacyPaths: { legacyAvatarPath, legacyImagePath, legacyVideoPath },
    observer,
    profile0,
    profile24,
    profile25,
    profile500,
    profile500Rows,
    rollbackUser
  };
}

async function validateAuthStorageAndRoutes(seed) {
  const env = seed.env;
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  startNext(env);
  await waitForRoute();

  const userA = await createRuntimeUser(admin, "matrix-a", "matrix_a");
  const userB = await createRuntimeUser(admin, "matrix-b", "matrix_b");
  const userC = await createRuntimeUser(admin, "matrix-c", "matrix_c");
  const a = await signedClient(env, userA);
  const b = await signedClient(env, userB);
  const c = await signedClient(env, userC);
  const jpeg = await imageBuffer("jpeg");

  const anonIntent = await routeJson("/api/mobile/review-media/upload-intent", null, {
    category: "avatar",
    fileName: "x.jpg",
    fileSizeBytes: jpeg.byteLength,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  assert.equal(anonIntent.res.status, 401);

  const avatarIntent = await createIntent(a.token, {
    category: "avatar",
    fileName: "avatar.jpg",
    fileSizeBytes: jpeg.byteLength,
    mediaKind: "image",
    mimeType: "image/jpeg",
    userId: userB.id
  });
  assert.ok(avatarIntent.uploadPath.startsWith(`pending/${userA.id}/`), "client-supplied owner must be ignored");
  assert.ok(avatarIntent.storagePath.startsWith(`avatars/${userA.id}/`));

  const arbitrary = await a.client.storage.from(QUARANTINE_BUCKET).upload(`pending/${userB.id}/${avatarIntent.intentId}/original.jpg`, jpeg, { contentType: "image/jpeg" });
  assert.ok(arbitrary.error);
  const anonUpload = await anon.storage.from(QUARANTINE_BUCKET).upload(avatarIntent.uploadPath, jpeg, { contentType: "image/jpeg" });
  assert.ok(anonUpload.error);
  const crossUpload = await b.client.storage.from(QUARANTINE_BUCKET).upload(avatarIntent.uploadPath, jpeg, { contentType: "image/jpeg", upsert: true });
  assert.ok(crossUpload.error);
  const goodUpload = await uploadQuarantine(a.client, avatarIntent.uploadPath, jpeg, "image/jpeg");
  assert.equal(goodUpload.error, null, goodUpload.error?.message);
  const userBRead = await b.client.storage.from(QUARANTINE_BUCKET).download(avatarIntent.uploadPath);
  assert.ok(userBRead.error);
  const publicPending = await publicObjectStatus(env, QUARANTINE_BUCKET, avatarIntent.uploadPath);
  assertNotPublic(publicPending.status, "pending quarantine object");
  const userBDelete = await b.client.storage.from(QUARANTINE_BUCKET).remove([avatarIntent.uploadPath]);
  const afterUserBDeleteAttempt = await admin.storage.from(QUARANTINE_BUCKET).download(avatarIntent.uploadPath);
  assert.equal(
    afterUserBDeleteAttempt.error,
    null,
    `User B delete attempt must not remove User A quarantine object; remove error was ${userBDelete.error?.message ?? "none"}`
  );

  const wrongCategory = await finalizeIntent(a.token, avatarIntent, { category: "post" });
  assert.equal(wrongCategory.res.status, 400);
  const wrongPath = await finalizeIntent(a.token, avatarIntent, { uploadPath: avatarIntent.uploadPath.replace("original", "tampered") });
  assert.equal(wrongPath.res.status, 400);
  const bFinalize = await finalizeIntent(b.token, avatarIntent);
  assert.equal(bFinalize.res.status, 404);
  const finalized = await finalizeIntent(a.token, avatarIntent);
  assert.equal(finalized.res.status, 200, JSON.stringify(finalized.json));
  const replayFinalize = await finalizeIntent(a.token, avatarIntent);
  assert.equal(replayFinalize.res.status, 200);
  const publicFinal = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, finalized.json.storagePath);
  assert.equal(publicFinal.status, 200);
  const { data: avatarProfile } = await admin.from("profiles").select("avatar_url").eq("id", userA.id).maybeSingle();
  assert.ok(avatarProfile?.avatar_url?.includes(finalized.json.storagePath));

  const expiredIntent = await createIntent(a.token, {
    category: "avatar",
    fileName: "expired.jpg",
    fileSizeBytes: jpeg.byteLength,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  await admin.from("review_media_upload_intents").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", expiredIntent.intentId);
  const expiredUpload = await uploadQuarantine(a.client, expiredIntent.uploadPath, jpeg, "image/jpeg");
  assert.ok(expiredUpload.error);
  const expiredFinalize = await finalizeIntent(a.token, expiredIntent);
  assert.equal(expiredFinalize.res.status, 410);

  const raceIntent = await createIntent(a.token, {
    category: "avatar",
    fileName: "race.jpg",
    fileSizeBytes: jpeg.byteLength,
    mediaKind: "image",
    mimeType: "image/jpeg"
  });
  assert.equal((await uploadQuarantine(a.client, raceIntent.uploadPath, jpeg, "image/jpeg")).error, null);
  const raceResults = await Promise.allSettled([finalizeIntent(a.token, raceIntent), finalizeIntent(a.token, raceIntent)]);
  const raceStatuses = raceResults.map((item) => item.status === "fulfilled" ? item.value.res.status : 0);
  assert.ok(raceStatuses.includes(200));

  const manualUrlPost = await routeJson("/api/reviews", a.token, {
    body: "manual url attack",
    items: [{ name: "Matrix Dish", rating: 5 }],
    photoUrl: "https://attacker.example/image.jpg",
    restaurantName: "Matrix Cafe",
    visibility: "public"
  });
  assert.notEqual(manualUrlPost.res.status, 200);

  const duplicateRoute = await routeJson("/api/mobile/profile/username", b.token, { username: "matrix_a" });
  assert.equal(duplicateRoute.res.status, 409);
  assert.equal(duplicateRoute.json.error, "Username is already taken");
  const raceUsername = await Promise.allSettled([
    b.client.rpc("update_current_username", { p_username: "matrix_claim" }),
    c.client.rpc("update_current_username", { p_username: "matrix_claim" })
  ]);
  assert.equal(raceUsername.filter((item) => item.status === "fulfilled" && !item.value.error).length, 1);
  assert.equal(raceUsername.filter((item) => item.status === "fulfilled" && item.value.error).length, 1);

  const sameUserRace = await Promise.allSettled([
    a.client.rpc("update_current_username", { p_username: "matrix_a_one" }),
    a.client.rpc("update_current_username", { p_username: "matrix_a_two" })
  ]);
  assert.equal(sameUserRace.every((item) => item.status === "fulfilled" && !item.value.error), true);
  const { data: finalName } = await admin.from("profiles").select("username").eq("id", userA.id).maybeSingle();
  assert.ok(["matrix_a_one", "matrix_a_two"].includes(finalName.username));

  const rollback = await signedClient(env, seed.rollbackUser);
  dbQuery(`
    create or replace function public.validation_force_review_username_failure()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'forced_denormalized_username_failure' using errcode = 'XX000';
    end;
    $$
  `);
  dbQuery("drop trigger if exists validation_force_review_username_failure_trigger on public.reviews");
  dbQuery(`
    create trigger validation_force_review_username_failure_trigger
      before update of reviewer_name on public.reviews
      for each row
      when (old.reviewer_name = 'rollback_user')
      execute function public.validation_force_review_username_failure()
  `);
  const rollbackRoute = await routeJson("/api/mobile/profile/username", rollback.token, { username: "rollback_new" });
  assert.equal(rollbackRoute.res.status, 500);
  assert.equal(rollbackRoute.json.error, "Could not update username");
  const { data: rollbackProfile } = await admin.from("profiles").select("username").eq("id", seed.rollbackUser.id).maybeSingle();
  const { data: rollbackReviews } = await admin.from("reviews").select("reviewer_name").eq("reviewer_name", "rollback_user");
  assert.equal(rollbackProfile.username, "rollback_user");
  assert.ok((rollbackReviews ?? []).length > 0);
  dbQuery("drop trigger if exists validation_force_review_username_failure_trigger on public.reviews");
  dbQuery("drop function if exists public.validation_force_review_username_failure()");

  record("full Auth/RLS/Storage route matrix passed", "PASS", "avatar upload/quarantine/finalize and username RPC; post media is owned by Phase 1A");
}

async function validateSeededProfileData(seed) {
  const env = seed.env;
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const owner500 = await signedClient(env, seed.profile500);
  const owner25 = await signedClient(env, seed.profile25);
  const observer = await signedClient(env, seed.observer);
  const anon = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  async function stat(client, username) {
    const { data, error } = await client.rpc("profile_post_stats", { p_username: username });
    if (error) throw error;
    return data?.[0] ?? { total_visits: 0, unique_dishes: 0, unique_places: 0 };
  }

  assert.equal((await stat(owner500.client, seed.profile0.username)).total_visits, 0);
  assert.equal((await stat(owner500.client, seed.profile24.username)).total_visits, 24);
  assert.equal((await stat(owner25.client, seed.profile25.username)).total_visits, 26);
  assert.equal((await stat(observer.client, seed.profile25.username)).total_visits, 25);
  assert.equal((await stat(owner500.client, seed.profile500.username)).total_visits, 505);
  assert.equal((await stat(observer.client, seed.profile500.username)).total_visits, 500);
  assert.equal((await stat(anon, seed.profile500.username)).total_visits, 500);

  let deletedFutureId = null;
  let insertedNewId = null;
  const rows = await fetchAllProfileRows(owner500.client, seed.profile500.username, async () => {
    const futureRows = await admin
      .from("reviews")
      .select("id")
      .eq("reviewer_name", seed.profile500.username)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1);
    deletedFutureId = futureRows.data?.[0]?.id ?? null;
    if (deletedFutureId) {
      await admin.from("reviews").update({ deleted_at: new Date().toISOString(), status: "deleted" }).eq("id", deletedFutureId);
    }
    const inserted = await insertReviews(admin, [reviewRow(seed.profile500.username, 9999, {
      created_at: new Date(Date.UTC(2027, 0, 1)).toISOString()
    })]);
    insertedNewId = inserted[0].id;
  });
  assert.equal(rows.some((row) => row.id === insertedNewId), false, "newer inserted post must not drift into next pages");
  assert.equal(rows.some((row) => row.id === deletedFutureId), false, "deleted post must not appear after deletion");
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.equal(rows.length, 504);

  const refreshedFirstPage = await fetchProfilePage(owner500.client, seed.profile500.username, null);
  assert.equal(refreshedFirstPage.rows[0].id, insertedNewId);
  const observerRows = await fetchAllProfileRows(observer.client, seed.profile500.username);
  assert.equal(observerRows.every((row) => row.visibility === "public"), true);
  assert.equal(observerRows.length, 500);
  record("seeded profile stats and pagination passed", "PASS", "0/24/25/500, identical timestamps, insert/delete drift, privacy");
}

async function validateCleanup(seed) {
  const env = seed.env;
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  startNext(env);
  await waitForRoute();
  const deleteUserSession = await signedClient(env, seed.deleteUser);
  const oldPublic = `posts/${seed.deleteUser.id}/single/delete-me.jpg`;
  const before = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, oldPublic);
  assert.equal(before.status, 200);
  const deleteResponse = await routeJson("/api/delete-account", deleteUserSession.token, {});
  assert.equal(deleteResponse.res.status, 202, JSON.stringify(deleteResponse.json));
  assert.equal(deleteResponse.json.accepted, true);
  const { data: deletionJob } = await admin
    .from("account_deletion_jobs")
    .select("id, status, user_id")
    .eq("id", deleteResponse.json.jobId)
    .maybeSingle();
  assert.equal(deletionJob?.user_id, seed.deleteUser.id);
  assert.equal(deletionJob?.status, "inventory_pending");
  assert.equal(deletionJob.status, deleteResponse.json.status);
  const { data: deletingProfile } = await admin
    .from("profiles")
    .select("account_status")
    .eq("id", seed.deleteUser.id)
    .maybeSingle();
  assert.equal(deletingProfile?.account_status, "deleting");

  const retryPath = `posts/${seed.legacy.id}/retry/retry-object.jpg`;
  const retryBuffer = await imageBuffer("jpeg");
  await admin.storage.from(REVIEW_MEDIA_BUCKET).upload(retryPath, retryBuffer, { contentType: "image/jpeg" });
  const { data: retryJob, error: retryJobError } = await admin.from("account_media_cleanup_jobs").insert({
    attempts: 1,
    bucket_id: REVIEW_MEDIA_BUCKET,
    last_error: "validation_retry",
    next_retry_at: new Date(Date.now() - 1000).toISOString(),
    owner_names: [seed.legacy.username],
    status: "failed",
    storage_paths: [retryPath, `posts/${seed.deleteUser.id}/must-not-delete.jpg`],
    user_id: seed.legacy.id
  }).select("id").maybeSingle();
  assert.equal(retryJobError, null, retryJobError?.message);
  const worker = await routeJson("/api/internal/account-media-cleanup", null, { limit: 10 }, {
    headers: { Authorization: `Bearer ${CLEANUP_SECRET}` }
  });
  assert.equal(worker.res.status, 200, JSON.stringify(worker.json));
  const { data: jobAfter } = await admin.from("account_media_cleanup_jobs").select("status, attempts").eq("id", retryJob.id).maybeSingle();
  assert.equal(jobAfter.status, "succeeded");
  assert.equal(jobAfter.attempts, 2);
  const retryStatus = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, retryPath);
  assertNotPublic(retryStatus.status, "retry cleanup object");

  const videoBefore = await publicObjectStatus(env, REVIEW_MEDIA_BUCKET, seed.legacyPaths.legacyVideoPath);
  assert.equal(videoBefore.status, 200);
  const { data: legacyVideoRow } = await admin
    .from("review_photos")
    .select("media_type, storage_path")
    .eq("storage_path", seed.legacyPaths.legacyVideoPath)
    .maybeSingle();
  assert.equal(legacyVideoRow.media_type, "video");
  record("cleanup and legacy media validation passed", "PASS", "durable deletion accepted, legacy retry worker, legacy video retained; terminal account cleanup is owned by Phase 1B");
}

async function validateExistingDataAndGates() {
  supabase(["start"]);
  await validateDuplicatePreflight();
  const seed = await seedValidExistingData();
  await validateAuthStorageAndRoutes(seed);
  await validateSeededProfileData(seed);
  await validateCleanup(seed);
}

try {
  await validateExistingDataAndGates();
  const passed = results.filter((item) => item.status === "PASS").length;
  console.log(`\nProfile staging production gates complete: ${passed}/${results.length} checks passed.`);
} finally {
  await stopNext();
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
}
