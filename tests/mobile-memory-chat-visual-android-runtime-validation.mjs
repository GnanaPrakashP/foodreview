#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const anchorScenario = scenario === "anchor";
const mediaKind = process.env.ANDROID_MEMORY_MEDIA_KIND ?? "image";
const artifactDir = process.env.ANDROID_MEMORY_ARTIFACT_DIR ??
  "/private/tmp/memory-chat-visual-android";
const apkPath = anchorScenario
  ? `${root}mobile/android/app/build/outputs/apk/release/app-release.apk`
  : `${root}mobile/android/app/build/outputs/apk/debug/app-debug.apk`;
const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };
let fixture;
let fixtureSeedUsers = [];
let fixtureServer;
let mediaWorkerOutput = [];
let mediaPumpBusy = false;
let mediaPumpTimer;
let metro;
let placementLogger;
let placementLineBuffer = "";
let placementEventStream = [];
let journeyEventStream = [];
let server;
let recorder;
let serverOutput = [];
let physicalNetworkDisabled = false;
let tabTapRetryCount = 0;
let currentRoomTab = null;
let anchorScreenshotCount = 0;
let compactRoomTabPoints = new Map();
let expandedRoomTabPoints = new Map();
let deviceViewport = {
  height: Number.POSITIVE_INFINITY,
  width: Number.POSITIVE_INFINITY
};
const mediaWorkerSecret = "memory-visual-media-worker-secret-material-0123456789";

function localStatus() {
  const localSupabase = `${root}node_modules/.bin/supabase`;
  const result = spawnSync(
    existsSync(localSupabase) ? localSupabase : "npx",
    existsSync(localSupabase)
      ? ["status", "-o", "json"]
      : ["supabase", "status", "-o", "json"],
    {
    cwd: root,
    encoding: "utf8"
    }
  );
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

async function captureScreenshot(path) {
  const result = await execFileAsync(
    adb,
    ["-s", serial, "exec-out", "screencap", "-p"],
    { encoding: null, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }
  );
  writeFileSync(path, result.stdout);
}

async function readConnectedDevice() {
  const [manufacturer, model, release, inputMethod, physicalSize] = await Promise.all([
    adbRun(["shell", "getprop", "ro.product.manufacturer"]),
    adbRun(["shell", "getprop", "ro.product.model"]),
    adbRun(["shell", "getprop", "ro.build.version.release"]),
    adbRun(["shell", "settings", "get", "secure", "default_input_method"]),
    adbRun(["shell", "wm", "size"])
  ]);
  const viewport = [...physicalSize.matchAll(/(\d+)x(\d+)/g)].at(-1);
  if (viewport) {
    deviceViewport = {
      height: Number(viewport[2]),
      width: Number(viewport[1])
    };
  }
  const keyboard = inputMethod.includes("com.google.android.inputmethod.latin")
    ? "Gboard"
    : inputMethod.trim().slice(0, 80);
  return {
    display: `${deviceViewport.width}x${deviceViewport.height}`,
    keyboard,
    manufacturer: manufacturer.trim().slice(0, 40),
    model: model.trim().slice(0, 80),
    os: `Android ${release.trim().slice(0, 20)}`
  };
}

async function createFixtureUser(admin, suffix, label) {
  const email = `memory-visual-${label}-${suffix}@example.test`;
  const username = `mvv_${label}_${suffix}`.slice(0, 20);
  const user = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("fixture_user_create_failed");
  const userId = user.data.user.id;
  const profile = await admin.from("profiles").upsert({
    account_status: "active",
    account_type: "public",
    first_name: label === "owner" ? "Device" : "Fixture",
    id: userId,
    last_name: label === "owner" ? "Visual" : label,
    username
  });
  if (profile.error) throw profile.error;
  const created = { email, userId, username };
  fixtureSeedUsers.push(created);
  return created;
}

async function seed(admin, representative = false, initialAnchor = false) {
  const suffix = Date.now().toString(36).slice(-7);
  const owner = await createFixtureUser(admin, suffix, "owner");
  const participants = representative
    ? await Promise.all([
      createFixtureUser(admin, suffix, "guest1"),
      createFixtureUser(admin, suffix, "guest2")
    ])
    : [];
  const room = await admin.from("shared_memory_rooms").insert({
    area: "Synthetic device fixture",
    created_by: owner.username,
    occasion_type: "friends_hangout",
    restaurant_name: "Synthetic table",
    status: "published",
    title: "Visual validation",
    visit_date: new Date().toISOString().slice(0, 10)
  }).select("id").single();
  if (room.error) throw room.error;
  const roomId = room.data.id;
  const member = await admin.from("shared_memory_members").insert([
    {
      role: "owner",
      room_id: roomId,
      user_name: owner.username
    },
    ...participants.map((participant) => ({
      role: "participant",
      room_id: roomId,
      user_name: participant.username
    }))
  ]);
  if (member.error) throw member.error;

  if (!representative) {
    const baseline = await admin.from("shared_memory_messages").insert({
      author_name: owner.username,
      body: "Fixture ready",
      room_id: roomId
    });
    if (baseline.error) throw baseline.error;
  } else if (!initialAnchor) {
    const stopInsert = await admin.from("shared_memory_stops").insert([
      {
        created_by: owner.username,
        name: "Synthetic cafe",
        note: "Fixture stop one",
        position: 0,
        room_id: roomId,
        stop_type: "cafe"
      },
      {
        created_by: participants[0].username,
        name: "Synthetic dinner",
        note: "Fixture stop two",
        position: 1,
        room_id: roomId,
        stop_type: "restaurant"
      },
      {
        created_by: participants[1].username,
        name: "Synthetic activity",
        note: "Fixture stop three",
        position: 2,
        room_id: roomId,
        stop_type: "activity"
      }
    ]).select("id");
    if (stopInsert.error) throw stopInsert.error;
    const usernames = [owner.username, ...participants.map((item) => item.username)];
    const dishInsert = await admin.from("shared_memory_dishes").insert(
      Array.from({ length: 12 }, (_, index) => ({
        added_by: usernames[index % usernames.length],
        dish_name: `Fixture dish ${String(index + 1).padStart(2, "0")}`,
        note: `Synthetic dish note ${index + 1}`,
        room_id: roomId
      }))
    ).select("id");
    if (dishInsert.error) throw dishInsert.error;
    const ratings = await admin.from("shared_memory_dish_ratings").insert(
      dishInsert.data.flatMap((dish, index) => usernames.map((ratedBy, raterIndex) => ({
        dish_id: dish.id,
        rated_by: ratedBy,
        rating: ((index + raterIndex) % 5) + 1,
        room_id: roomId
      })))
    );
    if (ratings.error) throw ratings.error;

    const now = Date.now();
    const messageInsert = await admin.from("shared_memory_messages").insert(
      Array.from({ length: 60 }, (_, index) => ({
        author_name: usernames[index % usernames.length],
        body: `Fixture message ${String(index + 1).padStart(2, "0")}`,
        created_at: new Date(now - (60 - index) * 60_000).toISOString(),
        room_id: roomId
      }))
    ).select("id");
    if (messageInsert.error) throw messageInsert.error;
    const replies = await admin.from("shared_memory_messages").insert(
      [10, 20, 30, 40, 50].map((index, replyIndex) => ({
        author_name: usernames[(replyIndex + 1) % usernames.length],
        body: `Fixture reply ${replyIndex + 1}`,
        created_at: new Date(now - (5 - replyIndex) * 30_000).toISOString(),
        reply_to_message_id: messageInsert.data[index].id,
        room_id: roomId
      }))
    );
    if (replies.error) throw replies.error;
  }

  let secondRoomId = null;
  if (representative) {
    const secondRoom = await admin.from("shared_memory_rooms").insert({
      area: "Synthetic alternate fixture",
      created_by: owner.username,
      occasion_type: "casual",
      restaurant_name: "Synthetic alternate table",
      status: "published",
      title: "Visual validation B",
      visit_date: new Date().toISOString().slice(0, 10)
    }).select("id").single();
    if (secondRoom.error) throw secondRoom.error;
    secondRoomId = secondRoom.data.id;
    const secondMembers = await admin.from("shared_memory_members").insert(
      [owner, ...participants].map((participant, index) => ({
        role: index === 0 ? "owner" : "participant",
        room_id: secondRoomId,
        user_name: participant.username
      }))
    );
    if (secondMembers.error) throw secondMembers.error;
    if (!initialAnchor) {
      const secondMessages = await admin.from("shared_memory_messages").insert(
        Array.from({ length: 8 }, (_, index) => ({
          author_name: [owner, ...participants][index % 3].username,
          body: `Alternate room message ${index + 1}`,
          room_id: secondRoomId
        }))
      );
      if (secondMessages.error) throw secondMessages.error;
    }
  }

  if (initialAnchor) {
    const usernames = [owner.username, ...participants.map((item) => item.username)];
    const now = Date.now();
    const primaryMessages = await admin.from("shared_memory_messages").insert(
      Array.from({ length: 46 }, (_, index) => ({
        author_name: usernames[index % usernames.length],
        body: index % 9 === 0
          ? `Anchor multiline ${index + 1}\nsecond synthetic line`
          : `Anchor short ${String(index + 1).padStart(2, "0")}`,
        created_at: new Date(now - (50 - index) * 60_000).toISOString(),
        room_id: roomId
      }))
    ).select("id");
    if (primaryMessages.error) throw primaryMessages.error;
    const primaryReplies = await admin.from("shared_memory_messages").insert(
      Array.from({ length: 4 }, (_, index) => ({
        author_name: usernames[(index + 1) % usernames.length],
        body: index === 2
          ? "Anchor reply multiline\nsecond synthetic line"
          : `Anchor reply ${index + 1}`,
        created_at: new Date(now - (4 - index) * 30_000).toISOString(),
        reply_to_message_id: primaryMessages.data[8 + index * 7].id,
        room_id: roomId
      }))
    );
    if (primaryReplies.error) throw primaryReplies.error;

    const secondaryMessages = await admin.from("shared_memory_messages").insert(
      Array.from({ length: 6 }, (_, index) => ({
        author_name: usernames[index % usernames.length],
        body: index === 4
          ? "Eight room multiline\nsecond synthetic line"
          : `Eight room short ${index + 1}`,
        created_at: new Date(now - (8 - index) * 60_000).toISOString(),
        room_id: secondRoomId
      }))
    ).select("id");
    if (secondaryMessages.error) throw secondaryMessages.error;
    const secondaryReplies = await admin.from("shared_memory_messages").insert(
      Array.from({ length: 2 }, (_, index) => ({
        author_name: usernames[(index + 2) % usernames.length],
        body: `Eight room reply ${index + 1}`,
        created_at: new Date(now - (2 - index) * 30_000).toISOString(),
        reply_to_message_id: secondaryMessages.data[index * 3].id,
        room_id: secondRoomId
      }))
    );
    if (secondaryReplies.error) throw secondaryReplies.error;
  }

  return {
    email: owner.email,
    roomId,
    roomIds: [roomId, ...(secondRoomId ? [secondRoomId] : [])],
    secondRoomId,
    userId: owner.userId,
    username: owner.username,
    users: [owner, ...participants]
  };
}

async function cleanup(admin, value) {
  if (!value) return;
  for (const roomId of value.roomIds ?? [value.roomId]) {
    await admin.from("shared_memory_rooms").delete().eq("id", roomId);
  }
  for (const user of value.users ?? [{ userId: value.userId }]) {
    await admin.from("profiles").delete().eq("id", user.userId);
    await admin.auth.admin.deleteUser(user.userId);
  }
  fixtureSeedUsers = [];
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
      MEMORY_CHAT_DEV_CONFIRM_DELAY_MS:
        scenario === "full" || scenario === "tail"
          ? "2500"
          : anchorScenario
            ? "400"
            : "0",
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
    EXPO_PUBLIC_MEMORY_ROOM_JOURNEY_DIAGNOSTICS: "1",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
    EXPO_PUBLIC_SUPABASE_URL: env.url,
    JAVA_HOME: "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    NODE_ENV: "production"
  };
  run("./gradlew", [
    "app:clean",
    "app:assembleDebug",
    "-PwitohBundleDebugJs=true"
  ], { cwd: `${root}mobile/android`, env: buildEnv });
}

function buildAnchorReleaseAndroid(env) {
  const keyStore = process.env.ANDROID_MEMORY_KEYSTORE ??
    "/private/tmp/circlebites-memory-anchor-measurement.jks";
  if (!existsSync(keyStore)) {
    run("/opt/homebrew/opt/openjdk@17/bin/keytool", [
      "-genkeypair",
      "-alias", "memoryanchormeasurement",
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", "2",
      "-dname", "CN=Witoh Memory Anchor Validation",
      "-keystore", keyStore,
      "-storepass", "memoryanchor",
      "-keypass", "memoryanchor",
      "-noprompt"
    ]);
  }
  const buildEnv = {
    ...process.env,
    ANDROID_HOME: "/opt/homebrew/share/android-commandlinetools",
    ANDROID_SDK_ROOT: "/opt/homebrew/share/android-commandlinetools",
    EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
    EXPO_PUBLIC_APP_ENVIRONMENT: "development",
    EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS: "1",
    EXPO_PUBLIC_MEMORY_ROOM_JOURNEY_DIAGNOSTICS: "1",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
    EXPO_PUBLIC_SUPABASE_URL: env.url,
    JAVA_HOME: "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    NODE_ENV: "production"
  };
  run("./gradlew", ["app:clean"], {
    cwd: `${root}mobile/android`,
    env: buildEnv
  });
  run("./gradlew", [
    "app:assembleRelease",
    "-Pandroid.enableMinifyInReleaseBuilds=true",
    "-Pandroid.enableShrinkResourcesInReleaseBuilds=true",
    `-Pandroid.injected.signing.store.file=${keyStore}`,
    "-Pandroid.injected.signing.store.password=memoryanchor",
    "-Pandroid.injected.signing.key.alias=memoryanchormeasurement",
    "-Pandroid.injected.signing.key.password=memoryanchor"
  ], { cwd: `${root}mobile/android`, env: buildEnv });
}

function verifyAnchorReleaseArtifact(env) {
  const buildToolsRoot = "/opt/homebrew/share/android-commandlinetools/build-tools";
  const apksigner = [
    "36.0.0",
    "35.0.0",
    "34.0.0"
  ].map((version) => `${buildToolsRoot}/${version}/apksigner`)
    .find((candidate) => existsSync(candidate));
  assert.ok(apksigner, "Android apksigner is unavailable");
  const signature = run(apksigner, [
    "verify",
    "--verbose",
    "--print-certs",
    apkPath
  ], {
    env: {
      ...process.env,
      JAVA_HOME: "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
    }
  });
  assert.match(signature, /Verified using v2 scheme \(APK Signature Scheme v2\): true/);

  const inspectionDir = `${artifactDir}/apk-inspection`;
  mkdirSync(inspectionDir, { recursive: true });
  run("unzip", [
    "-qq",
    "-o",
    apkPath,
    "assets/index.android.bundle",
    "-d",
    inspectionDir
  ]);
  const bundlePath = `${inspectionDir}/assets/index.android.bundle`;
  const bundle = readFileSync(bundlePath);
  const apk = readFileSync(apkPath);
  assert.ok(bundle.length > 1_000_000, "embedded Android bundle is unexpectedly small");
  assert.notEqual(
    bundle.subarray(0, 64).toString("utf8").trimStart().startsWith("var "),
    true,
    "embedded Android bundle is plain JavaScript instead of Hermes bytecode"
  );
  const forbiddenValues = [
    env.serviceKey,
    mediaWorkerSecret,
    "SUPABASE_SERVICE_ROLE_KEY=",
    "MEDIA_WORKER_SECRET=",
    "API_RATE_LIMIT_HMAC_SECRET="
  ];
  for (const value of forbiddenValues) {
    if (!value) continue;
    assert.equal(
      apk.includes(Buffer.from(value)),
      false,
      "release/profile APK contains a forbidden server secret or host path"
    );
    assert.equal(
      bundle.includes(Buffer.from(value)),
      false,
      "Hermes bundle contains a forbidden server secret or host path"
    );
  }
  assert.equal(
    bundle.includes(Buffer.from("/Users/gnanaprakash/")),
    false,
    "Hermes bundle contains a developer host path"
  );
  const mappingPath = `${root}mobile/android/app/build/outputs/mapping/release/mapping.txt`;
  assert.ok(existsSync(mappingPath), "R8 mapping was not produced for the minified release");
  const report = {
    apkBytes: apk.length,
    apkSha256: createHash("sha256").update(apk).digest("hex"),
    hermesBundleBytes: bundle.length,
    hermesHeaderHex: bundle.subarray(0, 8).toString("hex"),
    hermesSha256: createHash("sha256").update(bundle).digest("hex"),
    minified: true,
    privacySecretScan: "PASS",
    signature: "PASS"
  };
  writeFileSync(`${artifactDir}/apk-signature.txt`, signature);
  writeFileSync(
    `${artifactDir}/apk-verification.json`,
    `${JSON.stringify(report, null, 2)}\n`
  );
  return report;
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
      EXPO_PUBLIC_MEMORY_ROOM_JOURNEY_DIAGNOSTICS: "1",
      EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_KINDS:
        scenario === "media" ? mediaKind : scenario === "journey" ? "image,video" : "",
      EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_ORIGIN:
        scenario === "media" || scenario === "journey" ? fixtureBaseUrl : "",
      EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_START_MS:
        scenario === "media" || scenario === "journey" ? "5000" : "",
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
    const values = (node) => ({
      description: /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "",
      text: /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? ""
    });
    const node = nodes.find((value) => {
      const { description, text } = values(value);
      return text === lower || description === lower;
    }) ?? nodes.find((value) => {
      const { description, text } = values(value);
      return text.includes(lower) || description.includes(lower);
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

function pointForPattern(xml, pattern) {
  const nodes = decodedXml(xml).match(/<node\b[^>]*>/g) ?? [];
  const node = nodes.find((value) => {
    const description = /content-desc="([^"]*)"/.exec(value)?.[1] ?? "";
    const text = /text="([^"]*)"/.exec(value)?.[1] ?? "";
    if (!pattern.test(description) && !pattern.test(text)) return false;
    const bounds = value.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds) return false;
    const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2);
    const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2);
    return x > 0 && x < deviceViewport.width && y > 0 && y < deviceViewport.height;
  });
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) return null;
  return {
    x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
    y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)
  };
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

async function waitForPattern(pattern, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const point = pointForPattern(await uiXml(), pattern);
    if (point) return point;
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

async function navigateToRoom(title = "Visual validation") {
  let target = await waitForPoint(["Memories"], "Profile Memories tab");
  await tap(target.point);
  target = await waitForPoint([title], `synthetic Memory Room ${title}`);
  await tap(target.point);
  await waitForPoint(["Table"], "Memory Room Table tab");
  const xml = await uiXml();
  expandedRoomTabPoints = new Map(
    ["Table", "Chat", "Media", "Dishes"].map((label) => [label, pointFor(xml, [label])])
  );
  compactRoomTabPoints = new Map();
  currentRoomTab = "overview";
}

async function switchRoomTab(label) {
  const tab = label === "Table" ? "overview" : label.toLowerCase();
  if (currentRoomTab === tab) return;
  const before = journeyEventStream.filter((event) => (
    event.action === "TAB_PRESS" && event.tab === tab
  )).length;
  const cachedPoint = (
    currentRoomTab === "overview" ? expandedRoomTabPoints : compactRoomTabPoints
  ).get(label);
  const target = cachedPoint ? { point: cachedPoint } : await waitForPoint([label], `${label} tab`);
  // Header geometry is stable for the room lifecycle. Reusing coordinates
  // captured at room entry avoids reacquiring UIAutomator's accessibility
  // channel immediately before a synthetic touch.
  await tap(target.point);
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (journeyEventStream.filter((event) => (
      event.action === "TAB_PRESS" && event.tab === tab
    )).length > before) {
      const press = journeyEventStream.findLast((event) => (
        event.action === "TAB_PRESS" && event.tab === tab
      ));
      await waitForJourneyActionAfter("TAB_USABLE", tab, press.monotonicTimestampMs);
      currentRoomTab = tab;
      if (tab !== "overview" && compactRoomTabPoints.size === 0) {
        const compactXml = await uiXml();
        compactRoomTabPoints = new Map(
          ["Table", "Chat", "Media", "Dishes"].map((tabLabel) => [
            tabLabel,
            pointFor(compactXml, [tabLabel])
          ])
        );
        await delay(1_500);
      }
      return;
    }
    await delay(100);
  }
  tabTapRetryCount += 1;
  // Reuse the already resolved coordinate. Dumping the hierarchy again would
  // reacquire the same accessibility channel whose release we are testing.
  await delay(1_500);
  await tap(target.point);
  const retryDeadline = Date.now() + 5_000;
  while (Date.now() < retryDeadline) {
    if (journeyEventStream.filter((event) => (
      event.action === "TAB_PRESS" && event.tab === tab
    )).length > before) {
      const press = journeyEventStream.findLast((event) => (
        event.action === "TAB_PRESS" && event.tab === tab
      ));
      await waitForJourneyActionAfter("TAB_USABLE", tab, press.monotonicTimestampMs);
      currentRoomTab = tab;
      if (tab !== "overview" && compactRoomTabPoints.size === 0) {
        const compactXml = await uiXml();
        compactRoomTabPoints = new Map(
          ["Table", "Chat", "Media", "Dishes"].map((tabLabel) => [
            tabLabel,
            pointFor(compactXml, [tabLabel])
          ])
        );
        await delay(1_500);
      }
      return;
    }
    await delay(100);
  }
  throw new Error(`${label} tab did not respond after a bounded retry`);
}

async function fastScrollCurrentSurface() {
  await adbRun(["shell", "input", "swipe", "540", "1750", "540", "550", "240"]);
  await delay(180);
  await adbRun(["shell", "input", "swipe", "540", "650", "540", "1650", "240"]);
  await delay(220);
}

async function replyToVisibleFixtureMessage() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const xml = await uiXml();
    const target = pointFor(xml, [
      "Video",
      "Photo",
      "Fixture message 60",
      "Fixture message 59",
      "Fixture reply"
    ]) ?? { x: 420, y: 1_150 };
    await adbRun([
      "shell",
      "input", "swipe",
      String(target.x),
      String(target.y),
      String(Math.min(1_180, target.x + 380)),
      String(target.y),
      "320"
    ]);
    try {
      await waitForPoint(["Cancel reply"], "reply composer", 1_500);
      await sendText("ReplyJourney");
      return;
    } catch {
      await adbRun(["shell", "input", "swipe", "540", "700", "540", "1600", "280"]);
      await delay(250);
    }
  }
  throw new Error("Could not activate reply on a visible confirmed message");
}

async function backgroundAndForeground() {
  const foregroundCount = journeyEventStream.filter((event) => event.action === "APP_FOREGROUND").length;
  await adbRun(["shell", "input", "keyevent", "3"]);
  await delay(1_000);
  await adbRun([
    "shell", "monkey",
    "-p", packageName,
    "-c", "android.intent.category.LAUNCHER",
    "1"
  ]);
  await waitForPoint(["Table", "Chat", "Type a message"], "foreground Memory Room", 20_000);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (journeyEventStream.filter((event) => event.action === "APP_FOREGROUND").length > foregroundCount) {
      const foregroundEvent = journeyEventStream.findLast(
        (event) => event.action === "APP_FOREGROUND"
      );
      if (foregroundEvent?.keyboardState === "open") {
        await adbRun(["shell", "input", "keyevent", "4"]);
        await delay(500);
      }
      return;
    }
    await delay(100);
  }
  throw new Error("Memory Room did not publish APP_FOREGROUND after relaunch");
}

async function setPhysicalNetworkEnabled(enabled) {
  const value = enabled ? "enable" : "disable";
  await adbRun(["shell", "svc", "wifi", value], true);
  await adbRun(["shell", "svc", "data", value], true);
  await delay(enabled ? 2_500 : 1_500);
}

async function exitRoomFromTableAfterChatVisit() {
  const table = await waitForPoint(["Table"], "Table tab before room exit");
  await tap(table.point);
  await delay(300);
  const back = await waitForPoint(["Go back"], "Memory Room back button");
  const requestedAt = Date.now();
  await tap(back.point);
  await waitForPoint(["Posts"], "Profile after Memory Room exit");
  const elapsedMs = Date.now() - requestedAt;
  assert.ok(
    elapsedMs <= 5_000,
    `Memory Room exit did not reveal Profile within the bounded window (${elapsedMs}ms)`
  );
  return elapsedMs;
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
      assert.equal(
        await waitForObservedSendPress(expectedCount, 1_500),
        true,
        "the first acknowledged tap did not reach SEND_PRESS"
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
    pointFor(xml, ["Allow Witoh Dev to record audio?"]);
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

function journeyEvents(logcat) {
  return logcat.split("\n").flatMap((line) => {
    const payload = /CB_MEMORY_JOURNEY\s+(\{.*\})/.exec(line)?.[1];
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
  journeyEventStream = [];
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
      journeyEventStream.push(...journeyEvents(line));
    }
  });
}

async function readPlacementEvents() {
  return placementEventStream.slice();
}

async function readJourneyEvents() {
  return journeyEventStream.slice();
}

async function waitForJourneyAction(action, tab, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = journeyEventStream.findLast((item) => (
      item.action === action && (!tab || item.tab === tab)
    ));
    if (event) return event;
    await delay(100);
  }
  throw new Error(`Timed out waiting for journey action ${action}${tab ? ` on ${tab}` : ""}`);
}

async function waitForJourneyActionAfter(action, tab, afterTimestamp, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = journeyEventStream.find((item) => (
      item.action === action &&
      (!tab || item.tab === tab) &&
      item.monotonicTimestampMs >= afterTimestamp
    ));
    if (event) return event;
    await delay(100);
  }
  throw new Error(`Timed out waiting for new journey action ${action}${tab ? ` on ${tab}` : ""}`);
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

function summarizeServerRequests(output) {
  const grouped = new Map();
  const requestPattern = /(?:^|\n)\s*(GET|POST|PUT|PATCH|DELETE) (\/api\/\S+) \d{3} in (\d+)ms/g;
  for (const match of output.matchAll(requestPattern)) {
    const method = match[1];
    const parsed = new URL(match[2], "http://memory-room.invalid");
    const route = parsed.pathname.replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id"
    );
    const action = route === "/api/mobile/memories/read"
      ? parsed.searchParams.get("action")
      : null;
    const category = action && /^[a-z_]+$/i.test(action)
      ? `${method} ${route}?action=${action}`
      : `${method} ${route}`;
    const current = grouped.get(category) ?? { count: 0, durationMs: 0 };
    current.count += 1;
    current.durationMs += Number(match[3]);
    grouped.set(category, current);
  }
  return {
    byCategory: Object.fromEntries([...grouped.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    ))),
    total: [...grouped.values()].reduce((sum, value) => sum + value.count, 0)
  };
}

function memoryValue(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Number(new RegExp(`${escaped}:\\s+([\\d,]+)`, "i").exec(output)?.[1]?.replaceAll(",", "") ?? 0);
}

async function sampleMemory(label) {
  const output = await adbRun(["shell", "dumpsys", "meminfo", packageName], true);
  return {
    graphicsKb: memoryValue(output, "Graphics"),
    javaHeapKb: memoryValue(output, "Java Heap"),
    label,
    nativeHeapKb: memoryValue(output, "Native Heap"),
    sampledAt: new Date().toISOString(),
    totalPssKb: memoryValue(output, "TOTAL PSS"),
    viewCount: memoryValue(output, "Views")
  };
}

function summarizeJourney(events) {
  const tabTransitions = [];
  for (let index = 0; index < events.length; index += 1) {
    const press = events[index];
    if (press.action !== "TAB_PRESS") continue;
    const transitionEvents = events.slice(index + 1).filter((event) => (
      event.roomSessionId === press.roomSessionId && event.tab === press.tab
    ));
    const firstFrame = transitionEvents.find((event) => event.action === "TAB_FIRST_FRAME");
    const usable = transitionEvents.find((event) => event.action === "TAB_USABLE");
    const settled = transitionEvents.find((event) => event.action === "TAB_TRANSITION_SETTLED");
    tabTransitions.push({
      blankFrames: null,
      firstFrameMs: firstFrame
        ? Math.max(0, firstFrame.monotonicTimestampMs - press.monotonicTimestampMs)
        : null,
      from: press.fromTab ?? null,
      mountCount: usable
        ? Math.max(0, usable.mountCount - press.mountCount)
        : null,
      networkRequestCount: usable
        ? Math.max(0, usable.networkRequestCount - press.networkRequestCount)
        : null,
      renderCount: usable
        ? Math.max(0, usable.renderCount - press.renderCount)
        : null,
      settledMs: settled
        ? Math.max(0, settled.monotonicTimestampMs - press.monotonicTimestampMs)
        : null,
      to: press.tab,
      usableMs: usable
        ? Math.max(0, usable.monotonicTimestampMs - press.monotonicTimestampMs)
        : null
    });
  }
  const final = events.at(-1) ?? null;
  const roomGroupMap = new Map();
  for (const event of events) {
    const roomEvents = roomGroupMap.get(event.roomSessionId) ?? [];
    roomEvents.push(event);
    roomGroupMap.set(event.roomSessionId, roomEvents);
  }
  const roomGroups = [...roomGroupMap.values()];
  return {
    actionCounts: Object.fromEntries(
      [...new Set(events.map((event) => event.action))].map((action) => [
        action,
        events.filter((event) => event.action === action).length
      ])
    ),
    eventCount: events.length,
    durationMs: events.length > 1
      ? events.at(-1).monotonicTimestampMs - events[0].monotonicTimestampMs
      : 0,
    entry: roomGroups.map((roomEvents) => {
      const tap = roomEvents.find((event) => event.action === "ROOM_TAP");
      const relative = (action, tab) => {
        const event = roomEvents.find((item) => (
          item.action === action && (!tab || item.tab === tab)
        ));
        return tap && event ? event.monotonicTimestampMs - tap.monotonicTimestampMs : null;
      };
      return {
        firstFrameMs: relative("ROOM_FIRST_FRAME"),
        localSnapshotMs: relative("LOCAL_SNAPSHOT_RENDERED"),
        serverReconciledMs: relative("SERVER_REFRESH_APPLIED"),
        tableUsableMs: relative("TAB_USABLE", "overview")
      };
    }),
    exit: roomGroups.map((roomEvents) => {
      const started = roomEvents.find((event) => event.action === "ROOM_EXIT_STARTED");
      const unmounted = roomEvents.find((event) => event.action === "ROOM_SCREEN_UNMOUNT");
      return started && unmounted
        ? { unmountMs: unmounted.monotonicTimestampMs - started.monotonicTimestampMs }
        : null;
    }).filter(Boolean),
    finalOwners: final ? {
      playerCount: final.playerCount,
      realtimeChannelCount: final.realtimeChannelCount
    } : null,
    networkCategories: [...new Set(
      events.map((event) => event.networkRequestCategory).filter((value) => value && value !== "none")
    )],
    roomSessions: new Set(events.map((event) => event.roomSessionId)).size,
    sqlite: {
      reads: roomGroups.reduce(
        (sum, roomEvents) => sum + Math.max(...roomEvents.map((event) => event.sqliteReadCount ?? 0)),
        0
      ),
      writes: roomGroups.reduce(
        (sum, roomEvents) => sum + Math.max(...roomEvents.map((event) => event.sqliteWriteCount ?? 0)),
        0
      )
    },
    tabTransitions
  };
}

async function writeRuntimeStreams() {
  const placement = await readPlacementEvents();
  const journey = await readJourneyEvents();
  writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(placement, null, 2)}\n`);
  writeFileSync(`${artifactDir}/journey-events.json`, `${JSON.stringify(journey, null, 2)}\n`);
  return { journey, placement };
}

async function captureAnchorCheckpoint(label, afterGeneration = 0) {
  const deadline = Date.now() + 20_000;
  let generation = null;
  while (Date.now() < deadline) {
    generation = placementEventStream
      .filter((event) => (
        event.name === "CHAT_GEOMETRY_MODEL_READY" &&
        event.layoutGeneration > afterGeneration
      ))
      .at(-1)?.layoutGeneration ?? null;
    if (generation !== null) break;
    await delay(50);
  }
  assert.ok(generation !== null, `${label} did not mount a new Chat layout generation`);
  await delay(950);
  anchorScreenshotCount += 1;
  const file = `anchor-${String(anchorScreenshotCount).padStart(2, "0")}.png`;
  await captureScreenshot(`${artifactDir}/${file}`);
  return {
    eventCount: placementEventStream.length,
    file,
    generation,
    label
  };
}

function summarizeAnchorCheckpoints(events, checkpoints) {
  const summaries = checkpoints.map((checkpoint) => {
    const generationEvents = events.slice(0, checkpoint.eventCount).filter(
      (event) => event.layoutGeneration === checkpoint.generation
    );
    const model = generationEvents.find(
      (event) => event.name === "CHAT_GEOMETRY_MODEL_READY"
    );
    const list = generationEvents.find(
      (event) => event.name === "CHAT_LIST_FIRST_LAYOUT"
    );
    const composer = generationEvents.find(
      (event) => event.name === "CHAT_COMPOSER_FIRST_LAYOUT"
    );
    const firstRows = generationEvents.filter(
      (event) => event.name === "CHAT_ROW_FIRST_LAYOUT"
    );
    const rowChanges = generationEvents.filter(
      (event) => event.name === "CHAT_ROW_LAYOUT_CHANGED"
    );
    const mismatches = generationEvents.filter(
      (event) => event.name === "CHAT_GEOMETRY_MISMATCH"
    );
    assert.ok(model, `${checkpoint.label} did not publish its geometry model`);
    assert.ok(list, `${checkpoint.label} did not publish its first list layout`);
    assert.ok(composer, `${checkpoint.label} did not publish its first composer layout`);
    assert.equal(
      new Set(firstRows.map((event) => event.rowKey)).size,
      8,
      `${checkpoint.label} did not sample exactly the initial eight rows`
    );
    assert.equal(
      rowChanges.length,
      0,
      `${checkpoint.label} moved an already-visible row during the first 750 ms`
    );
    assert.equal(
      mismatches.length,
      0,
      `${checkpoint.label} measured a collapsed composer geometry mismatch`
    );
    assert.ok(
      Math.abs(list.contentOffset) <= 0.5,
      `${checkpoint.label} did not start at inverted offset zero`
    );
    const pixelRatio = model.pixelRatio;
    assert.ok(Number.isFinite(pixelRatio) && pixelRatio >= 1);
    assert.equal(
      Math.round(composer.composerHeight * pixelRatio),
      Math.round(composer.composerModelHeight * pixelRatio),
      `${checkpoint.label} composer model differed from native layout in physical pixels`
    );
    return {
      composer: {
        measuredDp: composer.composerHeight,
        measuredPx: Math.round(composer.composerHeight * pixelRatio),
        modeledDp: composer.composerModelHeight,
        modeledPx: Math.round(composer.composerModelHeight * pixelRatio)
      },
      contentOffset: list.contentOffset,
      file: checkpoint.file,
      firstRowCount: firstRows.length,
      generation: checkpoint.generation,
      label: checkpoint.label,
      rowChanges: rowChanges.length,
      rows: firstRows.map((event) => ({
        first: {
          bottomDp: event.rowBottom,
          bottomPx: Math.round(event.rowBottom * pixelRatio),
          heightDp: event.rowHeight,
          heightPx: Math.round(event.rowHeight * pixelRatio),
          topDp: event.rowTop,
          topPx: Math.round(event.rowTop * pixelRatio)
        },
        final: {
          bottomDp: event.rowBottom,
          bottomPx: Math.round(event.rowBottom * pixelRatio),
          heightDp: event.rowHeight,
          heightPx: Math.round(event.rowHeight * pixelRatio),
          topDp: event.rowTop,
          topPx: Math.round(event.rowTop * pixelRatio)
        },
        renderIndex: event.renderIndex,
        rowKey: event.rowKey
      })),
      timeline: generationEvents
        .filter((event) => [
          "CHAT_GEOMETRY_MODEL_READY",
          "CHAT_LIST_FIRST_LAYOUT",
          "CHAT_COMPOSER_FIRST_LAYOUT",
          "CHAT_ROW_FIRST_LAYOUT",
          "CHAT_ROW_LAYOUT_CHANGED",
          "CHAT_GEOMETRY_MISMATCH"
        ].includes(event.name))
        .map((event) => ({
          atMs: event.eventTimestamp - model.eventTimestamp,
          name: event.name,
          renderIndex: event.renderIndex,
          rowBottom: event.rowBottom,
          rowHeight: event.rowHeight,
          rowTop: event.rowTop
        }))
    };
  });
  assert.equal(
    events.filter((event) => event.name === "CHAT_SCROLL_COMMAND").length,
    0,
    "initial-anchor matrix issued a programmatic Chat scroll command"
  );
  assert.equal(
    events.filter((event) => event.name === "CHAT_ROW_LAYOUT_CHANGED").length,
    0,
    "initial-anchor matrix moved an already-visible row in physical pixels"
  );
  return summaries;
}

function scanAnchorInstrumentation(events) {
  const allowedFields = new Set([
    "bottomClearance",
    "clientId",
    "composerHeight",
    "composerModelHeight",
    "contentHeight",
    "contentOffset",
    "deliveryStatus",
    "eventTimestamp",
    "fontScale",
    "framesToStable",
    "keyboardInset",
    "layoutGeneration",
    "lineCount",
    "name",
    "pixelRatio",
    "renderIndex",
    "rowBottom",
    "rowHeight",
    "rowKey",
    "rowTop",
    "safeAreaInset",
    "scrollCommandSource",
    "viewportHeight"
  ]);
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    for (const field of Object.keys(event)) {
      assert.ok(allowedFields.has(field), `placement diagnostics exposed forbidden field ${field}`);
    }
    assert.ok(
      typeof event.eventTimestamp === "number" &&
      Number.isFinite(event.eventTimestamp),
      "placement diagnostic timestamp is missing"
    );
    assert.ok(
      event.eventTimestamp >= previousTimestamp,
      "placement diagnostic timestamps are not monotonic"
    );
    assert.ok(
      event.eventTimestamp < Date.now() / 2,
      "placement diagnostic used wall time instead of the monotonic clock"
    );
    previousTimestamp = event.eventTimestamp;
  }
  const report = {
    eventCount: events.length,
    eventNames: [...new Set(events.map((event) => event.name))].sort(),
    forbiddenFieldCount: 0,
    monotonicTimestamps: true,
    privacySafe: true,
    status: "PASS"
  };
  writeFileSync(
    `${artifactDir}/profile-instrumentation-scan.json`,
    `${JSON.stringify(report, null, 2)}\n`
  );
  return report;
}

function createAnchorContactSheet() {
  const rows = Math.ceil(anchorScreenshotCount / 4);
  run("/opt/homebrew/bin/ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-framerate", "1",
    "-start_number", "1",
    "-i", `${artifactDir}/anchor-%02d.png`,
    "-vf", `scale=270:-1,tile=4x${rows}`,
    "-frames:v", "1",
    `${artifactDir}/contact-sheet.png`
  ]);
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
  recorder = null;
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  assert.ok(
    ["anchor", "exit", "full", "journey", "media", "stale", "tail"].includes(scenario),
    `Unsupported scenario: ${scenario}`
  );
  assert.ok(["image", "video"].includes(mediaKind), `Unsupported media kind: ${mediaKind}`);
  const device = await readConnectedDevice();
  if (scenario === "media" || scenario === "journey") await prepareSyntheticMediaFixtures();
  const env = localStatus();
  const admin = createClient(env.url, env.serviceKey, authOptions);
  let apkVerification = null;
  if (process.env.ANDROID_MEMORY_SKIP_BUILD !== "1") {
    if (anchorScenario) {
      buildAnchorReleaseAndroid(env);
    } else {
      buildInstrumentedAndroid(env);
    }
  }
  if (anchorScenario) apkVerification = verifyAnchorReleaseArtifact(env);
  fixture = await seed(
    admin,
    scenario === "journey" || anchorScenario,
    anchorScenario
  );
  if (anchorScenario) {
    const [exact50, exact8] = await Promise.all([
      admin.from("shared_memory_messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", fixture.roomId),
      admin.from("shared_memory_messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", fixture.secondRoomId)
    ]);
    if (exact50.error) throw exact50.error;
    if (exact8.error) throw exact8.error;
    assert.equal(exact50.count, 50, "primary anchor room is not exactly 50 messages");
    assert.equal(exact8.count, 8, "secondary anchor room is not exactly 8 messages");
  }
  const output = startServer(env);
  await waitForServer(output);
  if (scenario === "media" || scenario === "journey") startSyntheticMediaProcessingPump(admin);
  if (!anchorScenario) {
    const metroOutput = startInstrumentedMetro(env);
    await waitForMetro(metroOutput);
  }

  const supabasePort = new URL(env.url).port;
  await adbRun(["reverse", `tcp:${apiPort}`, `tcp:${apiPort}`]);
  await adbRun(["reverse", `tcp:${supabasePort}`, `tcp:${supabasePort}`]);
  if (!anchorScenario) {
    await adbRun(["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
  }
  if (scenario === "media" || scenario === "journey") {
    await adbRun(["reverse", `tcp:${fixturePort}`, `tcp:${fixturePort}`]);
  }
  run(process.execPath, ["scripts/android-installed-profile-login.mjs", "--stop-server-after"], {
    env: {
      ...process.env,
      ANDROID_APP_ACTIVITY: "com.circlebites.mobile.MainActivity",
      ANDROID_APP_PACKAGE: packageName,
      ANDROID_APK_PATH: apkPath,
      ANDROID_LOGIN_EMAIL: fixture.email,
      ANDROID_PROFILE_GRANT_LOCATION: "1",
      ANDROID_PROFILE_ARTIFACT_DIR: `${artifactDir}/login`,
      ANDROID_PROFILE_SUCCESS_TEXT: "Device Visual,Posts,Memories",
      ANDROID_SERIAL: serial,
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
      ...(anchorScenario ? {} : {
        ANDROID_APP_LAUNCH_URL:
          `witoh-dev://expo-development-client/?url=${encodeURIComponent(metroBaseUrl)}`
      })
    }
  });

  await adbRun(["shell", "pm", "grant", packageName, "android.permission.RECORD_AUDIO"], true);
  // Attach diagnostics before room navigation so entry, cache, subscription,
  // and first-tab events are part of the same correlated journey.
  await adbRun(["logcat", "-c"]);
  startPlacementLogger();
  await adbRun(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
  let remoteRecording = await startRecording();
  if (scenario !== "journey" && !anchorScenario) await navigateToChat();

  if (anchorScenario) {
    const memorySamples = [await sampleMemory("anchor_profile_baseline")];
    const checkpoints = [];
    let generation = 0;
    const checkpoint = async (label) => {
      const captured = await captureAnchorCheckpoint(label, generation);
      generation = captured.generation;
      checkpoints.push(captured);
    };

    await navigateToRoom("Visual validation");
    await switchRoomTab("Chat");
    await checkpoint("exact50_cold_first_open_from_table_keyboard_closed");
    await switchRoomTab("Table");
    await switchRoomTab("Chat");
    await checkpoint("exact50_warm_return_from_table");
    await switchRoomTab("Media");
    await switchRoomTab("Chat");
    await checkpoint("exact50_warm_return_from_media");
    await switchRoomTab("Dishes");
    await switchRoomTab("Chat");
    await checkpoint("exact50_warm_return_from_dishes");
    const composer50 = await waitForPoint(["Type a message"], "exact-50 composer");
    await tap(composer50.point);
    await delay(350);
    await switchRoomTab("Table");
    await switchRoomTab("Chat");
    await checkpoint("exact50_return_after_keyboard_open");

    await exitRoomFromTableAfterChatVisit();
    await navigateToRoom("Visual validation");
    await switchRoomTab("Chat");
    await checkpoint("exact50_cold_room_reentry");
    await exitRoomFromTableAfterChatVisit();

    await navigateToRoom("Visual validation B");
    await switchRoomTab("Chat");
    await checkpoint("exact8_cold_first_open_from_table_keyboard_closed");
    await switchRoomTab("Table");
    await switchRoomTab("Chat");
    await checkpoint("exact8_warm_return_from_table");
    await switchRoomTab("Media");
    await switchRoomTab("Chat");
    await checkpoint("exact8_warm_return_from_media");
    await switchRoomTab("Dishes");
    await switchRoomTab("Chat");
    await checkpoint("exact8_warm_return_from_dishes");
    const composer8 = await waitForPoint(["Type a message"], "exact-8 composer");
    await tap(composer8.point);
    await delay(350);
    await switchRoomTab("Table");
    await switchRoomTab("Chat");
    await checkpoint("exact8_return_after_keyboard_open");

    await sendText("AnchorPending");
    await delay(100);
    anchorScreenshotCount += 1;
    await captureScreenshot(
      `${artifactDir}/anchor-${String(anchorScreenshotCount).padStart(2, "0")}.png`
    );
    const sentEvents = await waitForSendCount(1, 20_000);
    const anchorClientId = sentEvents.find(
      (event) => event.name === "SEND_PRESS"
    )?.clientId;
    assert.ok(anchorClientId, "pending/sent anchor fixture had no logical client id");
    await waitForClientEvent(anchorClientId, "HTTP_CONFIRMED", 20_000);
    await delay(850);
    anchorScreenshotCount += 1;
    await captureScreenshot(
      `${artifactDir}/anchor-${String(anchorScreenshotCount).padStart(2, "0")}.png`
    );
    memorySamples.push(await sampleMemory("anchor_after_matrix"));

    const gfx = parseGfx(
      await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true)
    );
    await stopRecording(remoteRecording);
    const streams = await writeRuntimeStreams();
    const anchor = summarizeAnchorCheckpoints(streams.placement, checkpoints);
    const instrumentationScan = scanAnchorInstrumentation(streams.placement);
    const journey = summarizeJourney(streams.journey);
    const chatTransitions = journey.tabTransitions.filter(
      (transition) => transition.to === "chat"
    );
    const timingValues = (name) => anchor.map((checkpoint) => (
      checkpoint.timeline.find((event) => event.name === name)?.atMs ?? null
    )).filter(Number.isFinite);
    const firstRowValues = anchor.map((checkpoint) => Math.min(
      ...checkpoint.timeline
        .filter((event) => event.name === "CHAT_ROW_FIRST_LAYOUT")
        .map((event) => event.atMs)
    ));
    const serializedPlacement = JSON.stringify(streams.placement);
    for (const privateValue of [
      "Anchor short",
      "Anchor multiline",
      "Anchor reply",
      "Eight room",
      "AnchorPending",
      fixture.username,
      "http://",
      "https://",
      "/Users/"
    ]) {
      assert.equal(
        serializedPlacement.includes(privateValue),
        false,
        `anchor diagnostics leaked forbidden content: ${privateValue}`
      );
    }
    createAnchorContactSheet();
    const report = {
      anchor,
      apkVerification,
      artifact: `${artifactDir}/memory-chat-visual.mp4`,
      contactSheet: `${artifactDir}/contact-sheet.png`,
      device,
      fixture: {
        exact50Messages: 50,
        exact8Messages: 8,
        participants: 3,
        rooms: 2
      },
      gfx,
      instrumentationScan,
      journey,
      matrix: {
        coldRoomEntry: true,
        exact8: true,
        exact50: true,
        firstChatOpening: true,
        incomingAndOutgoing: true,
        keyboardClosed: true,
        keyboardPreviouslyOpen: true,
        multilineAndShort: true,
        pendingAndSent: true,
        replies: true,
        returnFromDishes: true,
        returnFromMedia: true,
        returnFromTable: true,
        warmRoomReentry: true
      },
      memorySamples,
      movementThresholdPhysicalPixels: 0,
      observationWindowMs: 750,
      performance: {
        chatFirstRowMaxMs: Math.max(...firstRowValues),
        chatFirstRowMinMs: Math.min(...firstRowValues),
        chatListFirstLayoutMaxMs: Math.max(...timingValues("CHAT_LIST_FIRST_LAYOUT")),
        chatListFirstLayoutMinMs: Math.min(...timingValues("CHAT_LIST_FIRST_LAYOUT")),
        composerFirstLayoutMaxMs: Math.max(...timingValues("CHAT_COMPOSER_FIRST_LAYOUT")),
        composerFirstLayoutMinMs: Math.min(...timingValues("CHAT_COMPOSER_FIRST_LAYOUT")),
        maxJourneyMountDeltaToChat: Math.max(
          ...chatTransitions.map((transition) => transition.mountCount ?? 0)
        ),
        maxJourneyRenderDeltaToChat: Math.max(
          ...chatTransitions.map((transition) => transition.renderCount ?? 0)
        ),
        pssDeltaKb:
          memorySamples.at(-1).totalPssKb - memorySamples[0].totalPssKb,
        viewCountDelta:
          memorySamples.at(-1).viewCount - memorySamples[0].viewCount
      },
      scenario: "initialChatBottomAnchor",
      scrollCommandCount: streams.placement.filter(
        (event) => event.name === "CHAT_SCROLL_COMMAND"
      ).length,
      status: "PASS"
    };
    writeFileSync(
      `${artifactDir}/report.json`,
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(JSON.stringify(report, null, 2));
    await cleanup(admin, fixture);
    fixture = null;
    return;
  }

  if (scenario === "journey") {
    const memorySamples = [await sampleMemory("profile_baseline")];
    await navigateToRoom();
    await waitForJourneyAction("TAB_USABLE", "overview");
    memorySamples.push(await sampleMemory("room_entry"));
    await fastScrollCurrentSurface();

    await switchRoomTab("Dishes");
    const rating = await waitForPattern(
      /Rate Fixture dish \d+ 5 out of 5/i,
      "visible dish rating control"
    );
    await tap(rating);
    const dishMutationStarted = await waitForJourneyAction("DISH_MUTATION_STARTED", "dishes");
    await waitForJourneyActionAfter(
      "DISH_MUTATION_FINISHED",
      "dishes",
      dishMutationStarted.monotonicTimestampMs
    );
    await fastScrollCurrentSurface();

    await switchRoomTab("Chat");
    await waitForPoint(["Type a message"], "representative Chat composer");
    // The development-only fixture posts one image and one video through the
    // real upload/outbox path. Stay on Chat until both are durably confirmed.
    let placement = await waitForSendCount(2, 180_000);
    const fixtureSendIds = placement
      .filter((event) => event.name === "SEND_PRESS")
      .slice(0, 2)
      .map((event) => event.clientId);
    await waitForAllConfirmations(fixtureSendIds, 180_000);
    memorySamples.push(await sampleMemory("after_media_uploads"));

    await sendRapidTextBurst(["A", "B", "C", "D", "E"], null, 0.08, true);
    await waitForSendCount(7, 30_000);
    await sendMultiline();
    await waitForSendCount(8, 20_000);
    await replyToVisibleFixtureMessage();
    await waitForSendCount(9, 20_000);

    // This first Media switch deliberately happens with the Chat composer and
    // Gboard still open. Background/foreground is exercised after viewer use;
    // that path explicitly closes the restored IME before continuing because
    // Android consumes the first header touch while restoring its IME window.
    await switchRoomTab("Media");
    const photo = await waitForPoint(["Open photo"], "uploaded photo in Media", 90_000);
    await tap(photo.point);
    const viewerClose = await waitForPoint(["Close media viewer"], "photo viewer");
    memorySamples.push(await sampleMemory("image_viewer"));
    await adbRun(["shell", "input", "swipe", "900", "1200", "180", "1200", "300"]);
    await delay(1_000);
    await tap(viewerClose.point);
    await waitForJourneyAction("MEDIA_VIEWER_CLOSED", "media");
    await waitForPoint(["Open photo", "Open video"], "Media grid after viewer close");
    memorySamples.push(await sampleMemory("after_viewer_close"));
    const video = await waitForPoint(["Open video"], "uploaded video in Media", 30_000);
    const videoViewerOpenedAt = journeyEventStream.findLast(
      (event) => event.action === "MEDIA_VIEWER_OPENED" && event.tab === "media"
    )?.monotonicTimestampMs ?? 0;
    await tap(video.point);
    const videoViewerOpened = await waitForJourneyActionAfter(
      "MEDIA_VIEWER_OPENED",
      "media",
      videoViewerOpenedAt + 0.001
    );
    await waitForJourneyActionAfter(
      "PLAYER_CREATED",
      "media",
      videoViewerOpened.monotonicTimestampMs
    );
    await adbRun(["shell", "input", "tap", "540", "1200"]);
    await delay(1_500);
    memorySamples.push(await sampleMemory("video_playback"));
    await tap(viewerClose.point);
    await waitForJourneyActionAfter(
      "MEDIA_VIEWER_CLOSED",
      "media",
      videoViewerOpened.monotonicTimestampMs
    );

    await switchRoomTab("Chat");
    await backgroundAndForeground();
    memorySamples.push(await sampleMemory("after_chat_background"));

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const tab of ["Table", "Media", "Dishes", "Chat"]) {
        await switchRoomTab(tab);
      }
    }
    memorySamples.push(await sampleMemory("after_10_tab_cycles"));

    physicalNetworkDisabled = true;
    await setPhysicalNetworkEnabled(false);
    await switchRoomTab("Chat");
    await sendText("OfflineJourney");
    await delay(1_000);
    await backgroundAndForeground();
    await setPhysicalNetworkEnabled(true);
    physicalNetworkDisabled = false;
    await delay(5_000);
    await waitForPoint(["Type a message"], "Chat after reconnect");
    memorySamples.push(await sampleMemory("after_reconnect"));

    const firstExitMs = await exitRoomFromTableAfterChatVisit();
    memorySamples.push(await sampleMemory("after_first_exit"));
    await navigateToRoom("Visual validation B");
    await switchRoomTab("Chat");
    const alternateXml = await uiXml();
    assert.ok(
      pointFor(alternateXml, ["Alternate room message"]),
      "alternate room did not show its own message history"
    );
    assert.equal(
      pointFor(alternateXml, ["Fixture message 60"]),
      null,
      "room A content leaked into room B"
    );
    const secondExitMs = await exitRoomFromTableAfterChatVisit();
    await navigateToRoom("Visual validation");
    await switchRoomTab("Chat");
    const returnedXml = await uiXml();
    assert.equal(
      pointFor(returnedXml, ["Alternate room message"]),
      null,
      "room B content leaked into room A"
    );
    const finalExitMs = await exitRoomFromTableAfterChatVisit();
    await delay(1_000);
    memorySamples.push(await sampleMemory("after_room_switching_exit"));

    const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
    await stopRecording(remoteRecording);
    const streams = await writeRuntimeStreams();
    const journey = summarizeJourney(streams.journey);
    const serializedJourney = JSON.stringify(streams.journey);
    for (const privateValue of [
      "Fixture message",
      "Visual validation",
      fixture.username,
      "http://",
      "https://"
    ]) {
      assert.equal(
        serializedJourney.includes(privateValue),
        false,
        `journey diagnostics leaked forbidden value: ${privateValue}`
      );
    }
    assert.ok(journey.actionCounts.ROOM_SCREEN_MOUNT >= 3, "room entry instrumentation was incomplete");
    assert.ok(journey.actionCounts.TAB_PRESS >= 40, "tab-switch journey did not cover ten full cycles");
    assert.ok(journey.actionCounts.REALTIME_UNSUBSCRIBED >= 3, "room subscriptions did not clean up");

    const report = {
      artifact: `${artifactDir}/memory-chat-visual.mp4`,
      device,
      fixture: {
        dishes: 12,
        mediaKinds: ["image", "video"],
        messages: 65,
        participants: 3,
        rooms: 2,
        stops: 3
      },
      gfx,
      journey,
      memorySamples,
      requests: summarizeServerRequests(serverOutput.join("")),
      roomExitMs: [firstExitMs, secondExitMs, finalExitMs],
      scenario: "completeMemoryRoomJourney",
      status: tabTapRetryCount === 0 ? "PASS" : "PASS_WITH_TAB_TAP_RETRIES",
      tabTapRetryCount
    };
    writeFileSync(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await cleanup(admin, fixture);
    fixture = null;
    return;
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
    await writeRuntimeStreams();

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

  if (scenario === "exit") {
    await sendRapidTextBurst(
      Array.from({ length: 20 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`),
      null,
      0.05,
      true
    );
    const events = await waitForSendCount(20, 30_000);
    const sendIds = events
      .filter((event) => event.name === "SEND_PRESS")
      .slice(0, 20)
      .map((event) => event.clientId);
    await waitForAllConfirmations(sendIds, 60_000);
    const roomExitAfterChatMs = await exitRoomFromTableAfterChatVisit();
    const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
    await stopRecording(remoteRecording);
    await writeRuntimeStreams();

    const report = {
      artifact: `${artifactDir}/memory-chat-visual.mp4`,
      device,
      gfx,
      messagesBeforeExit: sendIds.length,
      roomExitAfterChatMs,
      scenario: "roomExitAfterRichChat",
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
    await writeRuntimeStreams();

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
    const roomExitAfterChatMs = await exitRoomFromTableAfterChatVisit();
    const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
    await stopRecording(remoteRecording);
    await writeRuntimeStreams();

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
      roomExitAfterChatMs,
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
  const roomExitAfterChatMs = await exitRoomFromTableAfterChatVisit();
  const gfx = parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true));
  await stopRecording(remoteRecording);
  await writeRuntimeStreams();

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
    roomExitAfterChatMs,
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
  await captureScreenshot(`${artifactDir}/failure-screen.png`).catch(() => {});
  if (recorder) {
    await stopRecording("/sdcard/memory-chat-visual.mp4").catch(() => {});
  }
  const events = await readPlacementEvents().catch(() => []);
  const journey = await readJourneyEvents().catch(() => []);
  writeFileSync(`${artifactDir}/events.json`, `${JSON.stringify(events, null, 2)}\n`);
  writeFileSync(`${artifactDir}/journey-events.json`, `${JSON.stringify(journey, null, 2)}\n`);
  writeFileSync(`${artifactDir}/failure.json`, `${JSON.stringify({
    error: error instanceof Error ? error.message : "unknown_failure",
    mediaWorkerOutput: mediaWorkerOutput.join("").slice(-12_000),
    serverOutput: serverOutput.join("").slice(-12_000)
  }, null, 2)}\n`);
  throw error;
} finally {
  if (physicalNetworkDisabled) await setPhysicalNetworkEnabled(true).catch(() => {});
  if (recorder?.exitCode === null) recorder.kill("SIGINT");
  if (placementLogger?.exitCode === null) placementLogger.kill("SIGTERM");
  if (mediaPumpTimer) clearInterval(mediaPumpTimer);
  if (metro?.exitCode === null) metro.kill("SIGTERM");
  if (server?.exitCode === null) server.kill("SIGTERM");
  if (fixtureServer) fixtureServer.close();
  if (fixture) {
    const env = localStatus();
    await cleanup(createClient(env.url, env.serviceKey, authOptions), fixture).catch(() => {});
  } else if (fixtureSeedUsers.length > 0) {
    const env = localStatus();
    const admin = createClient(env.url, env.serviceKey, authOptions);
    for (const user of fixtureSeedUsers) {
      try {
        await admin.from("profiles").delete().eq("id", user.userId);
      } catch {
        // Best-effort cleanup after a partially constructed synthetic fixture.
      }
      await admin.auth.admin.deleteUser(user.userId).catch(() => {});
    }
    fixtureSeedUsers = [];
  }
}
