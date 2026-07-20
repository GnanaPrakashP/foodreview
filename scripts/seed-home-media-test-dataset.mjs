#!/usr/bin/env node

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import mediaImageProcessing from "../lib/media-image-processing.cjs";

const { MEDIA_IMAGE_PROCESSING_VERSION, normalizeAlphaForJpeg } = mediaImageProcessing;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_ID = "home_media_test_v1";
const LINKED_REF_PATH = path.join(ROOT, "supabase/.temp/project-ref");
const MANIFEST_PATH = path.join(ROOT, "scripts/fixtures/home-media-test-manifest.json");
const OUTPUT_DIR = path.join(ROOT, "tmp/home-media-test-v1");
const FIXTURE_DIR = path.join(OUTPUT_DIR, "fixtures");
const REPORT_PATH = path.join(OUTPUT_DIR, "verification-report.json");
const SERVER_PORT = 3068;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const HOSTED_ENVIRONMENT = "disposable-staging";
const HOSTED_CONFIRMATION_PREFIX = "SEED_HOME_MEDIA_FIXTURE";
const WORKER_SECRET = `hmt-worker-${randomBytes(32).toString("hex")}`;
const RATE_LIMIT_SECRET = `hmt-rate-${randomBytes(32).toString("hex")}`;
const OPERATOR_HASH = createHash("sha256").update(`${DATASET_ID}:local-moderation`).digest("hex");

const ROLE_DEFINITIONS = [
  { key: "viewer", email: "home-media-viewer@example.test", firstName: "Media", lastName: "Viewer", username: "hmtv1_viewer", accountType: "public" },
  { key: "author_a", email: "home-media-author-a@example.test", firstName: "Media", lastName: "Author A", username: "hmtv1_author_a", accountType: "public" },
  { key: "author_b", email: "home-media-author-b@example.test", firstName: "Media", lastName: "Author B", username: "hmtv1_author_b", accountType: "public" },
  { key: "private_author", email: "home-media-private@example.test", firstName: "Media", lastName: "Private", username: "hmtv1_private", accountType: "private" },
  { key: "no_avatar_author", email: "home-media-no-avatar@example.test", firstName: "Media", lastName: "No Avatar", username: "hmtv1_no_avatar", accountType: "public" },
  { key: "blocked_author", email: "home-media-blocked@example.test", firstName: "Media", lastName: "Blocked", username: "hmtv1_blocked", accountType: "public" }
];

const CASES = [
  { order: 1, author: "author_a", label: "TEST 01 — Portrait image", description: "Expected Home behavior: bright portrait source is normalized to the fixed 4:5 cover.", visibility: "public", fixtures: ["portrait_bright"] },
  { order: 2, author: "author_b", label: "TEST 02 — Landscape image", description: "Expected Home behavior: landscape source fills the fixed 4:5 cover without changing layout.", visibility: "public", fixtures: ["landscape_bright"] },
  { order: 3, author: "author_a", label: "TEST 03 — Square image", description: "Expected Home behavior: square source is normalized to the fixed 4:5 cover.", visibility: "public", fixtures: ["square_texture"] },
  { order: 4, author: "author_b", label: "TEST 04 — High-resolution image", description: "Expected Home behavior: high-detail source uses the 720×900 feed derivative.", visibility: "public", fixtures: ["high_resolution"] },
  { order: 5, author: "author_a", label: "TEST 05 — Dark low-light image", description: "Expected Home behavior: dark detail remains visible without a layout change.", visibility: "public", fixtures: ["dark_low_light"] },
  { order: 6, author: "author_b", label: "TEST 06 — Two images", description: "Expected Home behavior: only image 1 receives delivery metadata; mediaCount should be 2.", visibility: "public", fixtures: ["portrait_bright", "landscape_bright"] },
  { order: 7, author: "author_a", label: "TEST 07 — Three images", description: "Expected Home behavior: fixed 4:5 swiping with three bottom carousel dots.", visibility: "public", fixtures: ["square_texture", "edge_detail", "low_contrast"] },
  { order: 8, author: "author_b", label: "TEST 08 — Five images", description: "Expected Home behavior: fixed 4:5 swiping with five bottom carousel dots.", visibility: "public", fixtures: ["portrait_bright", "landscape_bright", "square_texture", "dark_low_light", "edge_detail"] },
  { order: 9, author: "author_a", label: "TEST 09 — Portrait video", description: "Expected Home behavior: poster only until Play; no initial playback URL.", visibility: "public", fixtures: ["portrait_video"] },
  { order: 10, author: "no_avatar_author", label: "TEST 10 — Initials avatar fallback", description: "Expected Home behavior: valid single media with deterministic initials because the author has no avatar asset.", visibility: "public", fixtures: ["low_contrast"] },
  { order: 11, author: "author_b", label: "TEST 11 — Ten images", description: "Expected Home behavior: condensed moving dots and progressive next-item downloads across ten images.", visibility: "public", fixtures: ["portrait_bright", "landscape_bright", "square_texture", "high_resolution", "dark_low_light", "low_contrast", "edge_detail", "portrait_bright", "square_texture", "landscape_bright"] },
  { order: 12, author: "author_a", label: "TEST 12 — Landscape video", description: "Expected Home behavior: landscape video has a poster and playback begins only on Play.", visibility: "public", fixtures: ["landscape_video"] },
  { order: 13, author: "author_a", label: "TEST 13 — Image then video", description: "Expected Home behavior: image is the cover; the second video remains unloaded.", visibility: "public", fixtures: ["edge_detail", "portrait_video"] },
  { order: 14, author: "author_b", label: "TEST 14 — Video then image", description: "Expected Home behavior: video poster is the cover; playback and item 2 remain unloaded.", visibility: "public", fixtures: ["landscape_video", "square_texture"] },
  { order: 15, author: "author_a", label: "TEST 15 — Repeated author", description: "Expected Home behavior: same author as TEST 01 reuses identity and avatar initials correctly.", visibility: "public", fixtures: ["low_contrast"] },
  { order: 16, author: "author_b", label: "TEST 16 — Reused visual source", description: "Expected Home behavior: TEST 01 source is processed as a distinct asset and cache key.", visibility: "public", fixtures: ["portrait_bright"] },
  { order: 17, author: "private_author", label: "TEST 17 — Circle-visible private author", description: "Expected Home behavior: media_viewer sees this Circle post through the explicit relationship.", visibility: "circle", fixtures: ["dark_low_light"] },
  { order: 18, author: "author_b", label: "TEST 18 — Large modern media", description: "Expected Home behavior: modern high-resolution source replaces an unsafe legacy-media fixture.", visibility: "public", fixtures: ["high_resolution"] },
  { order: 19, author: "author_a", label: "TEST 19 — Five-minute expiry", description: "Expected Home behavior: after the five-minute signed URL TTL, renew only this one cover.", visibility: "public", fixtures: ["edge_detail"] },
  { order: 20, author: "author_b", label: "TEST 20 — End of feed", description: "Expected Home behavior: this is the final visible post and the feed becomes caught up.", visibility: "public", fixtures: ["square_texture"] }
];

const BLOCKED_CASE = {
  order: 0,
  author: "blocked_author",
  label: "TEST BLOCKED — Authorization exclusion",
  description: "Expected Home behavior: valid ready media exists, but media_viewer must never receive the post or renew its media.",
  visibility: "public",
  fixtures: ["portrait_bright"]
};

const INVALID_CASE = {
  label: "TEST INVALID — Published without media",
  restaurantId: `${DATASET_ID}:invalid-no-media`
};

const AVATAR_CASES = [
  { author: "author_a", fixture: "portrait_bright" },
  { author: "author_b", fixture: "square_texture" },
  { author: "private_author", fixture: "dark_low_light" }
];

function modeFromArgs() {
  const selected = ["--dry-run", "--apply", "--cleanup", "--verify"].filter((flag) => process.argv.includes(flag));
  if (selected.length !== 1) throw new Error("Choose exactly one mode: --dry-run, --apply, --cleanup, or --verify");
  return selected[0].slice(2);
}

function argumentValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1]?.trim() ?? "";
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function isSupabaseProjectRef(value) {
  return /^[a-z0-9]{20}$/.test(value);
}

function assertOk(result, operation) {
  if (result.error) throw new Error(`${operation}_failed`);
  return result.data;
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function isLoopbackUrl(value) {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function localEnvironment() {
  const localJwt = (role) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "supabase-demo", role, exp: 1983812996 })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const signature = createHmac("sha256", "super-secret-jwt-token-with-at-least-32-characters-long")
      .update(unsigned)
      .digest("base64url");
    return `${unsigned}.${signature}`;
  };
  const apiUrl = "http://127.0.0.1:54321";
  const dbUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!isLoopbackUrl(apiUrl) || !isLoopbackUrl(dbUrl)) throw new Error("Refusing non-loopback dataset target");
  const linkedProjectRef = existsSync(LINKED_REF_PATH) ? (await readFile(LINKED_REF_PATH, "utf8")).trim() : null;
  return {
    anonKey: localJwt("anon"),
    apiUrl,
    dbUrl,
    linkedProjectRef,
    isHosted: false,
    serviceKey: localJwt("service_role"),
    target: "local Supabase CLI stack on loopback",
    hostedProjectDisposition: linkedProjectRef ? "unverified hosted project excluded; no reads or writes performed" : "no hosted link detected"
  };
}

async function datasetEnvironment(mode) {
  const hostedProjectRef = argumentValue("--hosted-project-ref");
  if (!hostedProjectRef) return { ...(await localEnvironment()), operationMode: mode };
  if (!isSupabaseProjectRef(hostedProjectRef)) throw new Error("hosted_fixture_project_ref_invalid");

  const linkedProjectRef = existsSync(LINKED_REF_PATH) ? (await readFile(LINKED_REF_PATH, "utf8")).trim() : "";
  if (linkedProjectRef !== hostedProjectRef) throw new Error("hosted_fixture_project_ref_mismatch");
  if (process.env.HOME_MEDIA_HOSTED_ENVIRONMENT !== HOSTED_ENVIRONMENT) {
    throw new Error("hosted_fixture_disposable_staging_assertion_required");
  }
  const expectedConfirmation = `${HOSTED_CONFIRMATION_PREFIX}:${hostedProjectRef}`;
  if (process.env.HOME_MEDIA_HOSTED_CONFIRMATION !== expectedConfirmation) {
    throw new Error("hosted_fixture_exact_confirmation_required");
  }

  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  let parsedUrl;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error("hosted_fixture_url_invalid");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== `${hostedProjectRef}.supabase.co` || parsedUrl.pathname !== "/") {
    throw new Error("hosted_fixture_url_project_mismatch");
  }
  if (anonKey.length < 20 || serviceKey.length < 20 || anonKey === serviceKey) {
    throw new Error("hosted_fixture_credentials_invalid");
  }

  return {
    anonKey,
    apiUrl,
    isHosted: true,
    linkedProjectRef,
    operationMode: mode,
    serviceKey,
    target: `explicit disposable hosted Supabase project ${hostedProjectRef}`,
    hostedProjectDisposition: "exact linked project ref, disposable-staging assertion, and operation confirmation verified"
  };
}

function clientsFor(env) {
  const auth = { auth: { autoRefreshToken: false, persistSession: false } };
  return {
    admin: createClient(env.apiUrl, env.serviceKey, auth),
    anon: createClient(env.apiUrl, env.anonKey, auth)
  };
}

async function allAuthUsers(admin) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("auth_user_audit_failed");
    users.push(...result.data.users);
    if (result.data.users.length < 1000) return users;
  }
  throw new Error("auth_user_audit_page_limit_exceeded");
}

function isOwnedAuthUser(user) {
  return user.user_metadata?.test_dataset === DATASET_ID;
}

function isAuditedLegacyReview(row) {
  const reviewerMatch = /^pda_[a-z0-9]{7}$/.test(row.reviewer_name ?? "");
  const idMatch = /^profile-device-place-(?:[0-9]|1[0-9]|2[0-3])$/.test(row.restaurant_id ?? "");
  const restaurantMatch = /^Profile Place (?:[1-9]|1[0-9]|2[0-4])$/.test(row.restaurant_name ?? "");
  const bodyMatch = /^Release profile post (?:[1-9]|1[0-9]|2[0-4])$/.test(row.body ?? "");
  return reviewerMatch && idMatch && restaurantMatch && bodyMatch && row.area === "Profile Performance Area";
}

async function existingInventory(admin) {
  const [users, profiles, reviews, assets, links, derivatives, jobs] = await Promise.all([
    allAuthUsers(admin),
    admin.from("profiles").select("id,username,bio,first_name,last_name"),
    admin.from("reviews").select("id,reviewer_name,restaurant_id,restaurant_name,area,body,visibility"),
    admin.from("media_assets").select("id,owner_id,owner_name,media_type,status,privacy_state"),
    admin.from("review_photos").select("id,review_id,media_asset_id"),
    admin.from("media_derivatives").select("id,asset_id,kind"),
    admin.from("media_processing_jobs").select("id,asset_id,status")
  ]);
  const profileRows = assertOk(profiles, "profiles_audit") ?? [];
  const reviewRows = assertOk(reviews, "reviews_audit") ?? [];
  const assetRows = assertOk(assets, "assets_audit") ?? [];
  const linkRows = assertOk(links, "links_audit") ?? [];
  const derivativeRows = assertOk(derivatives, "derivatives_audit") ?? [];
  const jobRows = assertOk(jobs, "jobs_audit") ?? [];
  const ownedUsers = users.filter(isOwnedAuthUser);
  const ownedIds = new Set(ownedUsers.map((user) => user.id));
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const phase1aUsers = users.filter((user) => {
    const profile = profileById.get(user.id);
    return Boolean(
      profile &&
      /^p1[omsb]_[a-z0-9]{8}$/.test(profile.username ?? "") &&
      ["owner", "member", "stranger", "blocked"].includes(profile.first_name) &&
      profile.last_name === "Phase1A" &&
      user.email === `${profile.username}@example.test`
    );
  });
  const visibility = { public: 0, circle: 0, private: 0 };
  for (const review of reviewRows) {
    if (review.visibility === "circle") visibility.circle += 1;
    else if (review.visibility === "me") visibility.private += 1;
    else visibility.public += 1;
  }
  const namingPatterns = [];
  if (profileRows.some((row) => /^load9_/.test(row.username))) namingPatterns.push("load9_*");
  if (profileRows.some((row) => /^dummy_/.test(row.username))) namingPatterns.push("dummy_*");
  if (profileRows.some((row) => /^media_test_/.test(row.username))) namingPatterns.push("media_test_*");
  if (reviewRows.some((row) => /^pda_/.test(row.reviewer_name))) namingPatterns.push("pda_* (mobile other-profile runtime fixture)");
  if (profileRows.some((row) => /^hmtv1_/.test(row.username))) namingPatterns.push("hmtv1_* (owned Home media fixture)");
  const legacyCandidates = reviewRows.filter(isAuditedLegacyReview);
  return {
    raw: { users, profileRows, reviewRows, assetRows, linkRows, derivativeRows, jobRows, ownedUsers, ownedIds, legacyCandidates, phase1aUsers },
    report: {
      authUsers: users.length,
      profiles: profileRows.length,
      reviews: reviewRows.length,
      visibility,
      mediaAssets: assetRows.length,
      reviewPhotoLinks: linkRows.length,
      imageAssets: assetRows.filter((row) => row.media_type === "image").length,
      videoAssets: assetRows.filter((row) => row.media_type === "video").length,
      readyStableAssets: assetRows.filter((row) => row.status === "ready" && row.privacy_state === "stable").length,
      pendingFailedAssets: assetRows.filter((row) => row.status !== "ready").length,
      derivatives: derivativeRows.length,
      mediaJobs: jobRows.length,
      syntheticUserNamingPatterns: namingPatterns,
      loadTestPostIdentifiers: legacyCandidates.length > 0 ? ["profile-device-place-0..23", "Profile Place 1..24"] : [],
      auditedLegacyTextOnlyReviews: legacyCandidates.length,
      auditedPhase1aRuntimeUsers: phase1aUsers.length,
      auditedPhase1aRuntimeReviews: reviewRows.filter((row) => phase1aUsers.some((user) => profileById.get(user.id)?.username === row.reviewer_name)).length,
      ownedDatasetUsers: ownedUsers.length,
      ownedDatasetProfiles: profileRows.filter((row) => ownedIds.has(row.id)).length,
      ownedDatasetReviews: reviewRows.filter((row) => String(row.restaurant_id ?? "").startsWith(`${DATASET_ID}:`)).length,
      ownedDatasetMediaAssets: assetRows.filter((row) => ownedIds.has(row.owner_id)).length
    }
  };
}

async function assertHostedApplyTargetEmpty(env, admin, inventory) {
  if (!env.isHosted) return;
  const report = inventory.report;
  if (
    report.authUsers !== 0 ||
    report.profiles !== 0 ||
    report.reviews !== 0 ||
    report.mediaAssets !== 0 ||
    report.reviewPhotoLinks !== 0 ||
    report.derivatives !== 0 ||
    report.mediaJobs !== 0
  ) throw new Error("hosted_fixture_target_not_empty");

  const buckets = await admin.storage.listBuckets();
  if (buckets.error) throw new Error("hosted_fixture_bucket_audit_failed");
  for (const bucket of buckets.data ?? []) {
    const listed = await admin.storage.from(bucket.name).list("", { limit: 1 });
    if (listed.error) throw new Error("hosted_fixture_storage_audit_failed");
    if ((listed.data ?? []).length !== 0) throw new Error("hosted_fixture_storage_not_empty");
  }
}

async function listUserStorageObjects(admin, userIds) {
  const objects = [];
  async function listAssetFolders(bucket, prefix) {
    const first = await admin.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (first.error) throw new Error("storage_fixture_scan_failed");
    for (const entry of first.data ?? []) {
      const assetPrefix = `${prefix}/${entry.name}`;
      const second = await admin.storage.from(bucket).list(assetPrefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
      if (second.error) throw new Error("storage_fixture_scan_failed");
      for (const file of second.data ?? []) {
        if (file.id) objects.push({ bucket, path: `${assetPrefix}/${file.name}` });
      }
    }
  }
  for (const userId of userIds) {
    await listAssetFolders("media-sources", `sources/post/${userId}`);
    await listAssetFolders("media-sources", `sources/avatar/${userId}`);
    await listAssetFolders("media-private", `private-posts/${userId}`);
    await listAssetFolders("media-public", `avatars/${userId}`);
  }
  return objects;
}

async function cleanupDataset(admin) {
  const users = (await allAuthUsers(admin)).filter(isOwnedAuthUser);
  const userIds = users.map((user) => user.id);
  const usernames = ROLE_DEFINITIONS.map((role) => role.username);
  const ownedReviews = assertOk(await admin.from("reviews").select("id").like("restaurant_id", `${DATASET_ID}:%`), "cleanup_reviews_lookup") ?? [];
  const assetsResult = userIds.length > 0
    ? await admin.from("media_assets").select("id,source_bucket_id,source_storage_path").in("owner_id", userIds)
    : { data: [], error: null };
  const assets = assertOk(assetsResult, "cleanup_assets_lookup") ?? [];
  const assetIds = assets.map((asset) => asset.id);
  const derivativesResult = assetIds.length > 0
    ? await admin.from("media_derivatives").select("bucket_id,storage_path").in("asset_id", assetIds)
    : { data: [], error: null };
  const derivatives = assertOk(derivativesResult, "cleanup_derivatives_lookup") ?? [];
  const scanned = userIds.length > 0 ? await listUserStorageObjects(admin, userIds) : [];
  const objectsByBucket = new Map();
  for (const object of [
    ...assets.map((asset) => ({ bucket: asset.source_bucket_id, path: asset.source_storage_path })),
    ...derivatives.map((row) => ({ bucket: row.bucket_id, path: row.storage_path })),
    ...scanned
  ]) {
    const values = objectsByBucket.get(object.bucket) ?? new Set();
    values.add(object.path);
    objectsByBucket.set(object.bucket, values);
  }
  for (const [bucket, paths] of objectsByBucket) {
    for (const batch of chunks(Array.from(paths))) {
      const removed = await admin.storage.from(bucket).remove(batch);
      if (removed.error) throw new Error("cleanup_storage_remove_failed");
    }
  }
  assertOk(await admin.from("reviews").delete().like("restaurant_id", `${DATASET_ID}:%`), "cleanup_reviews");
  assertOk(await admin.from("circle_memberships").delete().or(`user_name.in.(${usernames.join(",")}),member_name.in.(${usernames.join(",")})`), "cleanup_circle");
  assertOk(await admin.from("blocked_users").delete().or(`blocker_name.in.(${usernames.join(",")}),blocked_name.in.(${usernames.join(",")})`), "cleanup_blocks");
  if (assetIds.length > 0) assertOk(await admin.from("media_assets").delete().in("id", assetIds), "cleanup_media_assets");
  for (const user of users) {
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw new Error("cleanup_auth_user_failed");
  }
  const remaining = await existingInventory(admin);
  const remainingStorage = userIds.length > 0 ? await listUserStorageObjects(admin, userIds) : [];
  if (
    remaining.report.ownedDatasetUsers !== 0 ||
    remaining.report.ownedDatasetReviews !== 0 ||
    remaining.report.ownedDatasetMediaAssets !== 0 ||
    remainingStorage.length !== 0
  ) throw new Error("dataset_cleanup_residue_detected");
  return { users: users.length, reviews: ownedReviews.length, mediaAssets: assets.length, storageObjects: Array.from(objectsByBucket.values()).reduce((sum, paths) => sum + paths.size, 0) };
}

async function cleanupAuditedLegacy(admin, candidates) {
  if (candidates.length === 0) return 0;
  for (const batch of chunks(candidates.map((row) => row.id))) {
    assertOk(await admin.from("reviews").delete().in("id", batch), "legacy_review_cleanup");
  }
  return candidates.length;
}

async function cleanupAuditedPhase1a(admin, users) {
  if (users.length === 0) return { users: 0, reviews: 0, assets: 0, storageObjects: 0 };
  const userIds = users.map((user) => user.id);
  const profiles = assertOk(await admin.from("profiles").select("id,username,first_name,last_name").in("id", userIds), "phase1a_profiles_verify") ?? [];
  if (
    profiles.length !== users.length ||
    profiles.some((profile) =>
      !/^p1[omsb]_[a-z0-9]{8}$/.test(profile.username ?? "") ||
      !["owner", "member", "stranger", "blocked"].includes(profile.first_name) ||
      profile.last_name !== "Phase1A"
    )
  ) throw new Error("phase1a_cleanup_ownership_not_proven");
  const usernames = profiles.map((profile) => profile.username);
  const reviews = assertOk(await admin.from("reviews").select("id").in("reviewer_name", usernames), "phase1a_reviews_lookup") ?? [];
  const reviewIds = reviews.map((review) => review.id);
  const photos = reviewIds.length > 0
    ? assertOk(await admin.from("review_photos").select("storage_path").in("review_id", reviewIds), "phase1a_photos_lookup") ?? []
    : [];
  const assets = assertOk(await admin.from("media_assets").select("id,source_bucket_id,source_storage_path").in("owner_id", userIds), "phase1a_assets_lookup") ?? [];
  const assetIds = assets.map((asset) => asset.id);
  const derivatives = assetIds.length > 0
    ? assertOk(await admin.from("media_derivatives").select("bucket_id,storage_path").in("asset_id", assetIds), "phase1a_derivatives_lookup") ?? []
    : [];
  const scanned = await listUserStorageObjects(admin, userIds);
  const objectsByBucket = new Map();
  for (const object of [
    ...assets.map((asset) => ({ bucket: asset.source_bucket_id, path: asset.source_storage_path })),
    ...derivatives.map((row) => ({ bucket: row.bucket_id, path: row.storage_path })),
    ...photos.map((row) => ({ bucket: row.storage_path.startsWith("private-posts/") ? "media-private" : "review-photos", path: row.storage_path })),
    ...scanned
  ]) {
    const values = objectsByBucket.get(object.bucket) ?? new Set();
    values.add(object.path);
    objectsByBucket.set(object.bucket, values);
  }
  for (const [bucket, paths] of objectsByBucket) {
    for (const batch of chunks(Array.from(paths))) {
      const removed = await admin.storage.from(bucket).remove(batch);
      if (removed.error) throw new Error("phase1a_cleanup_storage_failed");
    }
  }
  if (reviewIds.length > 0) assertOk(await admin.from("reviews").delete().in("id", reviewIds), "phase1a_cleanup_reviews");
  assertOk(await admin.from("circle_memberships").delete().or(`user_name.in.(${usernames.join(",")}),member_name.in.(${usernames.join(",")})`), "phase1a_cleanup_circle");
  assertOk(await admin.from("blocked_users").delete().or(`blocker_name.in.(${usernames.join(",")}),blocked_name.in.(${usernames.join(",")})`), "phase1a_cleanup_blocks");
  if (assetIds.length > 0) assertOk(await admin.from("media_assets").delete().in("id", assetIds), "phase1a_cleanup_assets");
  for (const user of users) {
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw new Error("phase1a_cleanup_auth_user_failed");
  }
  const remainingUsers = await allAuthUsers(admin);
  if (remainingUsers.some((user) => userIds.includes(user.id)) || (await listUserStorageObjects(admin, userIds)).length > 0) {
    throw new Error("phase1a_cleanup_residue_detected");
  }
  return {
    users: users.length,
    reviews: reviews.length,
    assets: assets.length,
    storageObjects: Array.from(objectsByBucket.values()).reduce((sum, paths) => sum + paths.size, 0)
  };
}

async function transformImage(sourcePath, outputPath, options) {
  const oriented = sharp(sourcePath).rotate();
  const metadata = await oriented.clone().metadata();
  let pipeline = normalizeAlphaForJpeg(oriented, metadata).image
    .resize(options.width, options.height, { fit: "cover", position: "centre" });
  if (options.brightness || options.saturation) {
    pipeline = pipeline.modulate({ brightness: options.brightness ?? 1, saturation: options.saturation ?? 1 });
  }
  if (options.linear) pipeline = pipeline.linear(options.linear.multiplier, options.linear.offset);
  if (options.overlay) pipeline = pipeline.composite([{ input: options.overlay, top: 0, left: 0 }]);
  const buffer = await pipeline.jpeg({ quality: 91, mozjpeg: true }).toBuffer();
  await writeFile(outputPath, buffer);
  return { buffer, outputPath, width: options.width, height: options.height, durationMs: null, extension: "jpg", mediaType: "image", mimeType: "image/jpeg" };
}

async function transparentImage(sourcePath, outputPath, options) {
  const buffer = await sharp(sourcePath)
    .rotate()
    .resize(options.width, options.height, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: "contain",
      position: "centre"
    })
    .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
    .toBuffer();
  await writeFile(outputPath, buffer);
  return { buffer, outputPath, width: options.width, height: options.height, durationMs: null, extension: "png", mediaType: "image", mimeType: "image/png" };
}

async function generateFixtures() {
  await mkdir(FIXTURE_DIR, { recursive: true, mode: 0o700 });
  const dish = (name) => path.join(ROOT, `mobile/assets/categories/dishes/${name}.png`);
  const imageSpecs = [
    ["landscape_bright", "burger", { width: 1800, height: 1100 }],
    ["square_texture", "paneer", { width: 1400, height: 1400 }],
    ["high_resolution", "pizza", { width: 3200, height: 2400 }],
    ["dark_low_light", "mandi", { width: 1400, height: 1800, brightness: 0.32, saturation: 0.7 }],
    ["low_contrast", "milkshake", { width: 1400, height: 1400, saturation: 0.3, linear: { multiplier: 0.52, offset: 82 } }]
  ];
  const fixtureMap = new Map();
  fixtureMap.set("portrait_bright", await transparentImage(
    dish("biryani"),
    path.join(FIXTURE_DIR, "portrait_bright.png"),
    { width: 1200, height: 1600 }
  ));
  for (const [id, source, options] of imageSpecs) {
    fixtureMap.set(id, await transformImage(dish(source), path.join(FIXTURE_DIR, `${id}.jpg`), options));
  }
  const edgeOverlay = Buffer.from(`<svg width="1800" height="1100" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="1784" height="1084" rx="18" fill="none" stroke="#fff5d6" stroke-width="16"/><circle cx="35" cy="550" r="26" fill="#f97316"/><circle cx="1765" cy="550" r="26" fill="#22c55e"/><rect x="720" y="12" width="360" height="28" fill="#facc15"/><rect x="720" y="1060" width="360" height="28" fill="#38bdf8"/></svg>`);
  fixtureMap.set("edge_detail", await transformImage(dish("desserts"), path.join(FIXTURE_DIR, "edge_detail.jpg"), { width: 1800, height: 1100, overlay: edgeOverlay }));

  async function videoFixture(id, imageId, width, height) {
    const imagePath = fixtureMap.get(imageId)?.outputPath;
    if (!imagePath) throw new Error("fixture_video_source_missing");
    const outputPath = path.join(FIXTURE_DIR, `${id}.mp4`);
    const video = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-loop", "1", "-framerate", "24", "-i", imagePath,
      "-f", "lavfi", "-i", "sine=frequency=523.25:sample_rate=48000",
      "-t", "4", "-shortest",
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outputPath
    ], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (video.status !== 0) throw new Error("fixture_video_generation_failed");
    return { buffer: await readFile(outputPath), outputPath, width, height, durationMs: 4000, extension: "mp4", mediaType: "video", mimeType: "video/mp4" };
  }
  fixtureMap.set("portrait_video", await videoFixture("portrait_video", "portrait_bright", 720, 1280));
  fixtureMap.set("landscape_video", await videoFixture("landscape_video", "landscape_bright", 1280, 720));
  return fixtureMap;
}

async function ensureUsers(admin) {
  const existing = await allAuthUsers(admin);
  const byEmail = new Map(existing.map((user) => [user.email?.toLowerCase(), user]));
  const roles = {};
  for (const definition of ROLE_DEFINITIONS) {
    const collision = byEmail.get(definition.email);
    if (collision && !isOwnedAuthUser(collision)) throw new Error(`Refusing to reuse unowned Auth user for role ${definition.key}`);
    let user = collision;
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email: definition.email,
        email_confirm: true,
        password: `${randomBytes(30).toString("base64url")}Aa1!`,
        user_metadata: { test_dataset: DATASET_ID, test_role: definition.key }
      });
      if (created.error || !created.data.user) throw new Error("dataset_auth_user_create_failed");
      user = created.data.user;
    }
    assertOk(await admin.from("profiles").upsert({
      account_status: "active",
      account_type: definition.accountType,
      bio: `Synthetic non-production fixture: ${DATASET_ID}`,
      deletion_started_at: null,
      first_name: definition.firstName,
      id: user.id,
      last_name: definition.lastName,
      username: definition.username
    }, { onConflict: "id" }), "dataset_profile_upsert");
    roles[definition.key] = { ...definition, id: user.id };
  }
  assertOk(await admin.from("circle_memberships").insert([
    { user_name: roles.author_a.username, member_name: roles.viewer.username },
    { user_name: roles.author_b.username, member_name: roles.viewer.username },
    { user_name: roles.private_author.username, member_name: roles.viewer.username }
  ]), "dataset_circle_relationships");
  assertOk(await admin.from("blocked_users").insert({ blocker_name: roles.viewer.username, blocked_name: roles.blocked_author.username }), "dataset_block_relationship");
  return roles;
}

async function sessionFor(env, admin, role) {
  const link = await admin.auth.admin.generateLink({ email: role.email, type: "magiclink" });
  if (link.error || !link.data.properties?.hashed_token) throw new Error("dataset_local_session_link_failed");
  const client = createClient(env.apiUrl, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (verified.error || !verified.data.session) throw new Error("dataset_local_session_failed");
  return { client, token: verified.data.session.access_token, installId: randomUUID(), ip: "127.0.0.42" };
}

function startServer(env) {
  const output = [];
  const processHandle = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(SERVER_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      API_RATE_LIMIT_HMAC_SECRET: RATE_LIMIT_SECRET,
      API_TRUSTED_PROXY_HOPS: "1",
      MEDIA_WORKER_CONCURRENCY: "4",
      MEDIA_WORKER_SECRET: WORKER_SECRET,
      MEDIA_WORKER_TEMP_DIR: path.join(OUTPUT_DIR, "worker-temp"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.apiUrl,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const capture = (chunk) => {
    const sanitized = String(chunk)
      .replaceAll(env.anonKey, "[anon-key-redacted]")
      .replaceAll(env.serviceKey, "[service-key-redacted]")
      .replaceAll(WORKER_SECRET, "[worker-secret-redacted]")
      .replace(/[A-Za-z0-9_-]{80,}/g, "[token-redacted]");
    output.push(sanitized);
    if (output.length > 200) output.shift();
  };
  processHandle.stdout.on("data", capture);
  processHandle.stderr.on("data", capture);
  return { processHandle, output };
}

async function waitForServer(server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.processHandle.exitCode !== null) throw new Error("dataset_next_server_exited");
    try {
      const response = await fetch(`${SERVER_URL}/api/media/upload-intent`, { method: "OPTIONS" });
      if (response.status === 204) return;
    } catch {
      // Development server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("dataset_next_server_timeout");
}

async function stopServer(server) {
  if (!server || server.processHandle.exitCode !== null) return;
  server.processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.processHandle.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (server.processHandle.exitCode === null) server.processHandle.kill("SIGKILL");
}

function identifierHash(kind, value) {
  return createHmac("sha256", RATE_LIMIT_SECRET).update(`${kind}:${value}`).digest("hex");
}

async function clearOwnedRateLimit(admin, session, userId, endpoint) {
  const hashes = [
    identifierHash("user", userId),
    identifierHash("install", session.installId),
    identifierHash("ip", session.ip)
  ];
  assertOk(await admin.from("api_rate_limit_buckets").delete().eq("endpoint", endpoint).in("identifier_hash", hashes), "dataset_rate_limit_cleanup");
}

async function routeJson(pathname, session, body, method = "POST") {
  const response = await fetch(`${SERVER_URL}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      "X-FoodReview-Install-Id": session.installId,
      "X-Forwarded-For": session.ip
    },
    method
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

async function createMediaAsset({ admin, fixture, fixtureId, role, session, surface = "post", visibility }) {
  await clearOwnedRateLimit(admin, session, role.id, "media.intent");
  const intent = await routeJson("/api/media/upload-intent", session, {
    cropRect: { height: 1, targetAspect: surface === "avatar" ? 1 : 0.8, width: 1, x: 0, y: 0 },
    durationMs: fixture.durationMs,
    fileName: `${fixtureId}.${fixture.extension}`,
    fileSizeBytes: fixture.buffer.byteLength,
    height: fixture.height,
    intendedVisibility: visibility,
    mediaType: fixture.mediaType,
    mimeType: fixture.mimeType,
    surface,
    width: fixture.width
  });
  if (!intent.response.ok || !intent.json?.assetId || !intent.json?.uploadPath) throw new Error("dataset_upload_intent_failed");
  const upload = await session.client.storage.from(intent.json.uploadBucket).upload(intent.json.uploadPath, fixture.buffer, {
    contentType: fixture.mimeType,
    upsert: false
  });
  if (upload.error) throw new Error("dataset_source_upload_failed");
  await clearOwnedRateLimit(admin, session, role.id, "media.intent");
  const finalized = await routeJson("/api/media/finalize-upload", session, { assetId: intent.json.assetId, uploadPath: intent.json.uploadPath });
  if (!finalized.response.ok || finalized.json?.status !== "uploaded") throw new Error("dataset_finalize_failed");
  const moderated = await admin.rpc("apply_media_moderation_action", {
    p_action: "approved",
    p_asset_id: intent.json.assetId,
    p_operator_hash: OPERATOR_HASH,
    p_reason_code: "home_media_test_fixture"
  });
  if (moderated.error || moderated.data !== true) throw new Error("dataset_moderation_approval_failed");
  return { assetId: intent.json.assetId, fixtureId, mediaType: fixture.mediaType, surface };
}

async function processAllMedia(admin, expectedAssetIds) {
  // The local worker may be configured for four concurrent claims. Twenty
  // bounded passes leave headroom for all 42 post/avatar fixtures plus retries.
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const current = assertOk(await admin.from("media_assets").select("id,status").in("id", expectedAssetIds), "dataset_processing_poll") ?? [];
    const unsettled = current.filter((row) => !["ready", "failed", "rejected"].includes(row.status));
    if (unsettled.length === 0) break;
    const response = await fetch(`${SERVER_URL}/api/internal/media/process`, {
      body: JSON.stringify({ limit: 25, workerId: `home-media-test-${iteration}` }),
      headers: { Authorization: `Bearer ${WORKER_SECRET}`, "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error("dataset_media_worker_failed");
  }
  const settled = assertOk(await admin.from("media_assets").select("id,status,failure_code").in("id", expectedAssetIds), "dataset_processing_settle") ?? [];
  if (settled.length !== expectedAssetIds.length || settled.some((row) => row.status !== "ready")) {
    throw new Error("dataset_media_not_ready");
  }
}

async function createReviewThroughContract({ admin, caseDefinition, media, role, session }) {
  if (media.length === 0) {
    const inserted = await admin.from("reviews").insert({
      area: "Home Media Test Lab",
      body: `${caseDefinition.description} [${DATASET_ID}]`,
      items: [{ name: "Chicken Biryani", rating: 4 }],
      restaurant_id: `${DATASET_ID}:${String(caseDefinition.order).padStart(2, "0")}`,
      restaurant_name: caseDefinition.label,
      reviewer_name: role.username,
      status: "active",
      tags: ["HomeMediaTest"],
      visibility: caseDefinition.visibility
    }).select("id").single();
    return assertOk(inserted, "dataset_no_media_review_insert").id;
  }
  // The production review mutation intentionally caps an interactive post at
  // four media items. The first four therefore use that contract unchanged.
  // Controlled 5/10-item pagination fixtures attach only already-ready,
  // owner-matched private assets below; no URL or ready state is synthesized.
  const contractMedia = media.slice(0, 4);
  const created = await routeJson("/api/reviews", session, {
    area: "Home Media Test Lab",
    body: `${caseDefinition.description} [${DATASET_ID}]`,
    items: [{ name: "Chicken Biryani", rating: 4 }],
    media: contractMedia.map((item) => ({
      assetId: item.assetId,
      durationSeconds: item.mediaType === "video" ? 4 : undefined,
      mediaType: item.mediaType
    })),
    restaurantId: `${DATASET_ID}:${caseDefinition.order === 0 ? "blocked" : String(caseDefinition.order).padStart(2, "0")}`,
    restaurantName: caseDefinition.label,
    tags: ["HomeMediaTest"],
    visibility: caseDefinition.visibility
  });
  if (!created.response.ok || !created.json?.id) throw new Error("dataset_review_contract_failed");
  const additionalMedia = media.slice(4);
  if (additionalMedia.length > 0) {
    const additionalIds = additionalMedia.map((item) => item.assetId);
    const assetRows = assertOk(await admin.from("media_assets")
      .select("id,owner_id,owner_name,surface,status,privacy_state,moderation_status,access_class,consumed_at,media_type")
      .in("id", additionalIds), "dataset_additional_assets_verify") ?? [];
    const expectedAccessClass = caseDefinition.visibility === "circle" ? "circle_post" : caseDefinition.visibility === "me" ? "private_post" : "public_post";
    if (
      assetRows.length !== additionalIds.length ||
      assetRows.some((asset) =>
        asset.owner_id !== role.id || asset.owner_name !== role.username || asset.surface !== "post" ||
        asset.status !== "ready" || asset.privacy_state !== "stable" || asset.moderation_status !== "approved" ||
        asset.access_class !== expectedAccessClass || asset.consumed_at !== null
      )
    ) throw new Error("dataset_additional_asset_not_attachable");
    const derivativeRows = assertOk(await admin.from("media_derivatives")
      .select("asset_id,bucket_id,storage_path,public_url,mime_type,width,height,duration_ms,file_size_bytes")
      .in("asset_id", additionalIds)
      .eq("kind", "canonical"), "dataset_additional_derivatives_verify") ?? [];
    const canonicalByAsset = new Map(derivativeRows.map((row) => [row.asset_id, row]));
    if (
      derivativeRows.length !== additionalIds.length ||
      derivativeRows.some((row) => row.bucket_id !== "media-private" || row.public_url !== null || row.file_size_bytes <= 0)
    ) throw new Error("dataset_additional_derivative_not_private");
    const rows = additionalMedia.map((item, index) => {
      const canonical = canonicalByAsset.get(item.assetId);
      if (!canonical) throw new Error("dataset_additional_canonical_missing");
      return {
        review_id: created.json.id,
        storage_path: canonical.storage_path,
        public_url: null,
        media_type: item.mediaType,
        width: canonical.width,
        height: canonical.height,
        size_bytes: canonical.file_size_bytes,
        media_asset_id: item.assetId,
        position: index + 4
      };
    });
    assertOk(await admin.from("review_photos").insert(rows), "dataset_additional_media_link");
    assertOk(await admin.from("media_assets").update({ consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", additionalIds), "dataset_additional_media_consume");
  }
  return created.json.id;
}

async function seedDataset(env, admin, fixtures) {
  const roles = await ensureUsers(admin);
  const sessions = {};
  for (const key of ROLE_DEFINITIONS.map((definition) => definition.key)) {
    sessions[key] = await sessionFor(env, admin, roles[key]);
  }
  const cases = [...CASES, BLOCKED_CASE];
  const assetsByCase = new Map();
  const allAssets = [];
  for (const caseDefinition of cases) {
    const media = [];
    for (const fixtureId of caseDefinition.fixtures) {
      const fixture = fixtures.get(fixtureId);
      if (!fixture) throw new Error("dataset_fixture_missing");
      const asset = await createMediaAsset({
        admin,
        fixture,
        fixtureId,
        role: roles[caseDefinition.author],
        session: sessions[caseDefinition.author],
        visibility: caseDefinition.visibility
      });
      media.push(asset);
      allAssets.push(asset);
    }
    assetsByCase.set(caseDefinition.order === 0 ? "blocked" : caseDefinition.order, media);
  }
  const avatarAssets = new Map();
  for (const avatarCase of AVATAR_CASES) {
    const fixture = fixtures.get(avatarCase.fixture);
    if (!fixture) throw new Error("dataset_avatar_fixture_missing");
    const asset = await createMediaAsset({
      admin,
      fixture,
      fixtureId: `avatar_${avatarCase.fixture}`,
      role: roles[avatarCase.author],
      session: sessions[avatarCase.author],
      surface: "avatar",
      visibility: "public"
    });
    avatarAssets.set(avatarCase.author, asset);
    allAssets.push(asset);
  }
  await processAllMedia(admin, allAssets.map((asset) => asset.assetId));

  for (const [author, asset] of avatarAssets) {
    assertOk(await admin.from("profiles").update({ avatar_media_asset_id: asset.assetId }).eq("id", roles[author].id), "dataset_avatar_profile_link");
    assertOk(await admin.from("media_assets").update({ consumed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", asset.assetId), "dataset_avatar_consume");
  }

  const baseTime = Date.now() + 120_000;
  const posts = [];
  for (const caseDefinition of cases) {
    const caseKey = caseDefinition.order === 0 ? "blocked" : caseDefinition.order;
    const reviewId = await createReviewThroughContract({
      admin,
      caseDefinition,
      media: assetsByCase.get(caseKey),
      role: roles[caseDefinition.author],
      session: sessions[caseDefinition.author]
    });
    const createdAt = new Date(baseTime - (caseDefinition.order === 0 ? 0 : caseDefinition.order * 60_000)).toISOString();
    assertOk(await admin.from("reviews").update({ created_at: createdAt }).eq("id", reviewId), "dataset_review_timestamp_update");
    posts.push({ caseKey, reviewId, createdAt });
  }
  const invalidCreatedAt = new Date(baseTime - 30_000).toISOString();
  const invalidReview = assertOk(await admin.from("reviews").insert({
    area: "Home Media Test Lab",
    body: `Hidden repair-only invalid fixture [${DATASET_ID}]`,
    created_at: invalidCreatedAt,
    items: [{ name: "Chicken Biryani", rating: 4 }],
    requires_ready_media: false,
    restaurant_id: INVALID_CASE.restaurantId,
    restaurant_name: INVALID_CASE.label,
    reviewer_name: roles.author_a.username,
    status: "active",
    tags: ["HomeMediaRepairTest"],
    visibility: "public"
  }).select("id").single(), "dataset_invalid_review_insert");
  return { roles, sessions, posts, assets: allAssets, invalidReviewId: invalidReview.id };
}

async function signedViewerFetch(pathname, session, body) {
  return fetch(`${SERVER_URL}${pathname}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      "X-FoodReview-Install-Id": session.installId,
      "X-Forwarded-For": session.ip
    },
    method: body ? "POST" : "GET"
  });
}

async function verifyDataset(env, admin, existingServer = null) {
  const users = (await allAuthUsers(admin)).filter(isOwnedAuthUser);
  if (users.length !== ROLE_DEFINITIONS.length) throw new Error("verify_auth_user_count_failed");
  const userByRole = new Map(users.map((user) => [user.user_metadata?.test_role, user]));
  const roles = Object.fromEntries(ROLE_DEFINITIONS.map((definition) => {
    const user = userByRole.get(definition.key);
    if (!user) throw new Error("verify_auth_role_missing");
    return [definition.key, { ...definition, id: user.id }];
  }));
  const userIds = users.map((user) => user.id);
  const reviews = assertOk(await admin.from("reviews").select("id,reviewer_name,restaurant_id,restaurant_name,visibility,created_at").like("restaurant_id", `${DATASET_ID}:%`).order("created_at", { ascending: false }), "verify_reviews") ?? [];
  const visibleReviews = reviews.filter((row) => ![`${DATASET_ID}:blocked`, INVALID_CASE.restaurantId].includes(row.restaurant_id));
  const blockedReview = reviews.find((row) => row.restaurant_id === `${DATASET_ID}:blocked`);
  const invalidReview = reviews.find((row) => row.restaurant_id === INVALID_CASE.restaurantId);
  if (visibleReviews.length !== 20 || !blockedReview || !invalidReview || reviews.length !== 22) throw new Error("verify_post_count_failed");
  const links = assertOk(await admin.from("review_photos").select("review_id,media_asset_id,media_type,position").in("review_id", reviews.map((row) => row.id)).order("position"), "verify_media_links") ?? [];
  const assets = assertOk(await admin.from("media_assets").select("id,owner_id,owner_name,surface,media_type,status,privacy_state,moderation_status,consumed_at,source_storage_path,access_class").in("owner_id", userIds), "verify_assets") ?? [];
  const assetIds = assets.map((row) => row.id);
  const derivatives = assertOk(await admin.from("media_derivatives").select("asset_id,kind,bucket_id,storage_path,public_url,mime_type,width,height,duration_ms,file_size_bytes,blurhash,content_revision,content_sha256,processing_version").in("asset_id", assetIds), "verify_derivatives") ?? [];
  const jobs = assertOk(await admin.from("media_processing_jobs").select("asset_id,status,failure_code").in("asset_id", assetIds), "verify_jobs") ?? [];
  if (assets.length !== 42 || links.length !== 39) throw new Error("verify_asset_or_link_count_failed");
  if (assets.some((row) => row.status !== "ready" || row.privacy_state !== "stable" || row.moderation_status !== "approved" || !row.consumed_at)) throw new Error("verify_ready_stable_failed");
  if (jobs.length !== 42 || jobs.some((row) => row.status !== "succeeded")) throw new Error("verify_processing_jobs_failed");

  const derivativesByAsset = new Map();
  for (const derivative of derivatives) {
    const values = derivativesByAsset.get(derivative.asset_id) ?? [];
    values.push(derivative);
    derivativesByAsset.set(derivative.asset_id, values);
  }
  for (const asset of assets) {
    const rows = derivativesByAsset.get(asset.id) ?? [];
    if (asset.surface === "avatar") {
      const byKind = new Map(rows.map((row) => [row.kind, row]));
      const canonical = byKind.get("canonical");
      const thumbnail = byKind.get("thumbnail");
      if (
        rows.length !== 2 || !canonical || !thumbnail ||
        canonical.width !== 512 || canonical.height !== 512 ||
        thumbnail.width !== 128 || thumbnail.height !== 128 ||
        rows.some((row) => row.bucket_id !== "media-public" || !row.public_url || row.file_size_bytes <= 0)
      ) throw new Error("verify_avatar_derivative_contract_failed");
      if (rows.some((row) => row.content_revision !== 1 || row.processing_version !== MEDIA_IMAGE_PROCESSING_VERSION || !/^[0-9a-f]{64}$/.test(row.content_sha256 ?? ""))) {
        throw new Error("verify_avatar_processing_metadata_failed");
      }
    } else if (asset.media_type === "image") {
      if (rows.some((row) => row.bucket_id !== "media-private" || row.public_url !== null || row.file_size_bytes <= 0)) throw new Error("verify_private_derivative_failed");
      if (rows.some((row) => row.content_revision !== 1 || row.processing_version !== MEDIA_IMAGE_PROCESSING_VERSION || !/^[0-9a-f]{64}$/.test(row.content_sha256 ?? ""))) {
        throw new Error("verify_image_processing_metadata_failed");
      }
      const byKind = new Map(rows.map((row) => [row.kind, row]));
      const expected = { thumbnail: [360, 450], feed: [720, 900], canonical: [1080, 1350] };
      for (const [kind, dimensions] of Object.entries(expected)) {
        const row = byKind.get(kind);
        if (!row || row.width !== dimensions[0] || row.height !== dimensions[1] || !row.blurhash) throw new Error("verify_image_derivative_contract_failed");
      }
      if (rows.length !== 3) throw new Error("verify_image_derivative_count_failed");
    } else {
      if (rows.some((row) => row.bucket_id !== "media-private" || row.public_url !== null || row.file_size_bytes <= 0)) throw new Error("verify_private_derivative_failed");
      const byKind = new Map(rows.map((row) => [row.kind, row]));
      const canonical = byKind.get("canonical");
      const poster = byKind.get("poster");
      if (rows.length !== 2 || !canonical || !poster || canonical.width !== 1080 || canonical.height !== 1350 || !poster.width || !poster.height || !poster.blurhash) {
        throw new Error("verify_video_derivative_contract_failed");
      }
    }
  }
  if (derivatives.length !== 119) throw new Error("verify_derivative_total_failed");

  const storageObjects = await listUserStorageObjects(admin, userIds);
  const expectedStorage = new Set([
    ...assets.map((row) => `media-sources:${row.source_storage_path}`),
    ...derivatives.map((row) => `${row.bucket_id}:${row.storage_path}`)
  ]);
  const actualStorage = new Set(storageObjects.map((row) => `${row.bucket}:${row.path}`));
  const storageOrphans = Array.from(actualStorage).filter((key) => !expectedStorage.has(key));
  const missingStorage = Array.from(expectedStorage).filter((key) => !actualStorage.has(key));
  if (storageOrphans.length !== 0 || missingStorage.length !== 0 || actualStorage.size !== 161) throw new Error("verify_storage_reconciliation_failed");

  let server = existingServer;
  let ownsServer = false;
  if (!server) {
    server = startServer(env);
    ownsServer = true;
    await waitForServer(server);
  }
  try {
    const viewerSession = await sessionFor(env, admin, roles.viewer);
    const firstResponse = await signedViewerFetch("/api/feed/circle?limit=10", viewerSession);
    const first = await firstResponse.json().catch(() => null);
    if (!firstResponse.ok || !Array.isArray(first?.posts) || first.posts.length !== 10 || !first.nextCursor) throw new Error("verify_first_page_failed");
    const secondResponse = await signedViewerFetch(`/api/feed/circle?limit=10&cursor=${encodeURIComponent(first.nextCursor)}`, viewerSession);
    const second = await secondResponse.json().catch(() => null);
    // The current Circle API serializes a terminal null cursor as an empty
    // string. Both are terminal/falsy; a non-empty cursor would mean page 3.
    if (!secondResponse.ok || !Array.isArray(second?.posts) || second.posts.length !== 10 || Boolean(second.nextCursor)) throw new Error("verify_second_page_failed");
    const delivered = [...first.posts, ...second.posts];
    const expectedLabels = CASES.map((item) => item.label);
    if (delivered.map((post) => post.restaurantName).join("\n") !== expectedLabels.join("\n")) throw new Error("verify_feed_order_failed");
    if (
      new Set(delivered.map((post) => post.id)).size !== 20 ||
      delivered.some((post) => post.id === blockedReview.id || post.id === invalidReview.id)
    ) throw new Error("verify_feed_distribution_failed");
    if (JSON.stringify({ first, second }).includes("sources/post/")) throw new Error("verify_source_path_leak_failed");

    const linksByReview = new Map();
    for (const link of links) {
      const values = linksByReview.get(link.review_id) ?? [];
      values.push(link);
      linksByReview.set(link.review_id, values);
    }
    for (const values of linksByReview.values()) values.sort((a, b) => a.position - b.position);
    const caseByLabel = new Map(CASES.map((item) => [item.label, item]));
    for (const post of delivered) {
      const definition = caseByLabel.get(post.restaurantName);
      const expectedCount = definition.fixtures.length;
      if (post.mediaCount !== expectedCount) throw new Error("verify_media_count_failed");
      if (expectedCount > 0) {
        const firstLink = (linksByReview.get(post.id) ?? [])[0];
        if (!post.coverMedia || post.coverMedia.mediaAssetId !== firstLink?.media_asset_id) throw new Error("verify_cover_position_failed");
        if (post.coverMedia.mediaType === "video") {
          if (!post.coverMedia.posterUrl || post.coverMedia.playbackUrl) throw new Error("verify_video_cover_delivery_failed");
        } else if (!post.coverMedia.feedUrl || post.coverMedia.playbackUrl || post.coverMedia.posterUrl) {
          throw new Error("verify_image_cover_delivery_failed");
        }
      }
    }

    for (const post of delivered.filter((item) => item.mediaCount > 1)) {
      const mediaResponse = await signedViewerFetch(`/api/posts/${post.id}/media`, viewerSession);
      const mediaPage = await mediaResponse.json().catch(() => null);
      if (!mediaResponse.ok || !Array.isArray(mediaPage?.items) || mediaPage.items.length !== post.mediaCount) {
        throw new Error("verify_carousel_metadata_failed");
      }
      if (
        mediaPage.items.some((item, index) => item.position !== index || item.playbackUrl || item.storagePath || item.originalUrl) ||
        mediaPage.items.some((item) => item.mediaType === "video" ? !item.posterUrl || item.feedUrl : !item.feedUrl || item.posterUrl)
      ) throw new Error("verify_carousel_delivery_contract_failed");
    }

    const authorAPosts = delivered.filter((post) => post.reviewerUsername === roles.author_a.username);
    const authorBPost = delivered.find((post) => post.reviewerUsername === roles.author_b.username);
    const privateAuthorPost = delivered.find((post) => post.reviewerUsername === roles.private_author.username);
    const noAvatarPost = delivered.find((post) => post.reviewerUsername === roles.no_avatar_author.username);
    if (
      authorAPosts.length < 2 || !authorAPosts[0].avatarMediaAssetId || !authorAPosts[0].avatarThumbnailUrl ||
      authorAPosts.some((post) => post.avatarMediaAssetId !== authorAPosts[0].avatarMediaAssetId) ||
      !authorBPost?.avatarMediaAssetId || !authorBPost.avatarThumbnailUrl ||
      !privateAuthorPost?.avatarMediaAssetId || !privateAuthorPost.avatarThumbnailUrl ||
      !noAvatarPost || noAvatarPost.avatarMediaAssetId !== null || noAvatarPost.avatarThumbnailUrl !== null
    ) throw new Error("verify_avatar_delivery_contract_failed");

    const integrity = assertOk(await admin.rpc("home_media_integrity_report_v1"), "verify_home_media_integrity_report");
    if (
      !Array.isArray(integrity?.publishedWithZeroLinks) ||
      !integrity.publishedWithZeroLinks.includes(invalidReview.id) ||
      !Array.isArray(integrity?.publishedWithZeroReadyMedia) ||
      !integrity.publishedWithZeroReadyMedia.includes(invalidReview.id)
    ) throw new Error("verify_invalid_media_report_failed");

    const expiryPost = delivered.find((post) => post.restaurantName === CASES[18].label);
    const authorizedRenewalResponse = await signedViewerFetch("/api/media/renew", viewerSession, { derivative: "feed", mediaAssetId: expiryPost.coverMedia.mediaAssetId });
    const authorizedRenewal = await authorizedRenewalResponse.json().catch(() => null);
    if (!authorizedRenewalResponse.ok || !authorizedRenewal?.url || authorizedRenewal.mediaAssetId !== expiryPost.coverMedia.mediaAssetId) throw new Error("verify_authorized_renewal_failed");
    const blockedLink = (linksByReview.get(blockedReview.id) ?? [])[0];
    const blockedRenewalResponse = await signedViewerFetch("/api/media/renew", viewerSession, { derivative: "feed", mediaAssetId: blockedLink.media_asset_id });
    if (blockedRenewalResponse.status !== 404) throw new Error("verify_blocked_renewal_failed");

    const postRows = delivered.map((post, index) => ({
      postId: post.id,
      label: post.restaurantName,
      feedPosition: index + 1,
      visibility: post.visibility,
      author: post.reviewerUsername,
      mediaCount: post.mediaCount,
      coverMediaType: post.coverMedia?.mediaType ?? null,
      feedUrlPresent: Boolean(post.coverMedia?.feedUrl),
      posterUrlPresent: Boolean(post.coverMedia?.posterUrl),
      playbackUrlPresent: Boolean(post.coverMedia?.playbackUrl),
      width: post.coverMedia?.width ?? null,
      height: post.coverMedia?.height ?? null,
      expiresAt: post.coverMedia?.expiresAt ?? null,
      appearsForViewer: true
    }));
    postRows.push({
      postId: blockedReview.id,
      label: BLOCKED_CASE.label,
      feedPosition: null,
      visibility: blockedReview.visibility,
      author: blockedReview.reviewer_name,
      mediaCount: 1,
      coverMediaType: "image",
      feedUrlPresent: false,
      posterUrlPresent: false,
      playbackUrlPresent: false,
      width: null,
      height: null,
      expiresAt: null,
      appearsForViewer: false
    });
    const imageAssets = assets.filter((row) => row.media_type === "image").length;
    const videoAssets = assets.filter((row) => row.media_type === "video").length;
    return {
      datasetId: DATASET_ID,
      environment: {
        target: env.target,
        apiOrigin: new URL(env.apiUrl).origin,
        linkedProjectRef: env.linkedProjectRef,
        hostedProjectDisposition: env.hostedProjectDisposition,
        productionTouched: env.isHosted && env.operationMode === "apply"
      },
      accounts: ROLE_DEFINITIONS.map((role) => ({ role: role.key, email: role.email, username: role.username, purpose: role.key.replaceAll("_", " ") })),
      database: {
        visiblePosts: visibleReviews.length,
        hiddenBlockedPosts: 1,
        hiddenInvalidPosts: 1,
        imageAssets,
        videoAssets,
        readyStableAssets: assets.length,
        avatarAssets: assets.filter((row) => row.surface === "avatar").length,
        failedOrPendingAssets: 0,
        mediaLinks: links.length,
        derivatives: derivatives.length,
        processingSucceeded: jobs.length,
        processingFailed: 0,
        storageObjects: actualStorage.size,
        storageOrphans: storageOrphans.length,
        missingStorageObjects: missingStorage.length
      },
      feed: {
        firstPageCount: first.posts.length,
        secondPageCount: second.posts.length,
        firstPageHasCursor: Boolean(first.nextCursor),
        secondPageHasCursor: Boolean(second.nextCursor),
        duplicatePosts: 0,
        missingVisiblePosts: 0,
        blockedPostVisible: false,
        invalidPostVisible: false,
        originalSourcePathReturned: false,
        posts: postRows
      },
      authorization: {
        circlePostVisible: delivered.some((post) => post.restaurantName === CASES[16].label),
        blockedPostHidden: true,
        blockedPrivateStorageRenewalStatus: blockedRenewalResponse.status,
        authorizedRenewalSucceeded: true,
        initialVideoPlaybackUrlsPresent: delivered.filter((post) => post.coverMedia?.mediaType === "video").some((post) => Boolean(post.coverMedia?.playbackUrl))
      },
      processing: {
        realUploadIntentFinalizeWorkerFlow: true,
        reviewLinking: "normal review contract for items 1-4; guarded ready/private owner-matched linking for test-only items 5-10 because the production mutation cap remains 4",
        imageDerivativeDimensions: { thumbnail: "360x450", feed: "720x900", canonical: "1080x1350" },
        imageAssetsMissingFeedDerivative: 0,
        videoAssetsMissingPoster: 0,
        allPrivateDerivativesHaveNoPermanentPublicUrl: true,
        homeAspectRatio: "4:5"
      },
      fixtureManifest: path.relative(ROOT, MANIFEST_PATH),
      reportPath: path.relative(ROOT, REPORT_PATH)
    };
  } finally {
    if (ownsServer) await stopServer(server);
  }
}

function printHumanSummary(title, report) {
  console.log(`\n${title}`);
  console.log(`Dataset: ${DATASET_ID}`);
  console.log(`Target: ${report.environment?.target ?? "verified local Supabase CLI stack"}`);
  if (report.database) {
    console.log(`Posts: ${report.database.visiblePosts} visible + ${report.database.hiddenBlockedPosts} blocked hidden + ${report.database.hiddenInvalidPosts} invalid hidden`);
    console.log(`Assets: ${report.database.imageAssets} images + ${report.database.videoAssets} videos; ${report.database.failedOrPendingAssets} pending/failed`);
    console.log(`Derivatives: ${report.database.derivatives}; Storage objects: ${report.database.storageObjects}; Orphans: ${report.database.storageOrphans}`);
    console.log(`Feed pages: ${report.feed.firstPageCount} + ${report.feed.secondPageCount}; final cursor present: ${report.feed.secondPageHasCursor}`);
  }
  console.log(`SUMMARY_JSON ${JSON.stringify(report)}`);
}

async function main() {
  const mode = modeFromArgs();
  const env = await datasetEnvironment(mode);
  const { admin } = clientsFor(env);
  const inventory = await existingInventory(admin);
  const safety = {
    datasetId: DATASET_ID,
    environment: {
      target: env.target,
      apiOrigin: new URL(env.apiUrl).origin,
      linkedProjectRef: env.linkedProjectRef,
      hostedProjectDisposition: env.hostedProjectDisposition,
      productionTouched: env.isHosted && ["apply", "cleanup"].includes(mode)
    },
    existing: inventory.report,
    cleanupDryRun: {
      ownedDatasetUsers: inventory.report.ownedDatasetUsers,
      ownedDatasetReviews: inventory.report.ownedDatasetReviews,
      ownedDatasetMediaAssets: inventory.report.ownedDatasetMediaAssets,
      auditedLegacyTextOnlyReviews: inventory.report.auditedLegacyTextOnlyReviews,
      auditedPhase1aRuntimeUsers: inventory.report.auditedPhase1aRuntimeUsers,
      auditedPhase1aRuntimeReviews: inventory.report.auditedPhase1aRuntimeReviews,
      auditedLegacyRule: "pda_<7 chars> + profile-device-place-0..23 + exact Profile Place/body/area fixture shape",
      preservesUnownedAuthUsers: true,
      preservesReferenceDataAndMigrations: true
    }
  };

  if (mode === "dry-run") {
    printHumanSummary("Home media dataset dry run (no data changed)", safety);
    return;
  }
  if (mode === "cleanup") {
    const removed = await cleanupDataset(admin);
    const report = { ...safety, cleanupApplied: removed, auditedLegacyTextOnlyReviewsRemoved: 0 };
    printHumanSummary("Home media dataset cleanup complete", report);
    return;
  }
  if (mode === "verify") {
    const report = await verifyDataset(env, admin);
    await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    printHumanSummary("Home media dataset verification passed", report);
    return;
  }

  await assertHostedApplyTargetEmpty(env, admin, inventory);
  await cleanupDataset(admin);
  const legacyRemoved = await cleanupAuditedLegacy(admin, inventory.raw.legacyCandidates);
  const phase1aRemoved = await cleanupAuditedPhase1a(admin, inventory.raw.phase1aUsers);
  const fixtures = await generateFixtures();
  const server = startServer(env);
  try {
    await waitForServer(server);
    await seedDataset(env, admin, fixtures);
    const report = await verifyDataset(env, admin, server);
    report.cleanup = { auditedLegacyTextOnlyReviewsRemoved: legacyRemoved, auditedPhase1aRuntimeRemoved: phase1aRemoved, priorOwnedDatasetRemovedBeforeSeed: true };
    await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    printHumanSummary("Home media dataset apply and verification passed", report);
  } catch (error) {
    await cleanupDataset(admin).catch(() => undefined);
    const safeTail = server.output.join("").slice(-3000).replace(/https?:\/\/[^\s\"]+/g, "[url-redacted]");
    if (safeTail) console.error(safeTail);
    throw error;
  } finally {
    await stopServer(server);
    await rm(path.join(OUTPUT_DIR, "worker-temp"), { force: true, recursive: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`home_media_test_failed: ${error instanceof Error ? error.message : "unknown_error"}`);
  process.exitCode = 1;
});
