#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.PHASE4_RUNTIME_NEXT_PORT ?? 3044);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MAILPIT_URL = "http://127.0.0.1:54324";
const INSTALL_ID = randomUUID();
const TEST_IP = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
const RATE_SECRET = "phase4-local-rate-hmac-key-material-64-characters-minimum-0123456789";
const OPERATOR_SECRET = "phase4-local-operator-secret-material-0123456789";
let nextProcess;

function localStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Local Supabase is not running");
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

function startNext(env) {
  nextProcess = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_RATE_LIMIT_HMAC_SECRET: RATE_SECRET,
      API_TRUSTED_PROXY_HOPS: "1",
      MOBILE_API_ALLOWED_ORIGINS: "https://admin.example.test",
      MOBILE_AUTH_REDIRECT_BASE: "circlebites://",
      MODERATION_OPERATOR_ID: "phase4-local-operator",
      MODERATION_OPERATOR_SECRET: OPERATOR_SECRET,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [nextProcess.stdout, nextProcess.stderr]) {
    stream.on("data", (chunk) => {
      const output = String(chunk);
      if (/\b(error|failed|fatal)\b/i.test(output)) process.stderr.write(output.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]"));
    });
  }
}

async function stopNext() {
  if (!nextProcess) return;
  nextProcess.kill("SIGTERM");
  await delay(600);
  if (nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
}

async function waitForNext() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/mobile/auth/email-otp`, { method: "OPTIONS" });
      if (response.status === 204) return;
    } catch {}
    await delay(350);
  }
  throw new Error("Next Phase 4 runtime server did not start");
}

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-FoodReview-Install-Id": INSTALL_ID,
    "X-Forwarded-For": TEST_IP,
    ...extra,
  };
}

async function request(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  return { body: await response.json().catch(() => null), response };
}

async function mailMessages() {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  if (!response.ok) throw new Error("Mailpit is unavailable");
  return (await response.json()).messages ?? [];
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) allStrings(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) allStrings(item, output);
  return output;
}

const env = localStatus();
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.url, env.serviceKey, options);
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(-10);
const email = `phase4.api.${suffix}@example.test`;
const missingEmail = `phase4.missing.${suffix}@example.test`;
let userId;
let otpCreatedUserId;

try {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Runtime actor creation failed");
  userId = created.data.user.id;
  const username = `p4_api_${suffix}`.slice(0, 20).toLowerCase();
  const profile = await admin.from("profiles").insert({
    account_status: "active", account_type: "public", deletion_started_at: null,
    first_name: "Api", id: userId, last_name: "PhaseFour", username,
  });
  if (profile.error) throw profile.error;
  const client = createClient(env.url, env.anonKey, options);
  const link = await admin.auth.admin.generateLink({ email, type: "magiclink" });
  if (link.error || !link.data.properties?.hashed_token) throw link.error ?? new Error("Runtime actor magiclink failed");
  const signed = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("Runtime actor sign-in failed");
  const token = signed.data.session.access_token;

  startNext(env);
  await waitForNext();

  const existing = await request("/api/mobile/auth/email-otp", {
    body: JSON.stringify({ email }), headers: headers(), method: "POST",
  });
  const missing = await request("/api/mobile/auth/email-otp", {
    body: JSON.stringify({ email: missingEmail }), headers: headers(), method: "POST",
  });
  assert.equal(existing.response.status, 202);
  assert.equal(missing.response.status, 202);
  assert.deepEqual(existing.body, missing.body);
  assert.deepEqual(existing.body, { ok: true });
  const otpUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  otpCreatedUserId = otpUsers.data.users.find((user) => user.email === missingEmail)?.id;
  console.log("PASS: existing and new email OTP request responses are identical");

  const oversized = await request("/api/mobile/auth/email-otp", {
    body: JSON.stringify({ email, padding: "x".repeat(2_000) }), headers: headers(), method: "POST",
  });
  assert.equal(oversized.response.status, 413);
  console.log("PASS: endpoint streaming body limit rejects oversized authentication input");

  const burstEmail = `phase4.burst.${suffix}@example.test`;
  const burst = [];
  for (let index = 0; index < 5; index += 1) burst.push(await request("/api/mobile/auth/email-otp", {
    body: JSON.stringify({ email: burstEmail }), headers: headers(), method: "POST",
  }));
  assert.equal(burst.slice(0, 4).every((result) => result.response.status === 202), true);
  assert.equal(burst[4].response.status, 429);
  assert.ok(Number(burst[4].response.headers.get("retry-after")) >= 1);
  console.log("PASS: anonymous subject burst is durably limited with Retry-After");

  const anonymousStatus = await request("/api/mobile/auth/account-status", { headers: headers() });
  const malformedStatus = await request("/api/mobile/auth/account-status", { headers: headers({ Authorization: "Bearer malformed" }) });
  const activeStatus = await request("/api/mobile/auth/account-status", { headers: headers({ Authorization: `Bearer ${token}` }) });
  assert.equal(anonymousStatus.response.status, 401);
  assert.equal(malformedStatus.response.status, 401);
  assert.deepEqual(activeStatus.body, { status: "active" });
  await admin.from("profiles").update({ account_status: "deleting", deletion_started_at: new Date().toISOString() }).eq("id", userId);
  const frozenStatus = await request("/api/mobile/auth/account-status", { headers: headers({ Authorization: `Bearer ${token}` }) });
  assert.deepEqual(frozenStatus.body, { status: "deleting" });
  await admin.from("profiles").update({ account_status: "active", deletion_started_at: null }).eq("id", userId);
  console.log("PASS: canonical actor distinguishes missing, malformed, active, and frozen identities");

  const disallowedCors = await fetch(`${BASE_URL}/api/mobile/auth/email-otp`, {
    headers: { Origin: "https://evil.example" }, method: "OPTIONS",
  });
  const allowedCors = await fetch(`${BASE_URL}/api/mobile/auth/email-otp`, {
    headers: { Origin: "https://admin.example.test" }, method: "OPTIONS",
  });
  assert.equal(disallowedCors.status, 403);
  assert.equal(allowedCors.status, 204);
  assert.equal(allowedCors.headers.get("access-control-allow-origin"), "https://admin.example.test");
  assert.equal(existing.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(existing.response.headers.get("x-frame-options"), "DENY");
  assert.equal(existing.response.headers.get("access-control-allow-origin"), null);
  console.log("PASS: sensitive CORS is allowlisted and API security headers are delivered");

  const providerAnonymous = await request("/api/places/autocomplete?q=pizza", { headers: headers() });
  assert.equal(providerAnonymous.response.status, 401);
  console.log("PASS: provider-backed API rejects anonymous cost amplification before provider access");

  const missingOperator = await request("/api/internal/moderation/reports");
  const wrongOperator = await request("/api/internal/moderation/reports", { headers: { "X-Moderation-Operator-Secret": "wrong" } });
  const operator = await request("/api/internal/moderation/reports?limit=1", {
    headers: { "X-Moderation-Operator-Secret": OPERATOR_SECRET },
  });
  assert.equal(missingOperator.response.status, 404);
  assert.equal(wrongOperator.response.status, 404);
  assert.equal(operator.response.status, 200);
  console.log("PASS: internal operator route fails opaquely and accepts only its dedicated configured authority");

  console.log("PASS: Phase 4 HTTP runtime validation completed (9 behavior groups)");
} finally {
  await stopNext();
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
  if (otpCreatedUserId) await admin.auth.admin.deleteUser(otpCreatedUserId);
}
