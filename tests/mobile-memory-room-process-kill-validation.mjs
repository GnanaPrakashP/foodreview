#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const adb = process.env.ADB ?? "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const serial = process.env.ANDROID_SERIAL ?? "ZA223JVWG7";
const packageName = process.env.ANDROID_APP_PACKAGE ?? "com.circlebites.mobile.dev";
const roomTitle = process.env.MEMORY_RELEASE_ROOM_TITLE ?? "Release acceptance A";
const artifactDir = process.env.MEMORY_RELEASE_ARTIFACT_DIR ??
  "/private/tmp/memory-room-release-process-kill";
const reversePorts = (process.env.MEMORY_RELEASE_REVERSE_PORTS ?? "3036,54321")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

function localStatus() {
  const result = spawnSync(process.execPath, [
    "scripts/run-supabase.mjs",
    "status",
    "-o",
    "json"
  ], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Local Supabase is unavailable");
  const status = JSON.parse(result.stdout);
  return { serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

async function uiXml() {
  await adbRun(["shell", "uiautomator", "dump", "/sdcard/memory-process-kill.xml"], true);
  return adbRun(["shell", "cat", "/sdcard/memory-process-kill.xml"], true);
}

function decodedXml(xml) {
  return xml.replaceAll("&apos;", "'").replaceAll("&quot;", "\"").replaceAll("&amp;", "&");
}

function nodes(xml) {
  return decodedXml(xml).match(/<node\b[^>]*>/g) ?? [];
}

function nodeFor(xml, labels) {
  for (const label of labels) {
    const expected = label.toLowerCase();
    const exact = nodes(xml).find((node) => {
      const text = /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      const description = /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      return text === expected || description === expected;
    });
    if (exact) return exact;
    const partial = nodes(xml).find((node) => {
      const text = /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      const description = /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      return text.includes(expected) || description.includes(expected);
    });
    if (partial) return partial;
  }
  return null;
}

function boundsFor(xml, labels) {
  const bounds = nodeFor(xml, labels)?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) return null;
  return {
    bottom: Number(bounds[4]),
    left: Number(bounds[1]),
    right: Number(bounds[3]),
    top: Number(bounds[2])
  };
}

function pointFor(xml, labels) {
  const bounds = boundsFor(xml, labels);
  if (!bounds) return null;
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2)
  };
}

async function waitForPoint(labels, description, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const point = pointFor(await uiXml(), labels);
    if (point) return point;
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function tap(point) {
  await adbRun(["shell", "input", "tap", String(point.x), String(point.y)]);
}

async function launch() {
  await adbRun([
    "shell", "monkey", "-p", packageName,
    "-c", "android.intent.category.LAUNCHER", "1"
  ]);
  await delay(2_000);
}

async function openRoomChat() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const xml = await uiXml();
    const composer = pointFor(xml, ["Type a message"]);
    if (composer) return;
    const table = pointFor(xml, ["Table"]);
    const chat = pointFor(xml, ["Chat"]);
    if (table && chat) {
      await tap(chat);
      await waitForPoint(["Type a message"], "chat composer");
      return;
    }
    const room = pointFor(xml, [roomTitle]);
    if (room) {
      await tap(room);
      await waitForPoint(["Table"], "room table tab");
      continue;
    }
    const memories = pointFor(xml, ["Memories"]);
    if (memories) {
      await tap(memories);
      await delay(700);
      continue;
    }
    const profile = pointFor(xml, ["Profile"]);
    if (profile) {
      await tap(profile);
      await delay(700);
      continue;
    }
    await launch();
  }
  throw new Error("Could not navigate to the release fixture chat");
}

async function sendBody(body, settleMs = 250) {
  const composer = await waitForPoint(["Type a message"], "chat composer");
  await tap(composer);
  await adbRun(["shell", "input", "text", body]);
  const send = await waitForPoint(["Send message"], "send button");
  await tap(send);
  await delay(settleMs);
}

async function sendReply(targetBody, replyBody) {
  await delay(700);
  const bounds = boundsFor(await uiXml(), [targetBody]);
  assert.ok(bounds, "pending text must be visible before starting its reply");
  const startX = Math.max(bounds.left + 12, Math.round((bounds.left + bounds.right) / 2));
  const y = Math.round((bounds.top + bounds.bottom) / 2);
  await adbRun([
    "shell", "input", "swipe",
    String(startX), String(y), String(Math.min(1220, startX + 360)), String(y), "320"
  ]);
  await waitForPoint(["Cancel reply"], "reply composer");
  await sendBody(replyBody);
}

async function setBackendAvailable(available) {
  if (available) {
    for (const port of reversePorts) {
      await adbRun(["reverse", "--remove", `tcp:${port}`], true);
      await adbRun(["reverse", `tcp:${port}`, `tcp:${port}`]);
    }
  } else {
    for (const port of reversePorts) {
      await adbRun(["reverse", "--remove", `tcp:${port}`], true);
    }
  }
  const routes = await adbRun(["reverse", "--list"], true);
  for (const port of reversePorts) {
    assert.equal(
      routes.includes(`tcp:${port} tcp:${port}`),
      available,
      `reverse route ${port} must be ${available ? "present" : "absent"}`
    );
  }
}

async function setBackendProxyTargets(targets) {
  for (const [devicePort, hostPort] of targets) {
    await adbRun(["reverse", "--remove", `tcp:${devicePort}`], true);
    await adbRun(["reverse", `tcp:${devicePort}`, `tcp:${hostPort}`]);
  }
  const routes = await adbRun(["reverse", "--list"], true);
  for (const [devicePort, hostPort] of targets) {
    assert.ok(
      routes.includes(`tcp:${devicePort} tcp:${hostPort}`),
      `reverse route ${devicePort} must target ${hostPort}`
    );
  }
}

async function startAmbiguousResponseProxy() {
  let resolveDropped;
  let responseDropped = false;
  const dropped = new Promise((resolve) => {
    resolveDropped = resolve;
  });
  const sockets = new Set();

  function proxyServer(listenPort, targetPort, dropMessageResponse) {
    return createServer((client) => {
      sockets.add(client);
      const upstream = connect({ host: "127.0.0.1", port: targetPort });
      sockets.add(upstream);
      let requestBuffer = Buffer.alloc(0);
      let requestClassified = !dropMessageResponse;
      let shouldDropResponse = false;

      client.on("data", (chunk) => {
        if (requestClassified) {
          upstream.write(chunk);
          return;
        }
        requestBuffer = Buffer.concat([requestBuffer, chunk]);
        const headerEnd = requestBuffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const requestLine = requestBuffer.subarray(0, headerEnd).toString("utf8").split("\r\n")[0] ?? "";
        shouldDropResponse = /^POST \/api\/mobile\/memories\/[^/]+\/messages(?:\?| )/.test(requestLine);
        requestClassified = true;
        upstream.write(requestBuffer);
        requestBuffer = Buffer.alloc(0);
      });
      upstream.on("data", (chunk) => {
        if (shouldDropResponse && !responseDropped) {
          responseDropped = true;
          resolveDropped();
          client.destroy();
          upstream.destroy();
          return;
        }
        client.write(chunk);
      });
      const closeBoth = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", closeBoth);
      upstream.on("error", closeBoth);
      client.on("close", () => sockets.delete(client));
      upstream.on("close", () => sockets.delete(upstream));
    }).listen(listenPort, "127.0.0.1");
  }

  const servers = [
    proxyServer(31_136, 3_036, true),
    proxyServer(55_321, 54_321, false)
  ];
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  })));
  return {
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    },
    waitForDrop: () => Promise.race([
      dropped,
      delay(15_000).then(() => {
        throw new Error("Timed out waiting to drop committed message response");
      })
    ])
  };
}

async function terminateProcess() {
  await adbRun(["shell", "am", "force-stop", packageName]);
  const pid = await adbRun(["shell", "pidof", packageName], true);
  assert.equal(pid.trim(), "", "app process must be terminated");
}

async function rowsFor(admin, roomId, body) {
  const response = await admin
    .from("shared_memory_messages")
    .select("id,reply_to_message_id")
    .eq("room_id", roomId)
    .eq("body", body);
  if (response.error) throw response.error;
  return response.data ?? [];
}

async function waitForSingleRow(admin, roomId, body, timeoutMs = 25_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await rowsFor(admin, roomId, body);
    if (rows.length === 1) return rows[0];
    assert.ok(rows.length < 2, "recovery created a duplicate logical message");
    await delay(500);
  }
  throw new Error("Recovered message was not committed");
}

async function recoverIntoRoom() {
  await launch();
  await openRoomChat();
  await delay(1_000);
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const fixture = JSON.parse(readFileSync(
    "/private/tmp/memory-room-release-acceptance/fixture.json",
    "utf8"
  ));
  const roomId = fixture.roomIds[0];
  const status = localStatus();
  const admin = createClient(status.url, status.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const stamp = Date.now().toString(36);
  const pendingText = `pkill_text_${stamp}`;
  const pendingReply = `pkill_reply_${stamp}`;
  const ambiguousText = `pkill_ambiguous_${stamp}`;
  const report = {
    ambiguousSuccess: null,
    build: "signed minified Hermes release/profile",
    packageName,
    pendingReply: null,
    pendingText: null,
    status: "RUNNING"
  };

  await adbRun(["logcat", "-c"], true);
  await openRoomChat();
  await setBackendAvailable(false);
  await sendBody(pendingText);
  assert.equal((await rowsFor(admin, roomId, pendingText)).length, 0);
  await terminateProcess();
  await setBackendAvailable(true);
  await recoverIntoRoom();
  const recoveredText = await waitForSingleRow(admin, roomId, pendingText);
  report.pendingText = { databaseRows: 1, offlineBeforeKill: true, recovered: true };

  await setBackendAvailable(false);
  await sendReply(pendingText, pendingReply);
  assert.equal((await rowsFor(admin, roomId, pendingReply)).length, 0);
  await terminateProcess();
  await setBackendAvailable(true);
  await recoverIntoRoom();
  const recoveredReply = await waitForSingleRow(admin, roomId, pendingReply);
  assert.equal(recoveredReply.reply_to_message_id, recoveredText.id);
  report.pendingReply = {
    databaseRows: 1,
    offlineBeforeKill: true,
    relationshipRecovered: true
  };

  const ambiguousProxy = await startAmbiguousResponseProxy();
  try {
    await setBackendProxyTargets([["3036", "31136"], ["54321", "55321"]]);
    // Existing HTTP keep-alive sockets retain their original ADB reverse
    // destination. Restart after remapping so the ambiguous send is guaranteed
    // to cross the controlled response boundary.
    await terminateProcess();
    await recoverIntoRoom();
    await sendBody(ambiguousText, 0);
    await ambiguousProxy.waitForDrop();
    await delay(300);
    await terminateProcess();
  } finally {
    await ambiguousProxy.stop();
    await setBackendAvailable(true);
  }
  const beforeRecovery = await rowsFor(admin, roomId, ambiguousText);
  assert.equal(beforeRecovery.length, 1, "server must commit before the withheld response");
  await recoverIntoRoom();
  await waitForSingleRow(admin, roomId, ambiguousText);
  report.ambiguousSuccess = {
    committedBeforeRecovery: beforeRecovery.length === 1,
    databaseRows: 1,
    reconciledWithoutDuplicate: true
  };

  const crashLog = await adbRun(["logcat", "-d", "-b", "crash", "-v", "brief"], true);
  const packagePattern = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  report.runtimeErrors = {
    fatal: (crashLog.match(new RegExp(`Process:\\s*${packagePattern}`, "g")) ?? []).length
  };
  assert.equal(report.runtimeErrors.fatal, 0);
  report.status = "PASS";
  writeFileSync(`${artifactDir}/process-kill-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} finally {
  await setBackendAvailable(true);
}
