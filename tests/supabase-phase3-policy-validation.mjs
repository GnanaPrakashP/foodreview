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
  if (status.status !== 0) throw new Error("root_local_supabase_not_running");
  const parsed = JSON.parse(status.stdout);
  return { anonKey: parsed.ANON_KEY, serviceKey: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
}

const passed = [];
function record(name) {
  passed.push(name);
  console.log(`PASS: ${name}`);
}

function assertDenied(result, label) {
  assert.ok(result.error, `${label} unexpectedly succeeded`);
}

function assertAllowed(result, label) {
  assert.equal(result.error, null, `${label} was denied`);
}

const env = localStatus();
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.url, env.serviceKey, clientOptions);
const anon = createClient(env.url, env.anonKey, clientOptions);
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-8);
const actors = [];
const createdReviewIds = [];
const createdStorageObjects = [];
let primaryRoomId = null;
let secondaryRoomId = null;
let currentCheck = "startup";

async function createActor(label, accountType = "public") {
  const username = `p3${label}${suffix}`.slice(0, 20).toLowerCase();
  const email = `phase3.${label}.${suffix}@example.test`;
  const password = `Phase3-${label}-${suffix}!`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
  if (created.error || !created.data.user) throw new Error(`actor_create_failed:${label}`);
  const actor = { email, id: created.data.user.id, label, password, username };
  actors.push(actor);
  const profile = await admin.from("profiles").insert({
    account_status: "active",
    account_type: accountType,
    deletion_started_at: null,
    first_name: label,
    id: actor.id,
    last_name: "PhaseThree",
    username
  });
  if (profile.error) throw new Error(`profile_create_failed:${label}`);
  const client = createClient(env.url, env.anonKey, clientOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`actor_sign_in_failed:${label}`);
  actor.client = client;
  return actor;
}

async function visibleIds(client, table, ids) {
  const result = await client.from(table).select("id").in("id", ids);
  assertAllowed(result, `${table} visibility query`);
  return new Set((result.data ?? []).map((row) => row.id));
}

async function insertReview(owner, visibility, restaurantName) {
  const inserted = await admin.from("reviews").insert({
    items: [],
    restaurant_name: restaurantName,
    reviewer_name: owner.username,
    visibility
  }).select("id").single();
  assertAllowed(inserted, "review seed");
  createdReviewIds.push(inserted.data.id);
  return inserted.data.id;
}

try {
  currentCheck = "create actors";
  const alice = await createActor("alice");
  const bob = await createActor("bob", "private");
  const carol = await createActor("carol");
  const eve = await createActor("eve");

  const anonContract = await anon.rpc("production_schema_contract");
  assertDenied(anonContract, "anonymous schema contract");
  const authContract = await alice.client.rpc("production_schema_contract");
  assertDenied(authContract, "authenticated schema contract");
  const serviceContract = await admin.rpc("production_schema_contract");
  assertAllowed(serviceContract, "service schema contract");
  for (const key of [
    "missingCriticalTables", "rlsDisabledTables", "privateBucketDrift",
    "missingWorkerFunctions", "clientWorkerFunctionGrants", "unsafeDefinerFunctions",
    "clientTableGrantDrift", "serviceTableGrantDrift", "invalidIndexes", "unvalidatedConstraints"
  ]) assert.deepEqual(serviceContract.data[key], [], `${key} must be empty`);
  assert.ok(serviceContract.data.migrationVersions.includes("202607130004"));
  record("service-only schema contract reports no critical drift");

  const anonProfiles = await anon.from("profiles").select("id").in("id", actors.map((actor) => actor.id));
  assertAllowed(anonProfiles, "anonymous profile query");
  assert.equal(anonProfiles.data.length, 0);
  const aliceProfiles = await alice.client.from("profiles").select("id").in("id", actors.map((actor) => actor.id));
  assertAllowed(aliceProfiles, "authenticated profile discovery");
  assert.equal(aliceProfiles.data.length, 4);
  const ownUpdate = await alice.client.from("profiles").update({ bio: "phase3-owner-update" }).eq("id", alice.id).select("id");
  assertAllowed(ownUpdate, "own profile update");
  assert.equal(ownUpdate.data.length, 1);
  const foreignUpdate = await bob.client.from("profiles").update({ bio: "forged" }).eq("id", alice.id).select("id");
  assertAllowed(foreignUpdate, "foreign profile update query");
  assert.equal(foreignUpdate.data.length, 0);
  record("profile reads and owner-only updates obey RLS");

  currentCheck = "seed circle membership";
  const membership = await admin.from("circle_memberships").insert({ member_name: bob.username, user_name: alice.username });
  assertAllowed(membership, "circle membership seed");
  const publicReviewId = await insertReview(alice, "public", `Public-${suffix}`);
  const circleReviewId = await insertReview(alice, "circle", `Circle-${suffix}`);
  const privateReviewId = await insertReview(alice, "me", `Private-${suffix}`);
  const reviewIds = [publicReviewId, circleReviewId, privateReviewId];
  currentCheck = "owner review visibility";
  assert.deepEqual(await visibleIds(alice.client, "reviews", reviewIds), new Set(reviewIds));
  currentCheck = "circle review visibility";
  assert.deepEqual(await visibleIds(bob.client, "reviews", reviewIds), new Set([publicReviewId, circleReviewId]));
  currentCheck = "nonmember review visibility";
  assert.deepEqual(await visibleIds(carol.client, "reviews", reviewIds), new Set([publicReviewId]));
  currentCheck = "anonymous review visibility";
  assert.deepEqual(await visibleIds(anon, "reviews", reviewIds), new Set([publicReviewId]));
  const forgedReview = await bob.client.from("reviews").insert({
    items: [], restaurant_name: `Forged-${suffix}`, reviewer_name: alice.username, visibility: "public"
  });
  assertDenied(forgedReview, "forged review owner");
  record("public, circle, private and forged-owner review boundaries pass");

  const like = await bob.client.from("likes").insert({ post_id: publicReviewId, user_name: bob.username });
  assertAllowed(like, "own like");
  const duplicateLike = await bob.client.from("likes").insert({ post_id: publicReviewId, user_name: bob.username });
  assertDenied(duplicateLike, "duplicate like");
  const forgedLike = await bob.client.from("likes").insert({ post_id: publicReviewId, user_name: alice.username });
  assertDenied(forgedLike, "forged like owner");
  const privateLike = await bob.client.from("likes").insert({ post_id: privateReviewId, user_name: bob.username });
  assertDenied(privateLike, "unauthorized private like");
  const comment = await bob.client.from("comments").insert({ content: "phase3", post_id: publicReviewId, user_name: bob.username });
  assertAllowed(comment, "own comment");
  const forgedComment = await bob.client.from("comments").insert({ content: "forged", post_id: publicReviewId, user_name: alice.username });
  assertDenied(forgedComment, "forged comment owner");
  const bookmark = await bob.client.from("wishlist").insert({ post_id: publicReviewId, restaurant_name: `Saved-${suffix}`, user_name: bob.username });
  assertAllowed(bookmark, "own bookmark");
  const forgedBookmark = await bob.client.from("wishlist").insert({ post_id: publicReviewId, restaurant_name: `Forged-${suffix}`, user_name: alice.username });
  assertDenied(forgedBookmark, "forged bookmark owner");
  record("engagement ownership, visibility and uniqueness constraints pass");

  currentCheck = "forged circle mutation";
  const forgedMembership = await bob.client.from("circle_memberships").insert({ member_name: carol.username, user_name: alice.username });
  assertDenied(forgedMembership, "forged circle relationship");
  currentCheck = "create block";
  const currentName = await alice.client.rpc("current_profile_name");
  assertAllowed(currentName, "current profile helper");
  assert.equal(currentName.data, alice.username);
  const block = await alice.client.from("blocked_users").insert({ blocked_name: bob.username, blocker_name: alice.username });
  if (block.error) throw Object.assign(new Error("create_block_denied"), { code: block.error.code ?? "unknown" });
  assertAllowed(block, "own block");
  currentCheck = "block list privacy";
  const bobBlockView = await bob.client.from("blocked_users").select("id").eq("blocker_name", alice.username);
  assertAllowed(bobBlockView, "foreign block-list read");
  assert.equal(bobBlockView.data.length, 0);
  currentCheck = "block review revocation";
  assert.deepEqual(await visibleIds(bob.client, "reviews", [publicReviewId, circleReviewId]), new Set());
  record("circle mutation ownership and block-based content revocation pass");
  const unblockForMemory = await alice.client.from("blocked_users").delete().eq("blocker_name", alice.username).eq("blocked_name", bob.username);
  assertAllowed(unblockForMemory, "remove initial test block");

  const notification = await admin.from("notifications").insert({
    actor_name: alice.username,
    actor_user_id: alice.id,
    recipient_name: bob.username,
    recipient_user_id: bob.id,
    type: "phase3"
  }).select("id").single();
  assertAllowed(notification, "notification seed");
  const bobNotification = await bob.client.from("notifications").select("id").eq("id", notification.data.id);
  assertAllowed(bobNotification, "own notification read");
  assert.equal(bobNotification.data.length, 1);
  const aliceNotification = await alice.client.from("notifications").select("id").eq("id", notification.data.id);
  assertAllowed(aliceNotification, "foreign notification read");
  assert.equal(aliceNotification.data.length, 0);
  const forgedNotification = await alice.client.from("notifications").insert({ recipient_name: carol.username, type: "forged" });
  assertDenied(forgedNotification, "client notification creation");
  const ownToken = await bob.client.from("push_tokens").insert({
    expo_push_token: `ExponentPushToken[p3-${suffix}]`, platform: "android", user_name: bob.username
  });
  assertAllowed(ownToken, "own push token");
  const forgedToken = await bob.client.from("push_tokens").insert({
    expo_push_token: `ExponentPushToken[p3-forged-${suffix}]`, platform: "android", user_name: alice.username
  });
  assertDenied(forgedToken, "forged push token owner");
  record("notification and push-token authority boundaries pass");

  const room = await admin.from("shared_memory_rooms").insert({
    created_by: alice.username,
    restaurant_name: `Memory-${suffix}`,
    status: "published",
    title: "Phase 3 policy room"
  }).select("id").single();
  assertAllowed(room, "memory room seed");
  primaryRoomId = room.data.id;
  const members = await admin.from("shared_memory_members").insert([
    { role: "owner", room_id: primaryRoomId, user_name: alice.username },
    { role: "participant", room_id: primaryRoomId, user_name: bob.username },
    { role: "participant", room_id: primaryRoomId, user_name: eve.username }
  ]);
  assertAllowed(members, "memory members seed");
  const roomTwo = await admin.from("shared_memory_rooms").insert({
    created_by: bob.username, restaurant_name: `Other-${suffix}`, status: "published"
  }).select("id").single();
  assertAllowed(roomTwo, "second room seed");
  secondaryRoomId = roomTwo.data.id;
  const roomTwoMember = await admin.from("shared_memory_members").insert({ role: "owner", room_id: secondaryRoomId, user_name: bob.username });
  assertAllowed(roomTwoMember, "second room member seed");
  assert.equal((await visibleIds(bob.client, "shared_memory_rooms", [primaryRoomId])).size, 1);
  assert.equal((await visibleIds(carol.client, "shared_memory_rooms", [primaryRoomId])).size, 0);
  const bobMessage = await bob.client.from("shared_memory_messages").insert({
    author_name: bob.username, body: "member message", room_id: primaryRoomId
  }).select("id").single();
  assertAllowed(bobMessage, "member message");
  const carolMessage = await carol.client.from("shared_memory_messages").insert({
    author_name: carol.username, body: "non-member message", room_id: primaryRoomId
  });
  assertDenied(carolMessage, "non-member message");
  const otherMessage = await admin.from("shared_memory_messages").insert({
    author_name: bob.username, body: "other room", room_id: secondaryRoomId
  }).select("id").single();
  assertAllowed(otherMessage, "other-room message seed");
  const crossRoomReply = await bob.client.from("shared_memory_messages").insert({
    author_name: bob.username,
    body: "invalid reply",
    reply_to_message_id: otherMessage.data.id,
    room_id: primaryRoomId
  });
  assertDenied(crossRoomReply, "cross-room reply");
  const directPhoto = await alice.client.from("shared_memory_photos").insert({
    media_type: "image",
    public_url: null,
    room_id: primaryRoomId,
    storage_path: `memories/${primaryRoomId}/${alice.id}/${randomUUID()}/photo.jpg`,
    uploader_id: alice.id,
    uploader_name: alice.username
  });
  assertDenied(directPhoto, "direct client photo row");
  record("Memory membership, write, reply and server-finalization boundaries pass");

  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const intentId = randomUUID();
  const storagePath = `memories/${primaryRoomId}/${alice.id}/${intentId}/photo.jpg`;
  const intent = await admin.from("shared_memory_upload_intents").insert({
    extension: "jpg",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    file_size_bytes: bytes.byteLength,
    id: intentId,
    max_file_size_bytes: 25 * 1024 * 1024,
    media_type: "image",
    mime_type: "image/jpeg",
    moderation_status: "pending",
    room_id: primaryRoomId,
    status: "created",
    storage_path: storagePath,
    uploader_id: alice.id,
    uploader_name: alice.username
  });
  assertAllowed(intent, "memory upload intent seed");
  const ownerIntent = await alice.client.from("shared_memory_upload_intents").select("id").eq("id", intentId);
  assertAllowed(ownerIntent, "own intent read");
  assert.equal(ownerIntent.data.length, 1);
  const foreignIntent = await bob.client.from("shared_memory_upload_intents").select("id").eq("id", intentId);
  assertAllowed(foreignIntent, "foreign intent read");
  assert.equal(foreignIntent.data.length, 0);
  const forgedUpload = await bob.client.storage.from("memory-media").upload(
    `memories/${primaryRoomId}/${bob.id}/${randomUUID()}/forged.jpg`, bytes, { contentType: "image/jpeg" }
  );
  assertDenied(forgedUpload, "forged memory upload");
  const upload = await alice.client.storage.from("memory-media").upload(storagePath, bytes, { contentType: "image/jpeg" });
  assertAllowed(upload, "owner intent upload");
  createdStorageObjects.push(["memory-media", storagePath]);
  const finalized = await admin.rpc("finalize_shared_memory_upload_intent", {
    p_file_size_bytes: bytes.byteLength,
    p_intent_id: intentId,
    p_message_id: null,
    p_moderated_at: new Date().toISOString(),
    p_moderation_reason: null,
    p_moderation_status: "approved",
    p_now: new Date().toISOString(),
    p_position: 0
  });
  assertAllowed(finalized, "service memory finalization");
  const anonDownload = await anon.storage.from("memory-media").download(storagePath);
  assertDenied(anonDownload, "anonymous memory download");
  const memberDownload = await bob.client.storage.from("memory-media").download(storagePath);
  assertAllowed(memberDownload, "member memory download");
  const nonMemberDownload = await carol.client.storage.from("memory-media").download(storagePath);
  assertDenied(nonMemberDownload, "non-member memory download");
  const reblock = await alice.client.from("blocked_users").insert({ blocked_name: bob.username, blocker_name: alice.username });
  assertAllowed(reblock, "recreate block for media revocation");
  const blockedDownload = await bob.client.storage.from("memory-media").download(storagePath);
  assertDenied(blockedDownload, "blocked member memory download");
  const unblock = await alice.client.from("blocked_users").delete().eq("blocker_name", alice.username).eq("blocked_name", bob.username);
  assertAllowed(unblock, "remove test block");
  const removed = await admin.from("shared_memory_members").delete().eq("room_id", primaryRoomId).eq("user_name", bob.username);
  assertAllowed(removed, "remove memory member");
  assert.equal((await visibleIds(bob.client, "shared_memory_rooms", [primaryRoomId])).size, 0);
  const removedDownload = await bob.client.storage.from("memory-media").download(storagePath);
  assertDenied(removedDownload, "removed-member memory download");
  record("real private Memory Storage owner/member/block/removal policies pass");

  const clientClaim = await alice.client.rpc("claim_media_processing_jobs", {
    p_lease_seconds: 30, p_limit: 1, p_max_attempts: 5, p_worker_id: "forged-client-worker"
  });
  assertDenied(clientClaim, "client media claim");
  const clientDeletionClaim = await alice.client.rpc("claim_account_deletion_jobs", {
    p_lease_seconds: 30, p_limit: 1, p_worker_id: "forged-client-worker"
  });
  assertDenied(clientDeletionClaim, "client deletion claim");
  record("media and account worker functions reject authenticated clients");

  const deletionRequest = await eve.client.rpc("request_account_deletion");
  assertAllowed(deletionRequest, "owner deletion request");
  assert.equal(deletionRequest.data.length, 1);
  const hiddenDeletingProfile = await alice.client.from("profiles").select("id").eq("id", eve.id);
  assertAllowed(hiddenDeletingProfile, "deleting profile suppression");
  assert.equal(hiddenDeletingProfile.data.length, 0);
  const frozenReview = await eve.client.from("reviews").insert({
    items: [], restaurant_name: `Frozen-${suffix}`, reviewer_name: eve.username, visibility: "public"
  });
  assertDenied(frozenReview, "frozen review write");
  const frozenToken = await eve.client.from("push_tokens").insert({
    expo_push_token: `ExponentPushToken[p3-frozen-${suffix}]`, platform: "android", user_name: eve.username
  });
  assertDenied(frozenToken, "frozen push token write");
  const frozenMemoryWrite = await eve.client.from("shared_memory_messages").insert({
    author_name: eve.username, body: "frozen member write", room_id: primaryRoomId
  });
  assertDenied(frozenMemoryWrite, "frozen Memory write");
  const foreignJobs = await bob.client.from("account_deletion_jobs").select("id").eq("user_id", eve.id);
  assertDenied(foreignJobs, "foreign deletion job inspection");
  record("owner-only deletion request freezes writes and hides service-owned jobs");
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "assertion_failed";
  console.error(`phase3-policy-validation failed:${currentCheck}:${code}`);
  process.exitCode = 1;
} finally {
  for (const [bucket, objectPath] of createdStorageObjects) {
    await admin.storage.from(bucket).remove([objectPath]);
  }
  if (primaryRoomId) await admin.from("shared_memory_rooms").delete().eq("id", primaryRoomId);
  if (secondaryRoomId) await admin.from("shared_memory_rooms").delete().eq("id", secondaryRoomId);
  if (createdReviewIds.length > 0) await admin.from("reviews").delete().in("id", createdReviewIds);
  for (const actor of actors) {
    await admin.from("account_deletion_jobs").delete().eq("user_id", actor.id);
    await admin.auth.admin.deleteUser(actor.id);
  }
}

if (!process.exitCode) console.log(`Phase 3 real policy validation passed ${passed.length}/${passed.length}.`);
