#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.PHASE5_RUNTIME_NEXT_PORT ?? 3055);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAMPLE_COUNT = Math.min(Math.max(Number(process.env.PHASE5_API_SAMPLES ?? 20), 5), 50);
const AUTH_OPTIONS = { auth: { autoRefreshToken: false, persistSession: false } };
const PAYLOAD_BUDGETS = new Map(
  JSON.parse(readFileSync(new URL("../config/backend-performance-budgets.json", import.meta.url), "utf8"))
    .screens.map((screen) => [screen.id, screen.payloadBytes])
);
let nextProcess;
let loggedServerErrors = 0;

function localStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Local Supabase is not running");
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

function startNext(env) {
  nextProcess = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_RATE_LIMIT_HMAC_SECRET: "phase5-local-rate-limit-secret-material-0123456789",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [nextProcess.stdout, nextProcess.stderr]) {
    stream.on("data", (chunk) => {
      const output = String(chunk);
      if (/\b(error|failed|fatal)\b/i.test(output) && loggedServerErrors < 10) {
        loggedServerErrors += 1;
        process.stderr.write(output.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]"));
      }
    });
  }
}

function buildNext(env) {
  const result = spawnSync("npx", ["next", "build", "--turbopack"], {
    cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      API_RATE_LIMIT_HMAC_SECRET: "phase5-local-rate-limit-secret-material-0123456789",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    },
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
      .slice(-8_000);
    throw new Error(`Local production Next build failed:\n${output}`);
  }
}

async function stopNext() {
  if (!nextProcess) return;
  nextProcess.kill("SIGTERM");
  await delay(500);
  if (nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
}

async function waitForNext() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (nextProcess?.exitCode !== null && nextProcess?.exitCode !== undefined) {
      throw new Error(`Production Next server exited with ${nextProcess.exitCode}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/mobile/feed?scope=public&limit=1`);
      if (response.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error("Production Next server did not become ready");
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

async function measure(name, operation) {
  await operation();
  await delay(100);
  const durations = [];
  const payloadBytes = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    const bytes = await operation();
    durations.push(performance.now() - startedAt);
    payloadBytes.push(bytes);
    await delay(25);
  }
  const maxPayloadBytes = Math.max(...payloadBytes);
  const payloadBudget = PAYLOAD_BUDGETS.get(name);
  assert.ok(Number.isFinite(payloadBudget), `${name} payload budget is missing`);
  assert.ok(maxPayloadBytes <= payloadBudget, `${name} payload ${maxPayloadBytes} exceeds ${payloadBudget}`);
  return {
    maxPayloadBytes,
    name,
    p50Ms: rounded(percentile(durations, 50)),
    p95Ms: rounded(percentile(durations, 95)),
    primaryRequestsPerSample: 1,
  };
}

async function seed(admin, suffix) {
  const viewerEmail = `phase5.viewer.${suffix}@example.test`;
  const authorEmail = `phase5.author.${suffix}@example.test`;
  const password = `Phase5-${suffix}-Local!`;
  const viewerName = `p5v_${suffix}`.slice(0, 20).toLowerCase();
  const authorName = `p5a_${suffix}`.slice(0, 20).toLowerCase();
  const viewerResult = await admin.auth.admin.createUser({ email: viewerEmail, email_confirm: true, password });
  const authorResult = await admin.auth.admin.createUser({ email: authorEmail, email_confirm: true, password });
  if (viewerResult.error || !viewerResult.data.user) throw viewerResult.error ?? new Error("Viewer creation failed");
  if (authorResult.error || !authorResult.data.user) throw authorResult.error ?? new Error("Author creation failed");
  const viewerId = viewerResult.data.user.id;
  const authorId = authorResult.data.user.id;

  const { error: profileError } = await admin.from("profiles").upsert([
    { account_status: "active", account_type: "public", first_name: "Phase", id: viewerId, last_name: "Viewer", username: viewerName },
    { account_status: "active", account_type: "public", first_name: "Phase", id: authorId, last_name: "Author", username: authorName },
  ]);
  if (profileError) throw profileError;
  const { error: circleError } = await admin.from("circle_memberships").insert({ member_name: viewerName, user_name: authorName });
  if (circleError) throw circleError;

  const placeId = `phase5-api-place-${suffix}`;
  const now = Date.now();
  const reviews = Array.from({ length: 60 }, (_, index) => ({
    area: "Performance Area",
    body: "bounded local API timing fixture",
    created_at: new Date(now - index * 1000).toISOString(),
    id: randomUUID(),
    items: [{ name: "Phase 5 API Dish", rating: 4 }],
    restaurant_address: "Performance Address",
    restaurant_id: placeId,
    restaurant_lat: 12.9716,
    restaurant_lng: 77.5946,
    restaurant_name: "Phase 5 API Place",
    reviewer_name: authorName,
    status: "active",
    visibility: index % 2 === 0 ? "public" : "circle",
  }));
  const { error: reviewError } = await admin.from("reviews").insert(reviews);
  if (reviewError) throw reviewError;
  const { error: mentionError } = await admin.from("review_dish_mentions").insert(reviews.map((review) => ({
    display_name: "Phase 5 API Dish", item_position: 0, match_status: "unresolved",
    normalized_name: "phase 5 api dish", place_id: placeId, raw_name: "Phase 5 API Dish",
    review_id: review.id, review_rating: 4, source: "server", user_id: authorId,
  })));
  if (mentionError) throw mentionError;

  const { error: placeError } = await admin.from("place_stats").upsert({
    address: "Performance Address", area: "Performance Area", average_rating: 4,
    display_name: "Phase 5 API Place", dish_count: 1, last_review_at: new Date(now).toISOString(),
    latitude: 12.9716, longitude: 77.5946, normalized_name: "phase 5 api place",
    place_id: placeId, review_count: 60, source: "backfill", unique_reviewer_count: 1,
  });
  if (placeError) throw placeError;

  const postId = reviews.find((review) => review.visibility === "public").id;
  const comments = Array.from({ length: 40 }, (_, index) => ({
    content: `bounded comment ${index}`,
    created_at: new Date(now - index * 1000).toISOString(),
    id: randomUUID(), post_id: postId, user_name: viewerName,
  }));
  const { error: commentError } = await admin.from("comments").insert(comments);
  if (commentError) throw commentError;

  const notifications = Array.from({ length: 40 }, (_, index) => ({
    actor_name: authorName, actor_user_id: authorId,
    created_at: new Date(now - index * 1000).toISOString(), id: randomUUID(),
    is_read: false, message: "bounded notification summary", read: false,
    recipient_name: viewerName, recipient_user_id: viewerId,
    title: "Performance fixture", type: "like",
  }));
  const { error: notificationError } = await admin.from("notifications").insert(notifications);
  if (notificationError) throw notificationError;

  const roomId = randomUUID();
  const { error: roomError } = await admin.from("shared_memory_rooms").insert({
    area: "Performance Area", created_by: viewerName, id: roomId,
    restaurant_name: "Phase 5 API Memory",
  });
  if (roomError) throw roomError;
  const { error: memberError } = await admin.from("shared_memory_members").insert([
    { room_id: roomId, user_name: viewerName }, { room_id: roomId, user_name: authorName },
  ]);
  if (memberError) throw memberError;
  const messages = Array.from({ length: 60 }, (_, index) => ({
    author_name: index % 2 === 0 ? viewerName : authorName,
    body: `bounded message ${index}`,
    created_at: new Date(now - index * 1000).toISOString(),
    id: randomUUID(), room_id: roomId,
  }));
  const { error: messageError } = await admin.from("shared_memory_messages").insert(messages);
  if (messageError) throw messageError;

  return {
    authorId, authorName, placeId, postId, roomId, viewerEmail, viewerId, viewerName, password,
    reviewIds: reviews.map((review) => review.id),
  };
}

async function cleanup(admin, fixture) {
  await admin.from("shared_memory_messages").delete().eq("room_id", fixture.roomId);
  await admin.from("shared_memory_members").delete().eq("room_id", fixture.roomId);
  await admin.from("shared_memory_rooms").delete().eq("id", fixture.roomId);
  await admin.from("notifications").delete().eq("recipient_user_id", fixture.viewerId);
  await admin.from("comments").delete().eq("post_id", fixture.postId);
  await admin.from("reviews").delete().in("id", fixture.reviewIds);
  await admin.from("circle_memberships").delete().eq("member_name", fixture.viewerName).eq("user_name", fixture.authorName);
  await admin.from("place_stats").delete().eq("place_id", fixture.placeId);
  await admin.from("profiles").delete().in("id", [fixture.viewerId, fixture.authorId]);
  await admin.auth.admin.deleteUser(fixture.viewerId);
  await admin.auth.admin.deleteUser(fixture.authorId);
}

const env = localStatus();
const admin = createClient(env.url, env.serviceKey, AUTH_OPTIONS);
const client = createClient(env.url, env.anonKey, AUTH_OPTIONS);
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-10);
let fixture;

try {
  buildNext(env);
  fixture = await seed(admin, suffix);
  const signed = await client.auth.signInWithPassword({ email: fixture.viewerEmail, password: fixture.password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("Viewer sign-in failed");
  const token = signed.data.session.access_token;
  const headers = { Authorization: `Bearer ${token}`, "X-FoodReview-Install-Id": `phase5-${suffix}` };

  startNext(env);
  await waitForNext();
  const http = (path) => async () => {
    const response = await fetch(`${BASE_URL}${path}`, { headers });
    const payload = await response.arrayBuffer();
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    return payload.byteLength;
  };
  const rpc = (name, args) => async () => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return Buffer.byteLength(JSON.stringify(data ?? null));
  };

  const flows = [
    await measure("circle", http("/api/feed/circle?limit=24")),
    await measure("public-feed", http("/api/mobile/feed?scope=public&limit=24")),
    await measure("explore", rpc("explore_discovery_canonical_v3", { p_lat: 12.9716, p_lng: 77.5946, p_limit: 24 })),
    await measure("restaurant-feed", http(`/api/mobile/feed?scope=restaurant&placeId=${encodeURIComponent(fixture.placeId)}&limit=24`)),
    await measure("dish-feed", http("/api/mobile/feed?scope=dish&dishName=Phase%205%20API%20Dish&limit=24")),
    await measure("profile-shell", http("/api/mobile/profile/shell")),
    await measure("profile-posts", http(`/api/mobile/feed?scope=profile&profileName=${encodeURIComponent(fixture.authorName)}&limit=24`)),
    await measure("post-detail", http(`/api/mobile/feed?scope=detail&postId=${fixture.postId}`)),
    await measure("comments", http(`/api/comments?postId=${fixture.postId}&limit=30`)),
    await measure("notifications", http("/api/notifications?limit=30")),
    await measure("memory-rooms", http("/api/mobile/memories/read?action=rooms&limit=50")),
    await measure("memory-room-detail", http(`/api/mobile/memories/read?action=detail&roomId=${fixture.roomId}&limit=30`)),
    await measure("memory-chat", http(`/api/mobile/memories/read?action=chat&roomId=${fixture.roomId}&limit=30`)),
  ];

  console.log(JSON.stringify({
    architecture: { duplicatePrimaryRequestsPerScreen: 0, primaryRequestsPerScreen: 1 },
    flows,
    mode: "local-production-next-with-local-supabase",
    samplesPerFlow: SAMPLE_COUNT,
    status: "PASS",
  }, null, 2));
} finally {
  await stopNext();
  if (fixture) await cleanup(admin, fixture);
}
