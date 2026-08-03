#!/usr/bin/env node
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

const env = localStatus();
const admin = createClient(env.url, env.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const suffix = `${Date.now()}`.slice(-9);
const password = `Memory-${suffix}!Aa`;
const ownerName = `tmra_${suffix}`;
const peerName = `tmrb_${suffix}`;
let ownerId = null;
let peerId = null;

try {
  const owner = required(await admin.auth.admin.createUser({
    email: `${ownerName}@example.test`, email_confirm: true, password
  }), "create owner").user;
  const peer = required(await admin.auth.admin.createUser({
    email: `${peerName}@example.test`, email_confirm: true, password
  }), "create peer").user;
  assert.ok(owner && peer);
  ownerId = owner.id;
  peerId = peer.id;

  required(await admin.from("profiles").upsert([
    { first_name: "Media", id: ownerId, last_name: "Owner", username: ownerName },
    { first_name: "Media", id: peerId, last_name: "Peer", username: peerName }
  ]), "profiles");

  const roomId = randomUUID();
  required(await admin.from("shared_memory_rooms").insert({
    created_by: ownerName,
    id: roomId,
    restaurant_name: "Runtime Place",
    status: "published",
    title: "Media early publication"
  }), "room");
  required(await admin.from("shared_memory_members").insert([
    { role: "owner", room_id: roomId, user_name: ownerName },
    { role: "participant", room_id: roomId, user_name: peerName }
  ]), "members");

  const assetId = randomUUID();
  required(await admin.from("media_assets").insert({
    access_class: "memory_private",
    crop_rect: { height: 1, targetAspect: null, width: 1, x: 0, y: 0 },
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    id: assetId,
    media_type: "image",
    moderation_status: "pending",
    original_extension: "jpg",
    original_file_size_bytes: 100,
    original_height: 800,
    original_mime_type: "image/jpeg",
    original_width: 600,
    owner_id: ownerId,
    owner_name: ownerName,
    privacy_state: "stable",
    source_bucket_id: "media-sources",
    source_storage_path: `sources/memory/${ownerId}/${assetId}/original.jpg`,
    status: "uploaded",
    surface: "memory",
    uploaded_at: new Date().toISOString(),
    visibility: "private"
  }), "uploaded asset");

  const clientId = randomUUID();
  const clientCreatedAt = new Date().toISOString();
  const attachStartedAt = performance.now();
  const attached = required(await admin.rpc("attach_shared_memory_media_assets_v3", {
    p_asset_ids: [assetId],
    p_body: "early image",
    p_client_created_at: clientCreatedAt,
    p_client_id: clientId,
    p_client_order_key: `${clientCreatedAt}:${clientId}`,
    p_client_sequence: Date.now(),
    p_owner_id: ownerId,
    p_owner_name: ownerName,
    p_reply_to_message_id: null,
    p_room_id: roomId
  }), "attach uploaded source");
  const localAttachDurationMs = Math.round((performance.now() - attachStartedAt) * 10) / 10;
  const messageId = attached.message.id;
  const photoId = attached.photos[0].id;
  assert.equal(attached.message.activity_kind, "media");
  assert.equal(attached.photos[0].processing_status, "uploaded");
  assert.equal(attached.photos[0].public_url, null);

  const notification = required(await admin.from("notifications")
    .select("metadata,recipient_user_id")
    .eq("recipient_user_id", peerId)
    .eq("entity_id", roomId)
    .single(), "media notification");
  assert.equal(notification.metadata.kind, "media");

  const peerClient = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const peerLink = required(await admin.auth.admin.generateLink({
    email: `${peerName}@example.test`, type: "magiclink"
  }), "peer magic link");
  assert.ok(peerLink.properties?.hashed_token);
  required(await peerClient.auth.verifyOtp({
    token_hash: peerLink.properties.hashed_token,
    type: "magiclink"
  }), "peer sign in");
  const summaries = required(await peerClient.rpc("shared_memory_room_summaries_v4", {
    p_before_room_id: null,
    p_before_timeline_date: null,
    p_limit: 13
  }), "peer summary");
  const summary = summaries.find((row) => row.id === roomId);
  assert.equal(Number(summary.unread_chat_count), 0);
  assert.equal(Number(summary.unread_media_count), 1);

  required(await admin.from("media_assets").update({ status: "processing" }).eq("id", assetId), "processing state");
  const processing = required(await admin.from("shared_memory_photos")
    .select("id,processing_status")
    .eq("id", photoId)
    .single(), "processing photo");
  assert.deepEqual(processing, { id: photoId, processing_status: "processing" });

  required(await admin.from("media_derivatives").insert([
    {
      asset_id: assetId,
      bucket_id: "media-private",
      file_size_bytes: 80,
      height: 800,
      kind: "canonical",
      mime_type: "image/jpeg",
      public_url: null,
      storage_path: `memories/${ownerId}/${assetId}/canonical.jpg`,
      width: 600
    },
    {
      asset_id: assetId,
      bucket_id: "media-private",
      file_size_bytes: 20,
      height: 320,
      kind: "thumbnail",
      mime_type: "image/jpeg",
      public_url: null,
      storage_path: `memories/${ownerId}/${assetId}/thumbnail.jpg`,
      width: 240
    }
  ]), "derivatives");
  required(await admin.from("media_assets").update({
    moderated_at: new Date().toISOString(),
    moderation_status: "approved",
    processed_at: new Date().toISOString(),
    status: "ready"
  }).eq("id", assetId), "ready state");

  const ready = required(await admin.from("shared_memory_photos")
    .select("id,message_id,processing_status,image_width,image_height")
    .eq("id", photoId)
    .single(), "ready photo");
  assert.deepEqual(ready, {
    id: photoId,
    image_height: 800,
    image_width: 600,
    message_id: messageId,
    processing_status: "ready"
  });

  const duplicate = required(await admin.rpc("attach_shared_memory_media_assets_v3", {
    p_asset_ids: [assetId],
    p_body: "early image",
    p_client_created_at: clientCreatedAt,
    p_client_id: clientId,
    p_client_order_key: `${clientCreatedAt}:${clientId}`,
    p_client_sequence: Number(attached.message.client_sequence),
    p_owner_id: ownerId,
    p_owner_name: ownerName,
    p_reply_to_message_id: null,
    p_room_id: roomId
  }), "idempotent attach");
  assert.equal(duplicate.message.id, messageId);
  assert.equal(duplicate.photos[0].id, photoId);

  const failedAssetId = randomUUID();
  required(await admin.from("media_assets").insert({
    access_class: "memory_private",
    crop_rect: { height: 1, targetAspect: null, width: 1, x: 0, y: 0 },
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    id: failedAssetId,
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
    source_storage_path: `sources/memory/${ownerId}/${failedAssetId}/original.mp4`,
    status: "uploaded",
    surface: "memory",
    uploaded_at: new Date().toISOString(),
    visibility: "private"
  }), "failed asset");
  const failedClientId = randomUUID();
  const failedCreatedAt = new Date().toISOString();
  const failedAttach = required(await admin.rpc("attach_shared_memory_media_assets_v3", {
    p_asset_ids: [failedAssetId],
    p_body: "failed video",
    p_client_created_at: failedCreatedAt,
    p_client_id: failedClientId,
    p_client_order_key: `${failedCreatedAt}:${failedClientId}`,
    p_client_sequence: Date.now(),
    p_owner_id: ownerId,
    p_owner_name: ownerName,
    p_reply_to_message_id: null,
    p_room_id: roomId
  }), "attach failed fixture");
  const failedPhotoId = failedAttach.photos[0].id;
  required(await admin.from("media_assets").update({
    failure_code: "media_video_transcode_failed",
    failure_reason: "media_video_transcode_failed",
    status: "rejected"
  }).eq("id", failedAssetId), "reject processing");

  const ownerClient = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const ownerLink = required(await admin.auth.admin.generateLink({
    email: `${ownerName}@example.test`, type: "magiclink"
  }), "owner magic link");
  required(await ownerClient.auth.verifyOtp({
    token_hash: ownerLink.properties.hashed_token,
    type: "magiclink"
  }), "owner sign in");
  const ownerFailureRows = required(await ownerClient.from("shared_memory_photos")
    .select("id,processing_status,processing_failure_code")
    .eq("id", failedPhotoId), "owner failed row");
  const peerFailureRows = required(await peerClient.from("shared_memory_photos")
    .select("id")
    .eq("id", failedPhotoId), "peer failed row");
  assert.deepEqual(ownerFailureRows, [{
    id: failedPhotoId,
    processing_failure_code: "media_video_transcode_failed",
    processing_status: "rejected"
  }]);
  assert.deepEqual(peerFailureRows, []);

  console.log(`PASS: stable early publication, Media-only unread, idempotent readiness, and uploader-only terminal failure (local attach ${localAttachDurationMs} ms)`);
} finally {
  if (ownerId) await admin.auth.admin.deleteUser(ownerId);
  if (peerId) await admin.auth.admin.deleteUser(peerId);
}
