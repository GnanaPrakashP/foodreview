#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

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
  if (result.error) throw new Error(`${operation}_failed: ${result.error.message}`);
  return result.data;
}

const passed = [];
function record(name) {
  passed.push(name);
  console.log(`PASS: ${name}`);
}

const env = localStatus();
const admin = createClient(env.url, env.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
const username = `hm_inv_${nonce}`;
const password = `HomeInvariant-${nonce}!`;
let userId = null;
const reviewIds = new Set();
const assetIds = new Set();

async function createAsset(status = "ready") {
  const id = randomUUID();
  assetIds.add(id);
  const ready = status === "ready";
  assertNoError(await admin.from("media_assets").insert({
    access_class: "public_post",
    consumed_at: ready ? new Date().toISOString() : null,
    crop_rect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    id,
    media_type: "image",
    moderation_status: ready ? "approved" : "pending",
    original_extension: "jpg",
    original_file_size_bytes: 256,
    original_height: 1250,
    original_mime_type: "image/jpeg",
    original_width: 1000,
    owner_id: userId,
    owner_name: username,
    privacy_state: "stable",
    source_bucket_id: "media-sources",
    source_storage_path: `sources/post/${userId}/${id}/original.jpg`,
    status,
    surface: "post",
    visibility: "private"
  }), "asset_insert");
  if (ready) {
    assertNoError(await admin.from("media_derivatives").insert({
      asset_id: id,
      blurhash: "L5H2EC=PM+yV0g-mq.wG9c010J}I",
      bucket_id: "media-private",
      file_size_bytes: 256,
      height: 900,
      kind: "feed",
      mime_type: "image/jpeg",
      public_url: null,
      storage_path: `private-posts/${userId}/${id}/feed.jpg`,
      width: 720
    }), "feed_derivative_insert");
  }
  return id;
}

async function createAvatarAsset() {
  const id = randomUUID();
  assetIds.add(id);
  const thumbnailPath = `avatars/${userId}/${id}/thumbnail.jpg`;
  const thumbnailUrl = `${env.url}/storage/v1/object/public/media-public/${thumbnailPath}`;
  assertNoError(await admin.from("media_assets").insert({
    access_class: "avatar_public",
    crop_rect: { height: 1, targetAspect: 1, width: 1, x: 0, y: 0 },
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    id,
    media_type: "image",
    moderation_status: "approved",
    original_extension: "jpg",
    original_file_size_bytes: 256,
    original_height: 1000,
    original_mime_type: "image/jpeg",
    original_width: 1000,
    owner_id: userId,
    owner_name: username,
    privacy_state: "stable",
    source_bucket_id: "media-sources",
    source_storage_path: `sources/avatar/${userId}/${id}/original.jpg`,
    status: "ready",
    surface: "avatar",
    visibility: "public"
  }), "avatar_asset_insert");
  assertNoError(await admin.from("media_derivatives").insert([
    {
      asset_id: id,
      bucket_id: "media-public",
      file_size_bytes: 512,
      height: 512,
      kind: "canonical",
      mime_type: "image/jpeg",
      public_url: `${env.url}/storage/v1/object/public/media-public/avatars/${userId}/${id}/canonical.jpg`,
      storage_path: `avatars/${userId}/${id}/canonical.jpg`,
      width: 512
    },
    {
      asset_id: id,
      bucket_id: "media-public",
      file_size_bytes: 128,
      height: 128,
      kind: "thumbnail",
      mime_type: "image/jpeg",
      public_url: thumbnailUrl,
      storage_path: thumbnailPath,
      width: 128
    }
  ]), "avatar_derivatives_insert");
  return { id, thumbnailUrl };
}

async function createDraft(label) {
  const row = assertNoError(await admin.from("reviews").insert({
    body: "Rollback-safe Home media invariant runtime fixture",
    items: [{ name: "Invariant Dish", rating: 4 }],
    requires_ready_media: true,
    restaurant_name: label,
    reviewer_name: username,
    status: "draft",
    visibility: "public"
  }).select("id").single(), "draft_review_insert");
  reviewIds.add(row.id);
  return row.id;
}

async function link(reviewId, assetId, position = 0) {
  assertNoError(await admin.from("review_photos").insert({
    height: 1350,
    media_asset_id: assetId,
    media_type: "image",
    position,
    public_url: null,
    review_id: reviewId,
    size_bytes: 256,
    storage_path: `private-posts/${userId}/${assetId}/canonical.jpg`,
    width: 1080
  }), "review_media_link_insert");
}

try {
  const created = await admin.auth.admin.createUser({
    email: `${username}@example.test`,
    email_confirm: true,
    password
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("runtime_user_create_failed");
  userId = created.data.user.id;
  assertNoError(await admin.from("profiles").upsert({
    account_status: "active",
    account_type: "public",
    first_name: "Home",
    id: userId,
    last_name: "Invariant",
    username
  }, { onConflict: "id" }), "profile_insert");

  const userClient = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const magicLink = await admin.auth.admin.generateLink({ email: `${username}@example.test`, type: "magiclink" });
  if (magicLink.error || !magicLink.data.properties?.hashed_token) throw magicLink.error ?? new Error("runtime_magic_link_failed");
  assertNoError(await userClient.auth.verifyOtp({
    token_hash: magicLink.data.properties.hashed_token,
    type: "magiclink"
  }), "runtime_user_sign_in");
  const clientOptOut = await userClient.from("reviews").insert({
    items: [],
    requires_ready_media: false,
    restaurant_name: "Untrusted guard opt-out",
    reviewer_name: username,
    status: "active",
    visibility: "public"
  });
  assert.ok(clientOptOut.error);
  assert.match(clientOptOut.error.message, /published_review_media_guard_cannot_be_disabled/);
  record("authenticated clients cannot opt out of the publication guard");

  const activeWithoutMedia = await admin.from("reviews").insert({
    items: [],
    requires_ready_media: true,
    restaurant_name: "Guarded active without media",
    reviewer_name: username,
    status: "active",
    visibility: "public"
  });
  assert.ok(activeWithoutMedia.error);
  assert.match(activeWithoutMedia.error.message, /published_review_requires_ready_media/);
  record("guarded active insert with zero media is rejected");

  const emptyDraftId = await createDraft("Empty draft is allowed");
  const emptyDraft = assertNoError(await admin.from("reviews").select("status").eq("id", emptyDraftId).single(), "empty_draft_read");
  assert.equal(emptyDraft.status, "draft");
  record("draft can temporarily contain zero media");

  const pendingAssetId = await createAsset("created");
  const pendingReviewId = await createDraft("Pending media cannot publish");
  await link(pendingReviewId, pendingAssetId);
  const pendingPublish = await admin.from("reviews").update({ status: "active" }).eq("id", pendingReviewId);
  assert.ok(pendingPublish.error);
  assert.match(pendingPublish.error.message, /published_review_requires_ready_media/);
  record("pending or unapproved media cannot publish");

  const firstReadyAssetId = await createAsset("ready");
  const readyReviewId = await createDraft("Ready media publishes");
  await link(readyReviewId, firstReadyAssetId);
  assertNoError(await admin.from("reviews").update({ status: "active" }).eq("id", readyReviewId), "ready_review_publish");
  record("ready stable owner-matched private derivative permits publication");

  const lastLinkDelete = await admin.from("review_photos").delete().eq("review_id", readyReviewId);
  assert.ok(lastLinkDelete.error);
  assert.match(lastLinkDelete.error.message, /published_review_requires_ready_media/);
  record("last published media link cannot be deleted");

  const replacementAssetId = await createAsset("ready");
  await link(readyReviewId, replacementAssetId, 1);
  assertNoError(await admin.from("review_photos").delete().eq("review_id", readyReviewId).eq("media_asset_id", firstReadyAssetId), "old_media_delete_after_replacement");
  const replacementLinks = assertNoError(await admin.from("review_photos").select("media_asset_id").eq("review_id", readyReviewId), "replacement_links_read");
  assert.deepEqual(replacementLinks.map((row) => row.media_asset_id), [replacementAssetId]);
  record("link-new-before-remove-old replacement succeeds atomically across mutations");

  const avatarAsset = await createAvatarAsset();
  const activatedAvatar = assertNoError(await admin.rpc("activate_processed_avatar_asset_v1", {
    p_asset_id: avatarAsset.id,
    p_user_id: userId
  }), "avatar_activate");
  assert.equal(activatedAvatar.assetId, avatarAsset.id);
  assert.equal(activatedAvatar.avatarUrl, avatarAsset.thumbnailUrl);
  const activatedProfile = assertNoError(await admin.from("profiles")
    .select("avatar_media_asset_id,avatar_url")
    .eq("id", userId)
    .single(), "activated_avatar_profile_read");
  assert.equal(activatedProfile.avatar_media_asset_id, avatarAsset.id);
  assert.equal(activatedProfile.avatar_url, avatarAsset.thumbnailUrl);
  record("processed 128x128 avatar activation links immutable asset atomically");

  const invalidRow = assertNoError(await admin.from("reviews").insert({
    items: [],
    requires_ready_media: false,
    restaurant_name: "Repair-only legacy invalid row",
    reviewer_name: username,
    status: "active",
    visibility: "public"
  }).select("id").single(), "legacy_invalid_insert");
  reviewIds.add(invalidRow.id);
  const report = assertNoError(await admin.rpc("home_media_integrity_report_v1"), "integrity_report");
  assert.ok(report.publishedWithZeroLinks.includes(invalidRow.id));
  assert.ok(report.publishedWithZeroReadyMedia.includes(invalidRow.id));
  record("read-only repair report identifies legacy invalid rows");

  assertNoError(await admin.from("reviews").delete().eq("id", readyReviewId), "whole_post_delete");
  reviewIds.delete(readyReviewId);
  const deletedPost = assertNoError(await admin.from("reviews").select("id").eq("id", readyReviewId), "whole_post_verify");
  assert.equal(deletedPost.length, 0);
  record("whole-post deletion and media cascade succeed");
} finally {
  if (reviewIds.size > 0) await admin.from("reviews").delete().in("id", [...reviewIds]);
  if (assetIds.size > 0) await admin.from("media_assets").delete().in("id", [...assetIds]);
  if (userId) await admin.auth.admin.deleteUser(userId);
}

assert.equal(passed.length, 10);
console.log(`Home media database invariant runtime validation passed (${passed.length} checks).`);
