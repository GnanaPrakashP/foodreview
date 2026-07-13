#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  return exact ? exact.slice(name.length + 1) : fallback;
};
const budgets = JSON.parse(readFileSync(resolve(root, "config/mobile-performance-budgets.json"), "utf8"));
const packageName = valueFor("--package", process.env.ANDROID_APP_PACKAGE ?? "com.circlebites.mobile");
const activity = valueFor("--activity", process.env.ANDROID_APP_ACTIVITY ?? ".MainActivity");
const outputPath = valueFor("--output", "");
const sampleCount = Number(valueFor("--samples", String(budgets.measurementRules.coldSamples)));
const serialArg = valueFor("--serial", process.env.ANDROID_SERIAL ?? "");
const adb = resolveAdb();

function resolveAdb() {
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME, "platform-tools/adb") : null,
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
    "/opt/homebrew/bin/adb",
    "adb"
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "adb" || existsSync(candidate)) ?? "adb";
}

async function command(file, commandArgs, allowFailure = false) {
  try {
    const result = await execFileAsync(file, commandArgs, { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw error;
  }
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const adbArgs = (serial, commandArgs) => serial ? ["-s", serial, ...commandArgs] : commandArgs;
const runAdb = (serial, commandArgs, allowFailure = false) => command(adb, adbArgs(serial, commandArgs), allowFailure);

function numericLine(output, label) {
  const match = new RegExp(`(?:^|\\n)${label}:\\s*(\\d+)`, "m").exec(output);
  return match ? Number(match[1]) : null;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summarize(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return { samples: 0, min: null, median: null, p95: null, max: null };
  return {
    samples: valid.length,
    min: Math.min(...valid),
    median: percentile(valid, 0.5),
    p95: percentile(valid, 0.95),
    max: Math.max(...valid)
  };
}

function parsePerformanceEvents(logcat) {
  const events = [];
  for (const line of logcat.split("\n")) {
    const payload = /CB_PERF\s+(\{.*\})/.exec(line)?.[1];
    if (!payload) continue;
    try {
      const event = JSON.parse(payload);
      if (typeof event.name === "string") events.push(event);
    } catch {
      // Ignore a partial logcat line; the next sample remains usable.
    }
  }
  return events;
}

async function readPerformanceEvents(serial) {
  const output = await runAdb(serial, ["logcat", "-d", "-v", "brief", "ReactNativeJS:I", "*:S"], true);
  return parsePerformanceEvents(output);
}

async function waitForEvent(serial, name, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = (await readPerformanceEvents(serial)).findLast((event) => event.name === name);
    if (match) return match;
    await delay(250);
  }
  return null;
}

async function memorySnapshot(serial) {
  const output = await runAdb(serial, ["shell", "dumpsys", "meminfo", packageName], true);
  const pss = /TOTAL PSS:\s*(\d+)/.exec(output)?.[1] ?? /^\s*TOTAL\s+(\d+)/m.exec(output)?.[1];
  const rss = /TOTAL RSS:\s*(\d+)/.exec(output)?.[1];
  return { pssKb: pss ? Number(pss) : null, rssKb: rss ? Number(rss) : null };
}

function parseGfx(output) {
  const total = /Total frames rendered:\s*(\d+)/.exec(output)?.[1];
  const janky = /Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/.exec(output);
  const p50 = /50th percentile:\s*(\d+)ms/.exec(output)?.[1];
  const p90 = /90th percentile:\s*(\d+)ms/.exec(output)?.[1];
  const p95 = /95th percentile:\s*(\d+)ms/.exec(output)?.[1];
  const p99 = /99th percentile:\s*(\d+)ms/.exec(output)?.[1];
  return {
    totalFrames: total ? Number(total) : null,
    jankyFrames: janky ? Number(janky[1]) : null,
    jankyPercent: janky ? Number(janky[2]) : null,
    frameTimePercentilesMs: {
      p50: p50 ? Number(p50) : null,
      p90: p90 ? Number(p90) : null,
      p95: p95 ? Number(p95) : null,
      p99: p99 ? Number(p99) : null
    }
  };
}

async function screenSize(serial) {
  const output = await runAdb(serial, ["shell", "wm", "size"]);
  const match = /(?:Physical|Override) size:\s*(\d+)x(\d+)/g;
  const sizes = [...output.matchAll(match)];
  const selected = sizes[sizes.length - 1];
  if (!selected) throw new Error("Could not determine Android screen size");
  return { width: Number(selected[1]), height: Number(selected[2]) };
}

async function tapTab(serial, size, tab) {
  const center = { circle: 0.125, explore: 0.375, profile: 0.875 }[tab];
  const x = Math.round(size.width * center);
  const y = size.height - Math.max(72, Math.round(size.height * 0.04));
  await runAdb(serial, ["shell", "input", "tap", String(x), String(y)]);
}

async function collectTabSamples(serial, size, target, count) {
  const cached = [];
  const settled = [];
  for (let index = 0; index < count; index += 1) {
    const source = target === "circle" ? "explore" : "circle";
    await tapTab(serial, size, source);
    await delay(500);
    await runAdb(serial, ["logcat", "-c"], true);
    await tapTab(serial, size, target);
    const cachedEvent = await waitForEvent(serial, `tab.${target}.cached_content`);
    const settledEvent = await waitForEvent(serial, `tab.${target}.fresh_settled`, 5_000);
    if (Number.isFinite(cachedEvent?.durationMs)) cached.push(cachedEvent.durationMs);
    if (Number.isFinite(settledEvent?.durationMs)) settled.push(settledEvent.durationMs);
  }
  return { cached: summarize(cached), freshSettled: summarize(settled) };
}

async function main() {
  const devicesOutput = await command(adb, ["devices"]);
  const devices = devicesOutput.split("\n").slice(1).map((line) => line.trim().split(/\s+/)).filter((parts) => parts[1] === "device").map((parts) => parts[0]);
  const serial = serialArg || devices[0];
  if (!serial) throw new Error("No Android device or emulator is available");
  if (!(await runAdb(serial, ["shell", "pm", "path", packageName], true)).includes("package:")) {
    throw new Error(`Release/profile package is not installed: ${packageName}`);
  }

  const [model, osVersion, sdk, packageInfo, size] = await Promise.all([
    runAdb(serial, ["shell", "getprop", "ro.product.model"]),
    runAdb(serial, ["shell", "getprop", "ro.build.version.release"]),
    runAdb(serial, ["shell", "getprop", "ro.build.version.sdk"]),
    runAdb(serial, ["shell", "dumpsys", "package", packageName]),
    screenSize(serial)
  ]);
  const versionName = /versionName=([^\s]+)/.exec(packageInfo)?.[1] ?? null;
  const versionCode = /versionCode=(\d+)/.exec(packageInfo)?.[1] ?? null;
  const coldActivity = [];
  const coldUseful = [];
  const coldCircle = [];

  await runAdb(serial, ["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
  for (let index = 0; index < sampleCount; index += 1) {
    await runAdb(serial, ["shell", "am", "force-stop", packageName], true);
    await runAdb(serial, ["logcat", "-c"], true);
    const start = await runAdb(serial, ["shell", "am", "start", "-W", "-n", `${packageName}/${activity}`]);
    const activityMs = numericLine(start, "TotalTime") ?? numericLine(start, "WaitTime");
    if (activityMs != null) coldActivity.push(activityMs);
    const useful = await waitForEvent(serial, "app.js_start_to_feed_content");
    const circle = await waitForEvent(serial, "tab.circle.cached_content", 3_000);
    if (Number.isFinite(useful?.durationMs)) coldUseful.push(useful.durationMs);
    if (Number.isFinite(circle?.durationMs)) coldCircle.push(circle.durationMs);
  }

  const warmActivity = [];
  for (let index = 0; index < sampleCount; index += 1) {
    await runAdb(serial, ["shell", "input", "keyevent", "3"], true);
    await delay(350);
    const start = await runAdb(serial, ["shell", "am", "start", "-W", "-n", `${packageName}/${activity}`]);
    const activityMs = numericLine(start, "TotalTime") ?? numericLine(start, "WaitTime");
    if (activityMs != null) warmActivity.push(activityMs);
  }

  const memoryBefore = await memorySnapshot(serial);
  const explore = await collectTabSamples(serial, size, "explore", sampleCount);
  const profile = await collectTabSamples(serial, size, "profile", sampleCount);
  const circle = await collectTabSamples(serial, size, "circle", sampleCount);
  const memoryAfter = await memorySnapshot(serial);
  const gfx = parseGfx(await runAdb(serial, ["shell", "dumpsys", "gfxinfo", packageName], true));
  const events = await readPerformanceEvents(serial);
  const playerCounts = events.filter((event) => event.name === "media.active_feed_players" && Number.isFinite(event.value)).map((event) => event.value);
  const warnings = [];
  if (coldUseful.length === 0) warnings.push("No profile-build useful-content marks were observed; rebuild with EXPO_PUBLIC_PERFORMANCE_PROFILE=1 and keep a valid signed-in cache.");
  for (const [name, result] of Object.entries({ circle, explore, profile })) {
    if (result.cached.samples === 0) warnings.push(`No ${name} cached-content samples were observed.`);
  }
  const report = {
    status: warnings.length ? "PARTIAL" : "PASS",
    recordedAt: new Date().toISOString(),
    build: { packageName, versionCode, versionName, profileFlagRequired: budgets.profileBuildFlag },
    device: { serial, model: model.trim(), androidVersion: osVersion.trim(), sdk: Number(sdk.trim()), screen: size },
    conditions: { buildType: "installed release/profile", network: "device current network", accountData: "existing owner-scoped test account cache", sampleCount },
    startupMs: {
      coldActivityDraw: summarize(coldActivity),
      coldJsStartToUsefulContent: summarize(coldUseful),
      coldCircleCachedContent: summarize(coldCircle),
      warmActivityResume: summarize(warmActivity)
    },
    tabsMs: { circle, explore, profile },
    rendering: { ...gfx, maximumObservedActiveFeedPlayers: playerCounts.length ? Math.max(...playerCounts) : null },
    memory: {
      before: memoryBefore,
      after: memoryAfter,
      pssGrowthKb: memoryBefore.pssKb != null && memoryAfter.pssKb != null ? memoryAfter.pssKb - memoryBefore.pssKb : null,
      repeatedTabCycles: sampleCount * 6
    },
    privacy: { contentLogged: false, mediaUrlsLogged: false, accountIdentifiersLogged: false },
    budgets: budgets.timingMilliseconds,
    warnings
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(resolve(root, outputPath), output);
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(`Mobile performance profile failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
