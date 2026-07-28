#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const root = new URL("../", import.meta.url).pathname;
const artifactDir = process.env.MEMORY_RELEASE_ARTIFACT_DIR ??
  "/private/tmp/memory-room-release-acceptance";
const manifestPath = `${artifactDir}/fixture.json`;
const password = "Fixture-Release-Only-74!";
const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${String(result.stderr || result.stdout).slice(-4_000)}`);
  }
  return result.stdout;
}

function localStatus() {
  const result = spawnSync(process.execPath, [
    "scripts/run-supabase.mjs",
    "status",
    "-o",
    "json"
  ], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Local Supabase is unavailable");
  const status = JSON.parse(result.stdout);
  return {
    serviceKey: status.SERVICE_ROLE_KEY,
    url: status.API_URL
  };
}

function fixtureEnvironment() {
  const configuredUrl = process.env.SUPABASE_URL?.trim();
  const configuredServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (configuredUrl || configuredServiceKey) {
    if (!configuredUrl || !configuredServiceKey) {
      throw new Error("Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    }
    const parsed = new URL(configuredUrl);
    const localHostname = parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !localHostname) {
      throw new Error("Remote fixture targets must use HTTPS");
    }
    return {
      serviceKey: configuredServiceKey,
      url: parsed.toString().replace(/\/$/, "")
    };
  }
  return localStatus();
}

async function createUser(admin, suffix, label) {
  const email = `memory-release-${label}-${suffix}@example.test`;
  const username = `mrel_${label}_${suffix}`.slice(0, 24);
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("fixture_user_create_failed");
  }
  const userId = created.data.user.id;
  const profile = await admin.from("profiles").upsert({
    account_status: "active",
    account_type: "public",
    first_name: label === "owner" ? "Release" : "Fixture",
    id: userId,
    last_name: label === "owner" ? "Runner" : label,
    username
  });
  if (profile.error) throw profile.error;
  return { email, userId, username };
}

async function findExistingOwner(admin, username) {
  const profile = await admin
    .from("profiles")
    .select("id,username")
    .eq("username", username)
    .single();
  if (profile.error || !profile.data) {
    throw profile.error ?? new Error("fixture_owner_not_found");
  }
  return {
    email: null,
    userId: profile.data.id,
    username: profile.data.username
  };
}

function prepareMediaFiles() {
  mkdirSync(artifactDir, { recursive: true });
  const portrait = `${artifactDir}/portrait.jpg`;
  const landscape = `${artifactDir}/landscape.jpg`;
  const video = `${artifactDir}/video.mp4`;
  const audio = `${artifactDir}/audio.m4a`;
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x4C7DFF:s=72x108:d=0.1",
    "-frames:v", "1", portrait
  ]);
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0xE66A3C:s=128x72:d=0.1",
    "-frames:v", "1", landscape
  ]);
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x2C9B70:s=128x72:d=2",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", video
  ]);
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:a", "aac", "-b:a", "64k", audio
  ]);
  return { audio, landscape, portrait, video };
}

async function createRoom(admin, owner, participants, title, alternate = false) {
  const room = await admin.from("shared_memory_rooms").insert({
    area: "Synthetic release fixture",
    created_by: owner.username,
    occasion_type: alternate ? "casual" : "friends_hangout",
    restaurant_name: alternate ? "Synthetic alternate table" : "Synthetic performance table",
    status: "published",
    title,
    visit_date: new Date().toISOString().slice(0, 10)
  }).select("id").single();
  if (room.error) throw room.error;
  const members = await admin.from("shared_memory_members").insert(
    [owner, ...participants].map((participant, index) => ({
      role: index === 0 ? "owner" : "participant",
      room_id: room.data.id,
      user_name: participant.username
    }))
  );
  if (members.error) throw members.error;
  return room.data.id;
}

async function seedTable(admin, roomId, users) {
  const stopInsert = await admin.from("shared_memory_stops").insert(
    Array.from({ length: 4 }, (_, index) => ({
      created_by: users[index % users.length].username,
      name: `Synthetic stop ${index + 1}`,
      note: `Release fixture stop ${index + 1}`,
      position: index,
      room_id: roomId,
      stop_type: index % 2 === 0 ? "restaurant" : "cafe"
    }))
  ).select("id");
  if (stopInsert.error) throw stopInsert.error;
  const dishes = await admin.from("shared_memory_dishes").insert(
    Array.from({ length: 16 }, (_, index) => ({
      added_by: users[index % users.length].username,
      dish_name: `Release fixture dish ${String(index + 1).padStart(2, "0")}`,
      note: `Synthetic dish detail ${index + 1}`,
      room_id: roomId
    }))
  ).select("id");
  if (dishes.error) throw dishes.error;
  const ratings = await admin.from("shared_memory_dish_ratings").insert(
    dishes.data.flatMap((dish, index) => users.map((user, userIndex) => ({
      dish_id: dish.id,
      rated_by: user.username,
      rating: ((index + userIndex) % 5) + 1,
      room_id: roomId
    })))
  );
  if (ratings.error) throw ratings.error;
  return { dishes: dishes.data.length, stops: stopInsert.data.length };
}

async function seedMessages(admin, roomId, users, count) {
  const now = Date.now();
  const rows = Array.from({ length: count }, (_, index) => ({
    author_name: users[index % users.length].username,
    body: index % 11 === 0
      ? `Release fixture multiline ${index + 1}\nEmoji 🍽️ and a deliberately longer synthetic line`
      : `Release fixture message ${String(index + 1).padStart(3, "0")}`,
    created_at: new Date(now - (count - index) * 30_000).toISOString(),
    room_id: roomId
  }));
  const inserted = await admin.from("shared_memory_messages").insert(rows).select("id");
  if (inserted.error) throw inserted.error;
  const replies = await admin.from("shared_memory_messages").insert(
    [8, 18, 28, 38, 48, 58, 68, 78].filter((index) => index < count).map((index, replyIndex) => ({
      author_name: users[(replyIndex + 1) % users.length].username,
      body: `Release fixture reply ${replyIndex + 1}`,
      created_at: new Date(now - (8 - replyIndex) * 10_000).toISOString(),
      reply_to_message_id: inserted.data[index].id,
      room_id: roomId
    }))
  );
  if (replies.error) throw replies.error;
  return inserted.data;
}

async function finalizeMedia(
  admin,
  {
    durationMs,
    file,
    height,
    kind,
    messageId,
    mimeType,
    owner,
    roomId,
    width
  }
) {
  const intentId = randomUUID();
  const extension = kind === "image" ? "jpg" : kind === "video" ? "mp4" : "m4a";
  const storagePath = `memories/${roomId}/${owner.userId}/${intentId}/source.${extension}`;
  const body = readFileSync(file);
  const maxBytes = kind === "image" ? 10 * 1024 * 1024 : kind === "video"
    ? 20 * 1024 * 1024
    : 8 * 1024 * 1024;
  const intent = await admin.from("shared_memory_upload_intents").insert({
    duration_ms: durationMs ?? null,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    extension,
    file_size_bytes: body.byteLength,
    id: intentId,
    image_height: height ?? null,
    image_width: width ?? null,
    max_file_size_bytes: maxBytes,
    media_type: kind,
    mime_type: mimeType,
    room_id: roomId,
    storage_path: storagePath,
    uploader_id: owner.userId,
    uploader_name: owner.username
  });
  if (intent.error) throw intent.error;
  const upload = await admin.storage.from("memory-media").upload(storagePath, body, {
    contentType: mimeType,
    upsert: false
  });
  if (upload.error) throw upload.error;
  const finalized = await admin.rpc("finalize_shared_memory_upload_intent", {
    p_file_size_bytes: body.byteLength,
    p_intent_id: intentId,
    p_message_id: messageId ?? null,
    p_moderated_at: new Date().toISOString(),
    p_moderation_reason: "synthetic_release_acceptance",
    p_moderation_status: "approved",
    p_now: new Date().toISOString(),
    p_position: 0
  });
  if (finalized.error) throw finalized.error;
  return storagePath;
}

async function seedMedia(admin, roomId, owner, messages) {
  const files = prepareMediaFiles();
  const storagePaths = [];
  // The fixture message author rotates through four participants. Media
  // integrity requires an attachment uploader to match the message author.
  const ownerMessages = messages.filter((_message, index) => index % 4 === 0);
  for (let index = 0; index < 32; index += 1) {
    const portrait = index % 2 === 0;
    storagePaths.push(await finalizeMedia(admin, {
      file: portrait ? files.portrait : files.landscape,
      height: portrait ? 108 : 72,
      kind: "image",
      messageId: index < 4 ? ownerMessages[index].id : null,
      mimeType: "image/jpeg",
      owner,
      roomId,
      width: portrait ? 72 : 128
    }));
  }
  for (let index = 0; index < 3; index += 1) {
    storagePaths.push(await finalizeMedia(admin, {
      durationMs: 2_000,
      file: files.video,
      height: 72,
      kind: "video",
      messageId: ownerMessages[4 + index].id,
      mimeType: "video/mp4",
      owner,
      roomId,
      width: 128
    }));
  }
  for (let index = 0; index < 3; index += 1) {
    storagePaths.push(await finalizeMedia(admin, {
      durationMs: 2_000,
      file: files.audio,
      kind: "audio",
      messageId: ownerMessages[7 + index].id,
      mimeType: "audio/mp4",
      owner,
      roomId
    }));
  }
  return storagePaths;
}

async function cleanup(admin, fixture) {
  if (fixture.storagePaths?.length) {
    await admin.storage.from("memory-media").remove(fixture.storagePaths);
  }
  for (const roomId of fixture.roomIds ?? []) {
    await admin.from("shared_memory_rooms").delete().eq("id", roomId);
  }
  for (const user of fixture.createdUsers ?? fixture.users ?? []) {
    await admin.from("profiles").delete().eq("id", user.userId);
    await admin.auth.admin.deleteUser(user.userId);
  }
}

async function cleanupOrphans(admin) {
  const profiles = await admin
    .from("profiles")
    .select("id,username")
    .like("username", "mrel_%");
  if (profiles.error) throw profiles.error;
  const usernames = (profiles.data ?? []).map((profile) => profile.username);
  const roomIds = [];
  if (usernames.length) {
    const rooms = await admin
      .from("shared_memory_rooms")
      .select("id")
      .in("created_by", usernames);
    if (rooms.error) throw rooms.error;
    roomIds.push(...(rooms.data ?? []).map((room) => room.id));
  }
  if (roomIds.length) {
    const photos = await admin
      .from("shared_memory_photos")
      .select("storage_path")
      .in("room_id", roomIds);
    if (photos.error) throw photos.error;
    const paths = (photos.data ?? []).map((photo) => photo.storage_path).filter(Boolean);
    if (paths.length) await admin.storage.from("memory-media").remove(paths);
    await admin.from("shared_memory_rooms").delete().in("id", roomIds);
  }
  for (const profile of profiles.data ?? []) {
    await admin.from("profiles").delete().eq("id", profile.id);
    await admin.auth.admin.deleteUser(profile.id);
  }
  return { rooms: roomIds.length, users: profiles.data?.length ?? 0 };
}

async function main() {
  const env = fixtureEnvironment();
  const admin = createClient(env.url, env.serviceKey, authOptions);
  if (process.argv.includes("--cleanup")) {
    if (!existsSync(manifestPath)) return;
    await cleanup(admin, JSON.parse(readFileSync(manifestPath, "utf8")));
    console.log(JSON.stringify({ status: "CLEANUP_PASS" }));
    return;
  }
  if (process.argv.includes("--cleanup-orphans")) {
    console.log(JSON.stringify({ ...(await cleanupOrphans(admin)), status: "CLEANUP_PASS" }));
    return;
  }
  mkdirSync(artifactDir, { recursive: true });
  const suffix = Date.now().toString(36).slice(-7);
  const existingOwnerUsername = process.env.MEMORY_RELEASE_OWNER_USERNAME?.trim();
  const owner = existingOwnerUsername
    ? await findExistingOwner(admin, existingOwnerUsername)
    : await createUser(admin, suffix, "owner");
  const participants = await Promise.all(
    ["guest1", "guest2", "guest3"].map((label) => createUser(admin, suffix, label))
  );
  const createdUsers = existingOwnerUsername
    ? participants
    : [owner, ...participants];
  const users = [owner, ...participants];
  const roomTitle = process.env.MEMORY_RELEASE_ROOM_TITLE?.trim() ||
    "Release acceptance A";
  const roomA = await createRoom(admin, owner, participants, roomTitle);
  const roomB = await createRoom(
    admin,
    owner,
    participants,
    `${roomTitle} alternate`,
    true
  );
  const table = await seedTable(admin, roomA, users);
  const messagesA = await seedMessages(admin, roomA, users, 85);
  await seedTable(admin, roomB, users);
  await seedMessages(admin, roomB, users, 24);
  const storagePaths = await seedMedia(admin, roomA, owner, messagesA);
  const fixture = {
    email: owner.email,
    counts: {
      audio: 3,
      dishes: table.dishes,
      images: 32,
      messages: 93,
      participants: users.length,
      rooms: 2,
      stops: table.stops,
      videos: 3
    },
    createdUsers,
    roomIds: [roomA, roomB],
    storagePaths,
    users
  };
  writeFileSync(manifestPath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify({
    counts: fixture.counts,
    email: fixture.email,
    manifestPath,
    status: "SEED_PASS"
  }, null, 2));
}

await main();
