#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const adb = process.env.ADB ?? "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const serial = process.env.ANDROID_SERIAL ?? "ZA223JVWG7";
const packageName = "com.circlebites.mobile.dev";
const apiPort = Number(process.env.ANDROID_MEMORY_API_PORT ?? 3036);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const metroPort = Number(process.env.ANDROID_MEMORY_METRO_PORT ?? 8084);
const metroBaseUrl = `http://127.0.0.1:${metroPort}`;
const fixturePort = Number(process.env.ANDROID_MEMORY_FIXTURE_PORT ?? 3037);
const fixtureBaseUrl = `http://127.0.0.1:${fixturePort}`;
const scenario = process.env.ANDROID_MEMORY_SCENARIO ?? "full";
const mediaKind = process.env.ANDROID_MEMORY_MEDIA_KIND ?? "image";
const artifactDir = process.env.ANDROID_MEMORY_ARTIFACT_DIR ??
  "/private/tmp/memory-chat-visual-android";
const apkPath = `${root}mobile/android/app/build/outputs/apk/debug/app-debug.apk`;
const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };
let fixture;
let fixtureServer;
let mediaWorkerOutput = [];
let mediaPumpBusy = false;
let mediaPumpTimer;
let metro;
let placementLogger;
let placementLineBuffer = "";
let placementEventStream = [];
let server;
let recorder;
let serverOutput = [];
const mediaWorkerSecret = "memory-visual-media-worker-secret-material-0123456789";

function localStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error("Local Supabase is unavailable");
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

function safeOutput(value) {
  return String(value ?? "")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(-8_000);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${safeOutput(result.stdout)}\n${safeOutput(result.stderr)}`);
  }
  return result.stdout;
}

async function adbRun(args, allowFailure = false, timeout = 30_000) {
  try {
    const result = await execFileAsync(adb, ["-s", serial, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      timeout
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw error;
  }
}

async function readConnectedDevice() {
  const [manufacturer, model, release, inputMethod] = await Promise.all([
    adbRun(["shell", "getprop", "ro.product.manufacturer"]),
    adbRun(["shell", "getprop", "ro.product.model"]),
    adbRun(["shell", "getprop", "ro.build.version.release"]),
    adbRun(["shell", "settings", "get", "secure", "default_input_method"])
  ]);
  const keyboard = inputMethod.includes("com.google.android.inputmethod.latin")
    ? "Gboard"
    : inputMethod.trim().slice(0, 80);
  return {
    keyboard,
    manufacturer: manufacturer.trim().slice(0, 40),
    model: model.trim().slice(0, 80),
    os: `Android ${release.trim().slice(0, 20)}`
  };
}

async function seed(admin) {
  const suffix = Date.now().toString(36).slice(-7);
  const email = `memory-visual-${suffix}@example.test`;
  const username = `mvv_${suffix}`.slice(0, 20);
  const user = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("fixture_user_create_failed");
  const userId = user.data.user.id;
  const profile = await admin.from("profiles").upsert({
    account_status: "active",
    account_type: "public",
    first_name: "Device",
    id: userId,
    last_name: "Visual",
    username
  });
  if (profile.error) throw profile.error;
  const room = await admin.from("shared_memory_rooms").insert({
    area: "Synthetic device fixture",
    created_by: username,
    restaurant_name: "Synthetic table",
    status: "published",
    title: "Visual validation"
  }).select("id").single();
  if (room.error) throw room.error;
  const roomId = room.data.id;
  const member = await admin.from("shared_memory_members").insert({
    role: "owner",
    room_id: roomId,
    user_name: username
  });
  if (member.error) throw member.error;
  const baseline = await admin.from("shared_memory_messages").insert({
    author_name: username,
    body: "Fixture ready",
    room_id: roomId
  });
  if (baseline.error) throw baseline.error;
  return { email, roomId, userId, username };
}

async function cleanup(admin, value) {
  if (!value) return;
  await admin.from("shared_memory_rooms").delete().eq("id", value.roomId);
  await admin.from("profiles").delete().eq("id", value.userId);
  await admin.auth.admin.deleteUser(value.userId);
}

function startServer(env) {
  const output = [];
  serverOutput = output;
  server = spawn("npm", ["run", "dev", "--", "-p", String(apiPort)], {
    cwd: root,
    env: {
      ...process.env,
      API_RATE_LIMIT_HMAC_SECRET: "memory-visual-rate-limit-secret-material-0123456789",
      MEDIA_WORKER_SECRET: mediaWorkerSecret,
      MEMORY_CHAT_DEV_CONFIRM_DELAY_MS: scenario === "full" || scenario === "tail" ? "2500" : "0",
      MEMORY_CHAT_DEV_PRE_INSERT_DELAY_MS: scenario === "stale" ? "4000" : "0",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceKey
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => output.push(safeOutput(chunk)));
  }
  return output;
}

function prepareSyntheticMediaFixtures() {
  const imagePath = `${artifactDir}/image.png`;
  const videoPath = `${artifactDir}/video.mp4`;
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x4C7DFF:s=64x64:d=0.1",
    "-frames:v", "1", imagePath
  ]);
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0xE66A3C:s=64x64:d=1",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", videoPath
  ]);
  const assets = new Map([
    ["/image.png", { body: readFileSync(imagePath), contentType: "image/png" }],
    ["/video.mp4", { body: readFileSync(videoPath), contentType: "video/mp4" }]
  ]);
  fixtureServer = createServer((request, response) => {
    const asset = assets.get(request.url ?? "");
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": asset.body.byteLength,
      "Content-Type": asset.contentType
    });
    response.end(asset.body);
  });
  return new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(fixturePort, "127.0.0.1", resolve);
  });
}

function startSyntheticMediaProcessingPump(admin) {
  const tick = async () => {
    if (mediaPumpBusy || !fixture) return;
    mediaPumpBusy = true;
    try {
      const assets = await admin
        .from("media_assets")
        .select("id,moderation_status")
        .eq("owner_id", fixture.userId)
        .eq("surface", "memory");
      if (assets.error) throw assets.error;
      for (const asset of assets.data ?? []) {
        if (asset.moderation_status !== "pending") continue;
        const moderation = await admin.rpc("apply_media_moderation_action", {
          p_action: "approved",
          p_asset_id: asset.id,
          p_operator_hash: "a".repeat(64),
          p_reason_code: "synthetic_physical_placement_fixture"
        });
        if (moderation.error) throw moderation.error;
      }
      const response = await fetch(`${apiBaseUrl}/api/internal/media/process`, {
        body: JSON.stringify({ limit: 5, workerId: "physical-placement-fixture" }),
        headers: {
          Authorization: `Bearer ${mediaWorkerSecret}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(`media_processing_pump_${response.status}`);
      }
      mediaWorkerOutput.push(`${JSON.stringify({
        processed: payload.processed ?? 0,
        succeeded: payload.succeeded ?? 0
      })}\n`);
    } catch (error) {
      mediaWorkerOutput.push(`${error instanceof Error ? error.message : "media_processing_pump_failed"}\n`);
    } finally {
      mediaPumpBusy = false;
    }
  };
  mediaPumpTimer = setInterval(() => void tick(), 1_000);
  void tick();
}

async function waitForServer(output) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited with ${server.exitCode}: ${output.join("").slice(-4_000)}`);
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/health`);
      if (response.status < 500) return;
    } catch {
      // Retry until the bounded deadline.
    }
    await delay(300);
  }
  throw new Error("Next development server did not become ready");
}

function buildInstrumentedAndroid(env) {
  const buildEnv = {
    ...process.env,
    ANDROID_HOME: "/opt/homebrew/share/android-commandlinetools",
    ANDROID_SDK_ROOT: "/opt/homebrew/share/android-commandlinetools",
    EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
    EXPO_PUBLIC_APP_ENVIRONMENT: "development",
    EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS: "1",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
    EXPO_PUBLIC_SUPABASE_URL: env.url,
    JAVA_HOME: "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    NODE_ENV: "production"
  };
  run("./gradlew", [
    "app:clean",
    "app:assembleDebug",
    "-PcircleBitesBundleDebugJs=true"
  ], { cwd: `${root}mobile/android`, env: buildEnv });
}

function startInstrumentedMetro(env) {
  const output = [];
  metro = spawn("npx", [
    "expo",
    "start",
    "--dev-client",
    "--host", "localhost",
    "--port", String(metroPort),
    "--clear"
  ], {
    cwd: `${root}mobile`,
    env: {
      ...process.env,
      CI: "1",
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
      EXPO_PUBLIC_APP_ENVIRONMENT: "development",
      EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS: "1",
      EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_KINDS: scenario === "media" ? mediaKind : "",
      EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_ORIGIN: scenario === "media" ? fixtureBaseUrl : "",
      EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_START_MS: scenario === "media" ? "5000" : "",
      EXPO_PUBLIC_CHAT_PLACEMENT_STALE_REFRESH_MS: scenario === "stale" ? "400" : "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
      EXPO_PUBLIC_SUPABASE_URL: env.url,
      NODE_ENV: "development"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [metro.stdout, metro.stderr]) {
    stream.on("data", (chunk) => output.push(safeOutput(chunk)));
  }
  return output;
}

async function waitForMetro(output) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (metro.exitCode !== null) {
      throw new Error(`Metro exited with ${metro.exitCode}: ${output.join("").slice(-4_000)}`);
    }
    try {
      const response = await fetch(`${metroBaseUrl}/status`);
      if (response.ok && (await response.text()).includes("packager-status:running")) return;
    } catch {
      // Retry until the bounded deadline.
    }
    await delay(300);
  }
  throw new Error(`Metro did not become ready: ${output.join("").slice(-4_000)}`);
}

async function uiXml() {
  await adbRun(["shell", "uiautomator", "dump", "/sdcard/memory-visual.xml"], true);
  return adbRun(["shell", "cat", "/sdcard/memory-visual.xml"], true);
}

function decodedXml(xml) {
  return xml
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&");
}

function pointFor(xml, labels) {
  const nodes = decodedXml(xml).match(/<node\b[^>]*>/g) ?? [];
  for (const label of labels) {
    const lower = label.toLowerCase();
    const node = nodes.find((value) => {
      const text = /text="([^"]*)"/.exec(value)?.[1]?.toLowerCase() ?? "";
      const description = /content-desc="([^"]*)"/.exec(value)?.[1]?.toLowerCase() ?? "";
      return text === lower || description === lower || text.includes(lower) || description.includes(lower);
    });
    const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (bounds) {
      return {
        x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
        y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)
      };
    }
  }
  return null;
}

async function waitForPoint(labels, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await uiXml();
    const point = pointFor(last, labels);
    if (point) return { point, xml: last };
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function tap(point) {
  await adbRun(["shell", "input", "tap", String(point.x), String(point.y)]);
}

async function navigateToChat() {
  let target = await waitForPoint(["Memories"], "Profile Memories tab");
  await tap(target.point);
  target = await waitForPoint(["Visual validation"], "synthetic Memory Room");
  await tap(target.point);
  target = await waitForPoint(["Chat"], "Memory Room Chat tab");
  await tap(target.point);
  const input = await waitForPoint(["Type a message"], "chat composer");
  const send = await waitForPoint(["Record audio message"], "chat send/microphone button");
  return { input: input.point, send: send.point };
}

function inputTextArgument(value) {
  return value.replaceAll(" ", "%s");
}

async function sendText(value, options = {}) {
  const input = await waitForPoint(["Type a message"], "live chat composer");
  await tap(input.point);
  await adbRun(["shell", "input", "text", inputTextArgument(value)]);
  if (options.pauseMs) await delay(options.pauseMs);
  const send = await waitForPoint(["Send message"], "live send button");
  await tap(send.point);
}

async function waitForObservedSendPress(count, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (placementEventStream.filter((event) => event.name === "SEND_PRESS").length >= count) {
      return true;
    }
    await delay(25);
  }
  return false;
}

async function sendRapidTextBurst(
  values,
  knownSendPoint = null,
  settleSeconds = 0.10,
  acknowledgeEach = false
) {
  assert.ok(values.length > 0, "rapid text burst requires at least one value");
  assert.ok(
    settleSeconds >= 0.05 && settleSeconds <= 0.75,
    "rapid text settle interval must stay within the physical burst budget"
  );
  for (const value of values) {
    assert.match(value, /^[A-Za-z0-9]+$/, "rapid text fixture must remain shell-safe synthetic text");
  }

  const input = await waitForPoint(["Type a message"], "live rapid chat composer");
  await tap(input.point);
  const remaining = [...values];
  let sendPoint = knownSendPoint;
  const commands = [];

  if (acknowledgeEach) {
    for (const value of remaining) {
      const expectedCount =
        placementEventStream.filter((event) => event.name === "SEND_PRESS").length + 1;
      await adbRun(["shell", "input", "text", inputTextArgument(value)]);
      await delay(80);
      if (!sendPoint) {
        sendPoint = (await waitForPoint(["Send message"], "acknowledged rapid send button")).point;
      }
      await tap(sendPoint);
      if (await waitForObservedSendPress(expectedCount, 1_500)) continue;

      // Under a saturated instrumented list Android can discard an injected
      // tap before dispatch. Do not type the next identical fixture into the
      // uncleared composer: prove the button is still Send, then retry only
      // that same physical press.
      sendPoint = (await waitForPoint(["Send message"], "retryable rapid send button")).point;
      await tap(sendPoint);
      assert.equal(
        await waitForObservedSendPress(expectedCount, 3_000),
        true,
        "acknowledged rapid send did not reach SEND_PRESS"
      );
    }
    return sendPoint;
  }

  if (!sendPoint) {
    const first = remaining.shift();
    await adbRun(["shell", "input", "text", inputTextArgument(first)]);
    sendPoint = (await waitForPoint(["Send message"], "live rapid send button")).point;
    commands.push(`input tap ${sendPoint.x} ${sendPoint.y}`, `sleep ${settleSeconds.toFixed(2)}`);
  }

  for (const value of remaining) {
    commands.push(
      `input text ${inputTextArgument(value)}`,
      "sleep 0.08",
      `input tap ${sendPoint.x} ${sendPoint.y}`,
      `sleep ${settleSeconds.toFixed(2)}`
    );
  }
  await adbRun(["shell", commands.join("; ")]);
  return sendPoint;
}

async function sendMultiline() {
  const input = await waitForPoint(["Type a message"], "live multiline composer");
  await tap(input.point);
  await adbRun(["shell", "input", "text", "Line1"]);
  await adbRun(["shell", "input", "keyevent", "66"]);
  await adbRun(["shell", "input", "text", "Line2"]);
  const send = await waitForPoint(["Send message"], "live multiline send button");
  await tap(send.point);
}

async function sendDoubleTapText(value) {
  const input = await waitForPoint(["Type a message"], "live double-tap composer");
  await tap(input.point);
  await adbRun(["shell", "input", "text", inputTextArgument(value)]);
  const send = await waitForPoint(["Send message"], "live double-tap send button");
  await adbRun([
    "shell",
    `input tap ${send.point.x} ${send.point.y}; sleep 0.05; input tap ${send.point.x} ${send.point.y}`
  ]);
}

async function assertDoubleTapStayedInTextMode() {
  await delay(2_500);
  const xml = await uiXml();
  const enteredVoice =
    pointFor(xml, ["Cancel audio message"]) ||
    pointFor(xml, ["Allow CircleBites Dev to record audio?"]);
  assert.equal(enteredVoice, null, "double tap transitioned the send control into voice");
  assert.ok(pointFor(xml, ["Type a message"]), "text composer disappeared after double tap");
}

async function sendVoiceMessage() {
  const record = await waitForPoint(["Record audio message"], "record audio button");
  await tap(record.point);
  const ready = await waitForPoint(
    ["Cancel audio message", "While using the app"],
    "audio recorder or microphone permission"
  );
  if (pointFor(ready.xml, ["While using the app"])) {
    await tap(pointFor(ready.xml, ["While using the app"]));
  }
  await waitForPoint(["Cancel audio message"], "active audio recorder");
  await delay(1_300);
  const send = await waitForPoint(["Send audio message"], "send audio button");
  await tap(send.point);
}

function placementEvents(logcat) {
  return logcat.split("\n").flatMap((line) => {
    const payload = /CB_CHAT_PLACEMENT\s+(\{.*\})/.exec(line)?.[1];
    if (!payload) return [];
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function startPlacementLogger() {
  placementEventStream = [];
  placementLineBuffer = "";
  placementLogger = spawn(adb, [
    "-s", serial,
    "logcat",
    "-v", "brief",
    "ReactNativeJS:I",
    "*:S"
  ], { stdio: ["ignore", "pipe", "ignore"] });
  placementLogger.stdout.on("data", (chunk) => {
    placementLineBuffer += String(chunk);
    const lines = placementLineBuffer.split("\n");
    placementLineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      placementEventStream.push(...placementEvents(line));
    }
  });
}

async function readPlacementEvents() {
  return placementEventStream.slice();
}

async function waitForSendCount(count, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readPlacementEvents();
    if (events.filter((event) => event.name === "SEND_PRESS").length >= count) return events;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${count} instrumented sends`);
}

async function waitForClientEvent(clientId, name, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readPlacementEvents();
    if (events.some((event) => event.clientId === clientId && event.name === name)) return events;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${name}`);
}

async function waitForAllConfirmations(clientIds, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readPlacementEvents();
    const complete = clientIds.every((clientId) => {
      const lifecycle = events.filter((event) => event.clientId === clientId);
      return lifecycle.some((event) => event.name === "HTTP_CONFIRMED") &&
        lifecycle.some((event) => event.name === "REALTIME_CONFIRMED");
    });
    if (complete) return events;
    await delay(250);
  }
  throw new Error("Timed out waiting for all logical sends to confirm");
}

function coordinateChangesAfter(events, clientIds, afterIndex) {
  return clientIds.map((clientId) => {
    const before = events.slice(0, afterIndex + 1).findLast((event) => (
      event.clientId === clientId && event.name === "ROW_LAYOUT"
    ));
    const after = events.slice(afterIndex + 1).filter((event) => (
      event.clientId === clientId && event.name === "ROW_LAYOUT"
    ));
    return {
      clientId: `${clientId.slice(0, 8)}…`,
      changes: before
        ? after.filter((event) => (
          Math.abs(event.rowTop - before.rowTop) > 0.5 ||
          Math.abs(event.rowBottom - before.rowBottom) > 0.5 ||
          Math.abs(event.rowHeight - before.rowHeight) > 0.5
        )).length
        : 0,
      layoutCallbacks: after.length
    };
  });
}

function assertFollowingBottom(events, label) {
  const offset = events.findLast((event) => typeof event.contentOffset === "number")?.contentOffset;
  assert.ok(Number.isFinite(offset), `${label} did not expose a content offset`);
  assert.ok(
    Math.abs(offset) <= 2,
    `${label} left the inverted viewport ${offset}px away from the newest row`
  );
  return offset;
}

function scenarioSummary(events, clientIds, confirmationWindowEnds = new Map()) {
  return clientIds.map((clientId) => {
    const lifecycle = events.filter((event) => event.clientId === clientId);
    const firstConfirmedIndex = events.findIndex((event) => (
      event.clientId === clientId &&
      (event.name === "HTTP_CONFIRMED" || event.name === "REALTIME_CONFIRMED")
    ));
    const nextOptimisticIndex = firstConfirmedIndex < 0
      ? -1
      : events.findIndex((event, index) => (
        index > firstConfirmedIndex && event.name === "OPTIMISTIC_ENTITY_INSERTED"
      ));
    const nextDataWindowEnd = nextOptimisticIndex < 0 ? events.length : nextOptimisticIndex;
    const confirmationWindowEnd = Math.min(
      nextDataWindowEnd,
      confirmationWindowEnds.get(clientId) ?? events.length
    );
    const layoutBeforeConfirmation = firstConfirmedIndex < 0
      ? null
      : events.slice(0, firstConfirmedIndex).findLast((event) => (
        event.clientId === clientId && event.name === "ROW_LAYOUT"
      )) ?? null;
    const confirmationLayouts = firstConfirmedIndex < 0
      ? []
      : events.slice(firstConfirmedIndex + 1, confirmationWindowEnd).filter((event) => (
        event.clientId === clientId && event.name === "ROW_LAYOUT"
      ));
    const confirmationCoordinateChanges = layoutBeforeConfirmation
      ? confirmationLayouts.filter((event) => (
        Math.abs(event.rowTop - layoutBeforeConfirmation.rowTop) > 0.5 ||
        Math.abs(event.rowBottom - layoutBeforeConfirmation.rowBottom) > 0.5 ||
        Math.abs(event.rowHeight - layoutBeforeConfirmation.rowHeight) > 0.5
      )).length
      : 0;
    const confirmationMounts = firstConfirmedIndex < 0
      ? 0
      : events.slice(firstConfirmedIndex + 1, confirmationWindowEnd).filter((event) => (
        event.clientId === clientId && event.name === "ROW_MOUNTED"
      )).length;
    const press = lifecycle.find((event) => event.name === "SEND_PRESS");
    const firstLayout = lifecycle.find((event) => event.name === "ROW_LAYOUT");
    const finalLayout = lifecycle.findLast((event) => event.name === "ROW_LAYOUT");
    const offsets = lifecycle
      .map((event) => event.contentOffset)
      .filter((value) => typeof value === "number");
    return {
      clientId: `${clientId.slice(0, 8)}…`,
      confirmationOrder: lifecycle
        .filter((event) => event.name === "HTTP_CONFIRMED" || event.name === "REALTIME_CONFIRMED")
        .map((event) => event.name),
      contentOffsetAfter: offsets.at(-1) ?? null,
      contentOffsetBefore: offsets[0] ?? null,
      confirmationCoordinateChanges,
      confirmationLayoutCallbacks: confirmationLayouts.length,
      confirmationMounts,
      framesToFirstLayout: press && firstLayout
        ? Math.max(0, Math.ceil((firstLayout.eventTimestamp - press.eventTimestamp) / (1000 / 60)))
        : null,
      framesToFinalLayout: press && finalLayout
        ? Math.max(0, Math.ceil((finalLayout.eventTimestamp - press.eventTimestamp) / (1000 / 60)))
        : null,
      layoutCount: lifecycle.filter((event) => event.name === "ROW_LAYOUT").length,
      mountCount: lifecycle.filter((event) => event.name === "ROW_MOUNTED").length,
      renderCount: lifecycle.filter((event) => event.name === "ROW_RENDERED").length,
      scrollCommandCount: lifecycle.filter((event) => event.name === "BOTTOM_FOLLOW_REQUESTED").length
    };
  });
}

function parseGfx(output) {
  return {
    jankyFrames: Number(/Janky frames:\s*(\d+)/.exec(output)?.[1] ?? 0),
    jankyPercent: Number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(output)?.[1] ?? 0),
    p95Ms: Number(/95th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    totalFrames: Number(/Total frames rendered:\s*(\d+)/.exec(output)?.[1] ?? 0)
  };
}

async function startRecording() {
  const remote = "/sdcard/memory-chat-visual.mp4";
  await adbRun(["shell", "rm", remote], true);
  recorder = spawn(adb, [
    "-s", serial,
    "shell", "screenrecord",
    "--bit-rate", "20000000",
    "--time-limit", "180",
    remote
  ], { stdio: "ignore" });
  await delay(400);
  return remote;
}

async function stopRecording(remote) {
  if (recorder?.exitCode === null) recorder.kill("SIGINT");
  await delay(800);
  await adbRun(["pull", remote, `${artifactDir}/memory-chat-visual.mp4`], false, 60_000);
  await adbRun(["shell", "rm", remote], true);
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  assert.ok(["full", "media", "stale", "tail"].includes(scenario), `Unsupported scenario: ${scenario}`);
  assert.ok(["image", "video"].includes(mediaKind), `Unsupported media kind: ${mediaKind}`);
  const device = await readConnectedDevice();
  if (scenario === "media") await prepareSyntheticMediaFixtures();
  const env = localStatus();
  const admin = createClient(env.url, env.serviceKey, authOptions);
  if (process.env.ANDROID_MEMORY_SKIP_BUILD !== "1") buildInstrumentedAndroid(env);
  fixture = await seed(admin);
  const output = startServer(env);
  await waitForServer(output);
  if (scenario === "media") startSyntheticMediaProcessingPump(admin);
  const metroOutput = startInstrumentedMetro(env);
  await waitForMetro(metroOutput);

  const supabasePort = new URL(env.url).port;
  await adbRun(["reverse", `tcp:${apiPort}`, `tcp:${apiPort}`]);
  await adbRun(["reverse", `tcp:${supabasePort}`, `tcp:${supabasePort}`]);
  await adbRun(["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
  if (scenario === "media") {
    await adbRun(["reverse", `tcp:${fixturePort}`, `tcp:${fixturePort}`]);
  }
  run(process.execPath, ["scripts/android-installed-profile-login.mjs", "--stop-server-after"], {
    env: {
      ...process.env,
      ANDROID_APP_ACTIVITY: "com.circlebites.mobile.MainActivity",
      ANDROID_APP_LAUNCH_URL:
        `circlebites-dev://expo-development-client/?url=${encodeURIComponent(metroBaseUrl)}`,
      ANDROID_APP_PACKAGE: packageName,
      ANDROID_APK_PATH: apkPath,
      ANDROID_LOGIN_EMAIL: fixture.email,
      ANDROID_PROFILE_GRANT_LOCATION: "1",
      ANDROID_PROFILE_ARTIFACT_DIR: `${artifactDir}/login`,
      ANDROID_PROFILE_SUCCESS_TEXT: "Device Visual,Posts,Memories",
      ANDROID_SERIAL: serial,
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl
    }
  });

  await adbRun(["shell", "pm", "grant", packageName, "android.permission.RECORD_AUDIO"], true);
  let remoteRecording;
  if (scenario === "media") {
    // The diagnostic fixture starts shortly after Chat becomes active. Attach
    // the event/video collectors before entering the tab so SEND_PRESS cannot
    // race logcat startup on a warm device.
    await adbRun(["logcat", "-c"]);
    startPlacementLogger();
    await adbRun(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
    remoteRecording = await startRecording();
    await navigateToChat();
  } else {
    await navigateToChat();
    await adbRun(["logcat", "-c"]);
    startPlacementLogger();
    await adbRun(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
    remoteRecording = await startRecording();
  }

  if (scenario === "stale") {
    await sendText("S");
    let events = await waitForSendCount(1, 15_000);
    const clientId = events.find((event) => event.name === "SEND_PRESS")?.clientId;
    assert.ok(clientId, "stale refresh send did not expose a logical client id");
    events = await waitForClientEvent(clientId, "STALE_REFRESH_RESOLVED", 20_000);
    events = await waitForClientEvent(clientId, "REALTIME_CONFIRMED", 20_000);
    events = await waitForClientEvent(clientId, "HTTP_CONFIRMED", 20_000);
    await delay(1_000);
    events = await readPlacementEvents();
    const lifecycle = events.filter((event) => event.clientId === clientId);
    const eventOrder = lifecycle.map((event) => event.name);
    const stale = scenarioSummary(events, [clientId]);
    const row = await admin
      .from("shared_memory_messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", fixture.roomId)
      .eq("client_id", clientId);
    if (row.error) throw row.error;
    const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
    await stopRecording(remoteRecording);
    writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`);

    assert.ok(
      eventOrder.indexOf("OPTIMISTIC_ENTITY_INSERTED") < eventOrder.indexOf("STALE_REFRESH_REQUESTED"),
      "stale refresh started before optimistic insertion"
    );
    assert.ok(
      eventOrder.indexOf("STALE_REFRESH_RESOLVED") < eventOrder.indexOf("REALTIME_CONFIRMED"),
      "stale refresh did not resolve before the server insert"
    );
    assert.equal(row.count, 1, "stale refresh path persisted a duplicate logical row");
    assert.equal(stale[0]?.mountCount, 1, "stale refresh remounted the optimistic row");
    assert.equal(stale[0]?.scrollCommandCount, 0, "stale refresh issued a bottom-follow command");
    assert.equal(
      stale[0]?.confirmationCoordinateChanges,
      0,
      "stale refresh or confirmation moved the optimistic row"
    );

    const report = {
      artifact: `${artifactDir}/memory-chat-visual.mp4`,
      databaseRowsForLogicalSend: row.count,
      device,
      eventCount: events.length,
      eventTimeline: eventOrder.filter((name) => (
        name === "SEND_PRESS" ||
        name === "OPTIMISTIC_ENTITY_INSERTED" ||
        name.startsWith("STALE_REFRESH") ||
        name.endsWith("CONFIRMED")
      )),
      gfx,
      scenario: "staleRefresh",
      stale,
      status: "PASS"
    };
    writeFileSync(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await cleanup(admin, fixture);
    fixture = null;
    return;
  }

  if (scenario === "media") {
    let events = await waitForSendCount(1, 30_000);
    const initialSendIds = events.filter((event) => event.name === "SEND_PRESS").map((event) => event.clientId);
    const mediaId = initialSendIds[0];
    assert.ok(mediaId, `synthetic ${mediaKind} upload did not start`);
    const prefix = mediaKind === "video" ? "V" : "I";
    for (const value of [`${prefix}1`, `${prefix}2`, `${prefix}3`]) await sendText(value);
    await waitForSendCount(4, 20_000);
    await delay(1_200);
    const stabilityStartIndex = (await readPlacementEvents()).length - 1;
    await waitForClientEvent(mediaId, "HTTP_CONFIRMED", 180_000);
    await delay(2_000);

    events = await readPlacementEvents();
    const sendIds = events.filter((event) => event.name === "SEND_PRESS").map((event) => event.clientId);
    const mediaIds = [sendIds[0]];
    const textIds = [sendIds[1], sendIds[2], sendIds[3]];
    assert.ok(mediaIds.every(Boolean), "media logical identities were incomplete");
    assert.ok(textIds.every(Boolean), "overlapping text logical identities were incomplete");
    const media = scenarioSummary(events, mediaIds);
    const text = scenarioSummary(events, textIds);
    const stationaryAfterFinalInsertion = coordinateChangesAfter(
      events,
      textIds,
      stabilityStartIndex
    );
    const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
    await stopRecording(remoteRecording);
    writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`);

    for (const item of text) {
      assert.equal(item.mountCount, 1, `overlap text mount count was ${item.mountCount}`);
      assert.equal(item.scrollCommandCount, 0, `overlap text scroll count was ${item.scrollCommandCount}`);
      assert.equal(
        item.confirmationCoordinateChanges,
        0,
        `overlap text confirmation coordinate changes were ${item.confirmationCoordinateChanges}`
      );
    }
    for (const item of stationaryAfterFinalInsertion) {
      assert.equal(item.changes, 0, "media upload state moved a settled text row");
    }
    for (const item of media) {
      assert.equal(item.scrollCommandCount, 0, "media insertion issued a bottom-follow command");
    }

    const report = {
      artifact: `${artifactDir}/memory-chat-visual.mp4`,
      device,
      eventCount: events.length,
      gfx,
      mediaKind,
      media,
      scenario: `${mediaKind}TextOverlap`,
      stationaryAfterFinalInsertion,
      status: "PASS",
      text
    };
    writeFileSync(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await cleanup(admin, fixture);
    fixture = null;
    return;
  }

  if (scenario === "tail") {
    await sendDoubleTapText("x");
    await waitForSendCount(1, 10_000);
    await assertDoubleTapStayedInTextMode();

    await sendMultiline();
    await waitForSendCount(2, 10_000);
    await delay(3_200);
    const multilineWindowEnd = (await readPlacementEvents()).length;

    await sendVoiceMessage();
    for (const value of ["V1", "V2", "V3"]) await sendText(value);
    await waitForSendCount(6, 20_000);
    await delay(6_000);

    const events = await readPlacementEvents();
    const sendIds = events.filter((event) => event.name === "SEND_PRESS").map((event) => event.clientId);
    const oneCharacter = scenarioSummary(events, [sendIds[0]]);
    const multiline = scenarioSummary(
      events,
      [sendIds[1]],
      new Map([[sendIds[1], multilineWindowEnd]])
    );
    const voice = scenarioSummary(events, [sendIds[2]]);
    const voiceOverlapText = scenarioSummary(events, sendIds.slice(3, 6));
    const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
    await stopRecording(remoteRecording);
    writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`);

    assert.equal(oneCharacter[0]?.mountCount, 1, "one-character row did not mount once");
    assert.equal(oneCharacter[0]?.scrollCommandCount, 0, "one-character send issued a bottom-follow command");
    assert.equal(multiline[0]?.mountCount, 1, "multiline row did not mount once");
    assert.equal(multiline[0]?.scrollCommandCount, 0, "multiline send issued a bottom-follow command");
    assert.equal(
      multiline[0]?.confirmationCoordinateChanges,
      0,
      "multiline row moved during its confirmation-only window"
    );
    for (const item of voiceOverlapText) {
      assert.equal(item.mountCount, 1, `voice-overlap text mount count was ${item.mountCount}`);
      assert.equal(item.scrollCommandCount, 0, `voice-overlap text scroll count was ${item.scrollCommandCount}`);
      assert.equal(
        item.confirmationCoordinateChanges,
        0,
        `voice-overlap text confirmation coordinate changes were ${item.confirmationCoordinateChanges}`
      );
    }

    const report = {
      artifact: `${artifactDir}/memory-chat-visual.mp4`,
      device,
      eventCount: events.length,
      gfx,
      multiline,
      oneCharacter,
      scenario: "oneCharacterMultilineVoiceTail",
      status: "PASS",
      voice,
      voiceOverlapText
    };
    writeFileSync(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await cleanup(admin, fixture);
    fixture = null;
    return;
  }

  const rapidSendPoint = await sendRapidTextBurst(["A", "B", "C", "D", "E"]);
  let events = await waitForSendCount(5);
  await delay(3_200);
  events = await readPlacementEvents();
  const basicBottomOffset = assertFollowingBottom(events, "A-E burst");
  const basicIds = events.filter((event) => event.name === "SEND_PRESS").slice(0, 5).map((event) => event.clientId);

  await sendRapidTextBurst(
    Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, "0")),
    rapidSendPoint,
    0.05,
    true
  );
  events = await waitForSendCount(25, 30_000);
  const numberedBottomOffset = assertFollowingBottom(events, "20-message burst");

  await sendRapidTextBurst(Array.from({ length: 5 }, () => "same"), rapidSendPoint, 0.05, true);
  events = await waitForSendCount(30, 20_000);
  const identicalBottomOffset = assertFollowingBottom(events, "identical-message burst");

  await sendDoubleTapText("x");
  await waitForSendCount(31, 10_000);
  await assertDoubleTapStayedInTextMode();

  await sendMultiline();
  await waitForSendCount(32, 10_000);
  await delay(3_200);
  events = await readPlacementEvents();
  const multilineBottomOffset = assertFollowingBottom(events, "multiline send");
  const multilineConfirmationWindowEnd = events.length;

  // Voice upload and text overlap: recording/upload state must not own the
  // text composer. The fixture contains no personal content or media.
  await sendVoiceMessage();
  for (const value of ["V1", "V2", "V3"]) await sendText(value);
  await waitForSendCount(36, 20_000);
  const allSendIds = (await readPlacementEvents())
    .filter((event) => event.name === "SEND_PRESS")
    .map((event) => event.clientId);
  await waitForAllConfirmations(allSendIds, 60_000);
  await delay(1_000);

  events = await readPlacementEvents();
  const sendIds = events.filter((event) => event.name === "SEND_PRESS").map((event) => event.clientId);
  const multilineId = sendIds[31];
  const basic = scenarioSummary(events, basicIds);
  const numbered = scenarioSummary(events, sendIds.slice(5, 25));
  const identical = scenarioSummary(events, sendIds.slice(25, 30));
  const multilineWindowEnds = new Map(
    multilineId ? [[multilineId, multilineConfirmationWindowEnd]] : []
  );
  const multiline = scenarioSummary(
    events,
    multilineId ? [multilineId] : [],
    multilineWindowEnds
  );
  const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
  await stopRecording(remoteRecording);
  writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`);

  assert.equal(basic.length, 5, "A-E did not create five logical sends");
  for (const item of basic) {
    assert.equal(item.mountCount, 1, `A-E mount count was ${item.mountCount}`);
    assert.equal(item.scrollCommandCount, 0, `A-E scroll count was ${item.scrollCommandCount}`);
    assert.equal(
      item.confirmationCoordinateChanges,
      0,
      `A-E confirmation coordinate changes were ${item.confirmationCoordinateChanges}`
    );
    assert.equal(item.confirmationMounts, 0, `A-E confirmation mount count was ${item.confirmationMounts}`);
  }
  assert.equal(multiline[0]?.mountCount, 1, "multiline row did not mount once");
  assert.equal(multiline[0]?.scrollCommandCount, 0, "multiline send issued a bottom-follow command");
  assert.equal(
    multiline[0]?.confirmationCoordinateChanges,
    0,
    "multiline row moved during its confirmation-only window"
  );
  assert.equal(numbered.length, 20, "numbered burst did not create twenty logical sends");
  assert.equal(identical.length, 5, "identical burst did not create five logical sends");
  assert.equal(new Set(sendIds.slice(25, 30)).size, 5, "identical messages merged logical identities");
  for (const item of [...numbered, ...identical]) {
    assert.equal(item.scrollCommandCount, 0, "rapid burst issued a bottom-follow command");
    assert.equal(item.confirmationMounts, 0, "rapid burst remounted a row during confirmation");
    assert.equal(
      item.confirmationCoordinateChanges,
      0,
      "rapid burst moved a row during confirmation"
    );
  }
  for (const clientId of sendIds) {
    const lifecycle = events.filter((event) => event.clientId === clientId);
    assert.equal(
      lifecycle.find((event) => event.name === "LIST_DATA_RECEIVED")?.renderIndex,
      0,
      "logical send did not enter list data at final inverted index zero"
    );
    assert.equal(
      lifecycle.find((event) => event.name === "ROW_MOUNTED")?.renderIndex,
      0,
      "logical send did not first mount at final inverted index zero"
    );
    assert.ok(lifecycle.some((event) => event.name === "HTTP_CONFIRMED"));
    assert.ok(lifecycle.some((event) => event.name === "REALTIME_CONFIRMED"));
  }

  const report = {
    artifact: `${artifactDir}/memory-chat-visual.mp4`,
    basic,
    bottomOffsets: {
      basic: basicBottomOffset,
      identical: identicalBottomOffset,
      multiline: multilineBottomOffset,
      numbered: numberedBottomOffset
    },
    device,
    eventCount: events.length,
    gfx,
    identical,
    multiline,
    numbered,
    scenarios: {
      basicRapid: 5,
      identical: 5,
      multiline: 1,
      numberedBurst: 20,
      oneCharacterImmediate: 1,
      voiceTextOverlap: 3
    },
    status: "PASS"
  };
  writeFileSync(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await cleanup(admin, fixture);
  fixture = null;
}

try {
  await main();
} catch (error) {
  mkdirSync(artifactDir, { recursive: true });
  const events = await readPlacementEvents().catch(() => []);
  writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`);
  writeFileSync(`${artifactDir}/failure.json`, `${JSON.stringify({
    error: error instanceof Error ? error.message : "unknown_failure",
    mediaWorkerOutput: mediaWorkerOutput.join("").slice(-12_000),
    serverOutput: serverOutput.join("").slice(-12_000)
  }, null, 2)}\n`);
  throw error;
} finally {
  if (recorder?.exitCode === null) recorder.kill("SIGINT");
  if (placementLogger?.exitCode === null) placementLogger.kill("SIGTERM");
  if (mediaPumpTimer) clearInterval(mediaPumpTimer);
  if (metro?.exitCode === null) metro.kill("SIGTERM");
  if (server?.exitCode === null) server.kill("SIGTERM");
  if (fixtureServer) fixtureServer.close();
  if (fixture) {
    const env = localStatus();
    await cleanup(createClient(env.url, env.serviceKey, authOptions), fixture).catch(() => {});
  }
}
