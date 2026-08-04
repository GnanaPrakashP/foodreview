#!/usr/bin/env node
// Proves the incremental room sync carries media processing state, which is
// what a client needs to tell "still transcoding" from "ready with no URL".
// Run against the local stack: node tests/supabase-table-memory-room-sync-media-processing-runtime-validation.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function signIn(admin, env, username) {
  const client = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const link = required(await admin.auth.admin.generateLink({
    email: `${username}@example.test`, type: "magiclink"
  }), `${username} magic link`);
  assert.ok(link.properties?.hashed_token);
  required(await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink"
  }), `${username} sign in`);
  return client;
}

function videoAsset(ownerId, ownerName, assetId) {
  return {
    access_class: "memory_private",
    crop_rect: { height: 1, targetAspect: null, width: 1, x: 0, y: 0 },
    duration_ms: 4414,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    id: assetId,
    media_type: "video",
    moderation_status: "pending",
    original_extension: "mp4",
    original_file_size_bytes: 100,
    original_height: 1920,
    original_mime_type: "video/mp4",
    original_width: 1080,
    owner_id: ownerId,
    owner_name: ownerName,
    privacy_state: "stable",
    source_bucket_id: "media-sources",
    source_storage_path: `sources/memory/${ownerId}/${assetId}/original.mp4`,
    status: "uploaded",
    surface: "memory",
    uploaded_at: new Date().toISOString(),
    visibility: "private"
  };
}

async function attachVideo(admin, { assetId, body, ownerId, ownerName, roomId }) {
  const clientId = randomUUID();
  const clientCreatedAt = new Date().toISOString();
  return required(await admin.rpc("attach_shared_memory_media_assets_v3", {
    p_asset_ids: [assetId],
    p_body: body,
    p_client_created_at: clientCreatedAt,
    p_client_id: clientId,
    p_client_order_key: `${clientCreatedAt}:${clientId}`,
    p_client_sequence: Date.now(),
    p_owner_id: ownerId,
    p_owner_name: ownerName,
    p_reply_to_message_id: null,
    p_room_id: roomId
  }), `attach ${body}`);
}

async function syncPhotos(client, roomId, label) {
  const payload = required(await client.rpc("shared_memory_room_sync_v2", {
    p_after_cursor: 0,
    p_limit: 200,
    p_room_id: roomId
  }), label);
  return payload.changes.photos;
}

const env = localStatus();
const admin = createClient(env.url, env.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const suffix = `${Date.now()}`.slice(-9);
const password = `Memory-${suffix}!Aa`;
const ownerName = `tmsa_${suffix}`;
const peerName = `tmsb_${suffix}`;
let ownerId = null;
let peerId = null;

try {
  const owner = required(await admin.auth.admin.createUser({
    email: `${ownerName}@example.test`, email_confirm: true, password
  }), "create owner").user;
  const peer = required(await admin.auth.admin.createUser({
    email: `${peerName}@example.test`, email_confirm: true, password
  }), "create peer").user;
  ownerId = owner.id;
  peerId = peer.id;

  required(await admin.from("profiles").upsert([
    { first_name: "Sync", id: ownerId, last_name: "Owner", username: ownerName },
    { first_name: "Sync", id: peerId, last_name: "Peer", username: peerName }
  ]), "profiles");

  const roomId = randomUUID();
  required(await admin.from("shared_memory_rooms").insert({
    created_by: ownerName,
    id: roomId,
    restaurant_name: "Runtime Place",
    status: "published",
    title: "Room sync media processing"
  }), "room");
  required(await admin.from("shared_memory_members").insert([
    { role: "owner", room_id: roomId, user_name: ownerName },
    { role: "participant", room_id: roomId, user_name: peerName }
  ]), "members");

  const ownerClient = await signIn(admin, env, ownerName);
  const peerClient = await signIn(admin, env, peerName);

  // A video published before it is processed: this is the row that used to
  // reach the client with no status at all.
  const assetId = randomUUID();
  required(await admin.from("media_assets").insert(videoAsset(ownerId, ownerName, assetId)), "video asset");
  const attached = await attachVideo(admin, {
    assetId, body: "processing video", ownerId, ownerName, roomId
  });
  const photoId = attached.photos[0].id;
  assert.equal(attached.photos[0].public_url, null);

  const publishedPhotos = await syncPhotos(ownerClient, roomId, "owner sync after publication");
  const published = publishedPhotos.find((photo) => photo.id === photoId);
  assert.ok(published, "the published video must reach the change page");
  // The whole point: an unfinished video is now self-describing.
  assert.ok("processing_status" in published, "sync must project processing_status");
  assert.ok("processing_failure_code" in published, "sync must project processing_failure_code");
  assert.equal(published.processing_status, "uploaded");
  assert.equal(published.media_asset_id, assetId);
  assert.equal(published.processing_failure_code, null);
  assert.equal(published.duration_ms, 4414);
  // Stored media locations stay out of the payload; the API signs delivery URLs
  // from its own admin lookup.
  assert.equal("storage_path" in published, false);
  assert.equal("public_url" in published, false);

  required(await admin.from("media_assets").update({ status: "processing" }).eq("id", assetId), "processing state");
  const processing = (await syncPhotos(ownerClient, roomId, "owner sync while processing"))
    .find((photo) => photo.id === photoId);
  assert.equal(processing.processing_status, "processing");

  required(await admin.from("media_derivatives").insert([
    {
      asset_id: assetId,
      bucket_id: "media-private",
      duration_ms: 4414,
      file_size_bytes: 90,
      height: 1600,
      kind: "canonical",
      mime_type: "video/mp4",
      public_url: null,
      storage_path: `memories/${ownerId}/${assetId}/canonical.mp4`,
      width: 900
    },
    {
      asset_id: assetId,
      bucket_id: "media-private",
      file_size_bytes: 20,
      height: 320,
      kind: "poster",
      mime_type: "image/jpeg",
      public_url: null,
      storage_path: `memories/${ownerId}/${assetId}/poster.jpg`,
      width: 180
    }
  ]), "derivatives");
  required(await admin.from("media_assets").update({
    moderated_at: new Date().toISOString(),
    moderation_status: "approved",
    processed_at: new Date().toISOString(),
    status: "ready"
  }).eq("id", assetId), "ready state");

  const ownerReady = (await syncPhotos(ownerClient, roomId, "owner sync when ready"))
    .find((photo) => photo.id === photoId);
  const peerReady = (await syncPhotos(peerClient, roomId, "peer sync when ready"))
    .find((photo) => photo.id === photoId);
  assert.equal(ownerReady.processing_status, "ready");
  assert.equal(peerReady.processing_status, "ready");
  assert.equal(peerReady.media_asset_id, assetId);

  // A terminal outcome stays visible to its uploader and hidden from peers,
  // matching the bounded Chat and Media reads in 202608040002.
  const failedAssetId = randomUUID();
  required(await admin.from("media_assets").insert(videoAsset(ownerId, ownerName, failedAssetId)), "failed asset");
  const failedAttach = await attachVideo(admin, {
    assetId: failedAssetId, body: "failed video", ownerId, ownerName, roomId
  });
  const failedPhotoId = failedAttach.photos[0].id;
  required(await admin.from("media_assets").update({
    failure_code: "media_video_transcode_failed",
    failure_reason: "media_video_transcode_failed",
    status: "rejected"
  }).eq("id", failedAssetId), "reject processing");

  const ownerTerminal = (await syncPhotos(ownerClient, roomId, "owner sync after failure"))
    .find((photo) => photo.id === failedPhotoId);
  const peerTerminalPhotos = await syncPhotos(peerClient, roomId, "peer sync after failure");
  assert.ok(ownerTerminal, "an uploader must keep receiving their own rejected media");
  assert.equal(ownerTerminal.processing_status, "rejected");
  assert.equal(ownerTerminal.processing_failure_code, "media_video_transcode_failed");
  assert.equal(ownerTerminal.moderation_status, "rejected");
  assert.equal(peerTerminalPhotos.some((photo) => photo.id === failedPhotoId), false);
  // The peer still receives everything they are allowed to see.
  assert.equal(peerTerminalPhotos.some((photo) => photo.id === photoId), true);

  console.log("PASS: room sync projects media processing state, keeps uploader-visible terminal media, hides it from peers, and omits stored media locations");
} finally {
  if (ownerId) await admin.auth.admin.deleteUser(ownerId);
  if (peerId) await admin.auth.admin.deleteUser(peerId);
}
