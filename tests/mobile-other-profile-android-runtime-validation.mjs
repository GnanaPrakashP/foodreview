#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile, spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const adb = process.env.ADB ?? "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const serial = process.env.ANDROID_SERIAL ?? "ZA223JVWG7";
const packageName = "com.circlebites.mobile.dev";
const apiPort = Number(process.env.ANDROID_PROFILE_API_PORT ?? 3025);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
  throw new Error("ANDROID_PROFILE_API_PORT must be a valid TCP port");
}
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const apkPath = process.env.ANDROID_APK_PATH ?? `${root}mobile/android/app/build/outputs/apk/release/app-release.apk`;
const outputPath = process.env.ANDROID_PROFILE_OUTPUT ?? "/private/tmp/other-profile-release-measurement.json";
const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };
let server;
let fixture;

function localStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error("Local Supabase is unavailable");
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
      .slice(-8_000);
    throw new Error(`${command} failed: ${output}`);
  }
  return result.stdout;
}

async function adbRun(args, allowFailure = false) {
  try {
    const result = await execFileAsync(adb, ["-s", serial, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw error;
  }
}

async function seed(admin) {
  const suffix = Date.now().toString(36).slice(-7);
  const viewerEmail = `profile-device-viewer-${suffix}@example.test`;
  const authorEmail = `profile-device-author-${suffix}@example.test`;
  const viewerName = `pdv_${suffix}`.slice(0, 20);
  const authorName = `pda_${suffix}`.slice(0, 20);
  const password = `Unused-${randomUUID()}!`;
  const viewer = await admin.auth.admin.createUser({ email: viewerEmail, email_confirm: true, password });
  const author = await admin.auth.admin.createUser({ email: authorEmail, email_confirm: true, password });
  if (viewer.error || !viewer.data.user || author.error || !author.data.user) {
    throw viewer.error ?? author.error ?? new Error("device_fixture_user_create_failed");
  }
  const viewerId = viewer.data.user.id;
  const authorId = author.data.user.id;
  const profileResult = await admin.from("profiles").upsert([
    { account_status: "active", account_type: "public", first_name: "Device", id: viewerId, last_name: "Viewer", username: viewerName },
    { account_status: "active", account_type: "public", first_name: "Device", id: authorId, last_name: "Author", username: authorName }
  ]);
  if (profileResult.error) throw profileResult.error;
  const membership = await admin.from("circle_memberships").insert({ member_name: viewerName, user_name: authorName });
  if (membership.error) throw membership.error;

  const now = Date.now();
  const reviews = Array.from({ length: 24 }, (_, index) => ({
    area: "Profile Performance Area",
    body: `Release profile post ${index + 1}`,
    created_at: new Date(now - index * 1000).toISOString(),
    id: randomUUID(),
    items: [{ name: `Profile Dish ${index + 1}`, rating: 4 }],
    restaurant_id: `profile-device-place-${index}`,
    restaurant_name: `Profile Place ${index + 1}`,
    reviewer_name: authorName,
    status: "active",
    visibility: "public"
  }));
  const reviewResult = await admin.from("reviews").insert(reviews);
  if (reviewResult.error) throw reviewResult.error;
  return { authorId, authorName, reviewIds: reviews.map((review) => review.id), viewerEmail, viewerId, viewerName };
}

async function cleanup(admin, value) {
  if (!value) return;
  await admin.from("reviews").delete().in("id", value.reviewIds);
  await admin.from("circle_memberships").delete().eq("member_name", value.viewerName).eq("user_name", value.authorName);
  await admin.from("profiles").delete().in("id", [value.viewerId, value.authorId]);
  await admin.auth.admin.deleteUser(value.viewerId);
  await admin.auth.admin.deleteUser(value.authorId);
}

async function waitForServer(serverOutput) {
  const deadline = Date.now() + 60_000;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited with ${server.exitCode}: ${serverOutput.join("").slice(-4_000)}`);
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/mobile/feed?scope=public&limit=1`);
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(300);
  }
  throw new Error(
    `Next production server did not become ready (${lastFailure}): ${serverOutput.join("").slice(-4_000)}`
  );
}

function startServer(env) {
  const output = [];
  server = spawn("npx", ["next", "start", "-p", String(apiPort)], {
    cwd: root,
    env: {
      ...process.env,
      API_PERFORMANCE_TRACE_ENABLED: "true",
      API_RATE_LIMIT_HMAC_SECRET: "profile-device-rate-limit-secret-material-0123456789",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => output.push(String(chunk).replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")));
  }
  return output;
}

function buildRelease(env) {
  const javaHome = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
  const keyStore = process.env.ANDROID_PROFILE_KEYSTORE ?? "/private/tmp/circlebites-profile-measurement.jks";
  const buildOptions = {
    cwd: `${root}mobile/android`,
    env: {
      ...process.env,
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
      EXPO_PUBLIC_APP_ENVIRONMENT: "development",
      EXPO_PUBLIC_PERFORMANCE_PROFILE: "1",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      EXPO_PUBLIC_SUPABASE_URL: env.url,
      JAVA_HOME: javaHome,
      NODE_ENV: "production"
    }
  };
  // React Native's Gradle bundle task does not reliably treat Expo public
  // environment changes as inputs. Clean only app outputs so this profile APK
  // cannot silently reuse a bundle pointing at another API or Supabase project.
  run("./gradlew", ["app:clean"], buildOptions);
  run("./gradlew", [
    "app:assembleRelease",
    `-Pandroid.injected.signing.store.file=${keyStore}`,
    "-Pandroid.injected.signing.store.password=profilemeasure",
    "-Pandroid.injected.signing.key.alias=profilemeasurement",
    "-Pandroid.injected.signing.key.password=profilemeasure"
  ], buildOptions);
}

function buildNext(env) {
  run("npx", ["next", "build", "--turbopack"], {
    env: {
      ...process.env,
      API_RATE_LIMIT_HMAC_SECRET: "profile-device-rate-limit-secret-material-0123456789",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    }
  });
}

async function uiXml() {
  await adbRun(["shell", "uiautomator", "dump", "/sdcard/profile-performance.xml"], true);
  return adbRun(["shell", "cat", "/sdcard/profile-performance.xml"], true);
}

function nodeBounds(xml, accessibleLabel) {
  const decoded = xml.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const node = decoded.match(/<node\b[^>]*>/g)?.find((value) => value.includes(`content-desc="${accessibleLabel}"`));
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) return null;
  return { x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2), y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2) };
}

async function waitForXml(match, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await uiXml();
    if (match(last.replaceAll("&apos;", "'"))) return last;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenSize() {
  const output = await adbRun(["shell", "wm", "size"]);
  const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const match = matches.at(-1);
  if (!match) throw new Error("Android screen size unavailable");
  return { height: Number(match[2]), width: Number(match[1]) };
}

function perfEvents(logcat) {
  return logcat.split("\n").flatMap((line) => {
    const payload = /CB_PERF\s+(\{.*\})/.exec(line)?.[1];
    if (!payload) return [];
    try { return [JSON.parse(payload)]; } catch { return []; }
  });
}

async function readPerfEvents() {
  return perfEvents(await adbRun(["logcat", "-d", "-v", "brief", "ReactNativeJS:I", "*:S"], true));
}

async function waitForPerf(name, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = (await readPerfEvents()).findLast((value) => value.name === name);
    if (event) return event;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${name}`);
}

function parseGfx(output) {
  return {
    jankyFrames: Number(/Janky frames:\s*(\d+)/.exec(output)?.[1] ?? 0),
    jankyPercent: Number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(output)?.[1] ?? 0),
    p95Ms: Number(/95th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    totalFrames: Number(/Total frames rendered:\s*(\d+)/.exec(output)?.[1] ?? 0)
  };
}

function endpointCount(serverOutput, from, endpoint) {
  const text = serverOutput.slice(from).join("");
  return [...text.matchAll(new RegExp(`endpoint["']?[:=]["']?${endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))].length;
}

async function waitForColdProfileEvidence(serverOutput, from) {
  const deadline = Date.now() + 10_000;
  let shellRequests = 0;
  let postsRequests = 0;
  let maxRenderedCards = 0;
  while (Date.now() < deadline) {
    shellRequests = endpointCount(serverOutput, from, "api/mobile/profiles/:username/shell");
    postsRequests = endpointCount(serverOutput, from, "api/mobile/feed");
    const events = await readPerfEvents();
    maxRenderedCards = Math.max(0, ...events
      .filter((event) => event.name === "profile.other.rendered_post_cards")
      .map((event) => Number(event.value) || 0));
    if (shellRequests === 1 && postsRequests === 1 && maxRenderedCards > 0) break;
    await delay(200);
  }
  return { maxRenderedCards, postsRequests, shellRequests };
}

async function openCircle(size) {
  await adbRun(["shell", "input", "tap", String(Math.round(size.width * 0.125)), String(size.height - 80)]);
  return waitForXml((xml) => xml.includes("Device Author") && xml.includes("shared a spot"), "Circle fixture feed");
}

async function tapAuthor(xml) {
  const point = nodeBounds(xml, "Open Device Author's profile");
  if (!point) throw new Error("Profile avatar accessibility target is missing");
  await adbRun(["shell", "input", "tap", String(point.x), String(point.y)]);
  return point;
}

async function backToCircle() {
  await adbRun(["shell", "input", "keyevent", "4"]);
  return waitForXml((xml) => xml.includes("Device Author") && xml.includes("shared a spot"), "Circle after back");
}

async function main() {
  const env = localStatus();
  const admin = createClient(env.url, env.serviceKey, authOptions);
  const skipAllBuilds = process.env.ANDROID_PROFILE_SKIP_BUILD === "1";
  if (!skipAllBuilds) {
    if (process.env.ANDROID_PROFILE_SKIP_ANDROID_BUILD !== "1") buildRelease(env);
    if (process.env.ANDROID_PROFILE_SKIP_NEXT_BUILD !== "1") buildNext(env);
  }
  if (process.env.ANDROID_PROFILE_BUILD_ONLY === "1") {
    console.log(JSON.stringify({ apkPath, status: "BUILD_ONLY_PASS" }, null, 2));
    return;
  }
  fixture = await seed(admin);
  const serverOutput = startServer(env);
  await waitForServer(serverOutput);
  const supabasePort = new URL(env.url).port;
  if (!supabasePort) throw new Error("Local Supabase URL must include a port");
  await adbRun(["reverse", `tcp:${apiPort}`, `tcp:${apiPort}`]);
  await adbRun(["reverse", `tcp:${supabasePort}`, `tcp:${supabasePort}`]);

  run(process.execPath, ["scripts/android-installed-profile-login.mjs", "--stop-server-after"], {
    env: {
      ...process.env,
      ANDROID_APP_PACKAGE: packageName,
      ANDROID_APP_ACTIVITY: "com.circlebites.mobile.MainActivity",
      ANDROID_APK_PATH: apkPath,
      ANDROID_LOGIN_EMAIL: fixture.viewerEmail,
      ANDROID_PROFILE_ARTIFACT_DIR: "/private/tmp/other-profile-android-login",
      ANDROID_PROFILE_SUCCESS_TEXT: "Device Viewer,Posts,Memories",
      ANDROID_SERIAL: serial,
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl
    }
  });

  const size = await screenSize();
  let circleXml = await openCircle(size);
  await adbRun(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
  await adbRun(["logcat", "-c"], true);
  const coldServerOffset = serverOutput.length;
  await tapAuthor(circleXml);
  const cold = await waitForPerf("profile.other.cold_shell_visible");
  await waitForXml((xml) => xml.includes("Device Author") && xml.includes(`@${fixture.authorName}`), "cold profile shell");
  const coldEvidence = await waitForColdProfileEvidence(serverOutput, coldServerOffset);
  const maxRenderedCards = coldEvidence.maxRenderedCards;
  const coldRequestCount = coldEvidence.shellRequests + coldEvidence.postsRequests;

  circleXml = await backToCircle();
  await adbRun(["logcat", "-c"], true);
  await tapAuthor(circleXml);
  const warm = await waitForPerf("profile.other.warm_shell_visible");
  await waitForXml((xml) => xml.includes(`@${fixture.authorName}`), "warm profile shell");

  circleXml = await backToCircle();
  await adbRun(["logcat", "-c"], true);
  await tapAuthor(circleXml);
  const reopen = await waitForPerf("profile.other.warm_shell_visible");
  await waitForXml((xml) => xml.includes(`@${fixture.authorName}`), "back-reopen profile shell");

  circleXml = await backToCircle();
  const rapidPoint = nodeBounds(circleXml, "Open Device Author's profile");
  if (!rapidPoint) throw new Error("Rapid-tap accessibility target is missing");
  await adbRun(["logcat", "-c"], true);
  await Promise.all(Array.from({ length: 5 }, () => adbRun([
    "shell", "input", "tap", String(rapidPoint.x), String(rapidPoint.y)
  ])));
  await waitForXml((xml) => xml.includes(`@${fixture.authorName}`), "rapid-tap profile shell");
  await adbRun(["shell", "input", "keyevent", "4"]);
  const afterSingleBack = await waitForXml(
    (xml) => xml.includes("Device Author") && xml.includes("shared a spot"),
    "Circle after one Back press from rapid taps",
    5_000
  );
  const duplicatePushGuardPassed = afterSingleBack.includes("Device Author")
    && afterSingleBack.includes("shared a spot");
  const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));

  assert.deepEqual(
    { posts: coldEvidence.postsRequests, shell: coldEvidence.shellRequests },
    { posts: 1, shell: 1 },
    `cold mobile visit request ownership was ${JSON.stringify(coldEvidence)}`
  );
  assert.ok(maxRenderedCards > 0 && maxRenderedCards < 24, `warm list mounted ${maxRenderedCards} cards`);
  assert.equal(duplicatePushGuardPassed, true, "one Back press did not leave the rapidly-opened profile");

  const report = {
    build: { packageName, type: "minified Android release/profile", device: serial },
    coldAvatarTapToShellMs: cold.durationMs,
    warmAvatarTapToShellMs: warm.durationMs,
    backReopenSameProfileMs: reopen.durationMs,
    coldProfileRequestCount: coldRequestCount,
    profilePostFixtureCount: 24,
    maximumSynchronouslyMountedPostCards: maxRenderedCards,
    rapidRepeatedTaps: { attempts: 5, duplicatePushGuardPassed },
    rendering: gfx,
    status: "PASS"
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await cleanup(admin, fixture);
  fixture = null;
}

try {
  await main();
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  if (fixture) {
    const env = localStatus();
    await cleanup(createClient(env.url, env.serviceKey, authOptions), fixture).catch(() => {});
  }
}
