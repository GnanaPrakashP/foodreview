#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const adb = process.env.ADB ??
  "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const serial = process.env.ANDROID_SERIAL ?? "ZA223JVWG7";
const packageName = process.env.ANDROID_APP_PACKAGE ?? "com.circlebites.mobile.dev";
const roomTitle = process.env.MEMORY_RELEASE_ROOM_TITLE ?? "Release jank fixture";
const lifecycleCandidate =
  process.env.MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE ?? "unknown";
const artifactDir = process.env.MEMORY_RELEASE_ARTIFACT_DIR ??
  "/private/tmp/memory-room-release-jank";
const repetitions = Number(process.env.MEMORY_RELEASE_TRANSITION_REPETITIONS ?? 20);
const prepareWaitMs = Number(process.env.MEMORY_RELEASE_PREPARE_WAIT_MS ?? 1_500);
const captureExit = process.env.MEMORY_RELEASE_CAPTURE_EXIT === "1";
const pairs = (process.env.MEMORY_RELEASE_PAIRS ??
  "Chat>Dishes,Table>Chat,Media>Chat,Dishes>Chat")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    const [from, to] = value.split(">");
    return { from, to };
  });
const tabMode = {
  Chat: "chat",
  Dishes: "dishes",
  Media: "media",
  Table: "overview"
};

async function adbRun(args, allowFailure = false, timeout = 60_000) {
  try {
    const result = await execFileAsync(adb, ["-s", serial, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw error;
  }
}

function decodedXml(xml) {
  return xml
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&");
}

function nodes(xml) {
  return decodedXml(xml).match(/<node\b[^>]*>/g) ?? [];
}

function nodeFor(xml, labels) {
  for (const label of labels) {
    const expected = label.toLowerCase();
    const exact = nodes(xml).find((node) => {
      const text = /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      const description =
        /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      return text === expected || description === expected;
    });
    if (exact) return exact;
    const partial = nodes(xml).find((node) => {
      const text = /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      const description =
        /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      return text.includes(expected) || description.includes(expected);
    });
    if (partial) return partial;
  }
  return null;
}

function pointFor(xml, labels) {
  const bounds =
    /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(nodeFor(xml, labels) ?? "");
  if (!bounds) return null;
  return {
    x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
    y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)
  };
}

async function uiXml() {
  await adbRun(
    ["shell", "uiautomator", "dump", "/sdcard/memory-jank.xml"],
    true
  );
  const xml = await adbRun(["shell", "cat", "/sdcard/memory-jank.xml"], true);
  if (xml && !xml.includes(`package="${packageName}"`)) {
    const foreground = /package="([^"]+)"/.exec(xml)?.[1] ?? "unknown";
    throw new Error(`external_foreground_interruption:${foreground}`);
  }
  return xml;
}

async function waitForPoint(labels, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const xml = await uiXml();
    const point = pointFor(xml, labels);
    if (point) return { point, xml };
    await delay(250);
  }
  throw new Error(`timed_out_waiting_for:${label}`);
}

async function tap(point) {
  await adbRun([
    "shell",
    "input",
    "tap",
    String(point.x),
    String(point.y)
  ]);
}

function tabSelected(xml, label) {
  return nodeFor(xml, [label])?.includes('selected="true"') ?? false;
}

async function switchTab(label) {
  const before = await uiXml();
  if (tabSelected(before, label)) return;
  const point = pointFor(before, [label]);
  assert.ok(point, `missing_${label}_tab`);
  await delay(125);
  await tap(point);
  await delay(450);
  const after = await uiXml();
  assert.ok(tabSelected(after, label), `${label}_transition_not_selected`);
}

function valueFor(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Number(
    new RegExp(`${escaped}:\\s+([\\d,]+)`, "i")
      .exec(output)?.[1]
      ?.replaceAll(",", "") ?? 0
  );
}

async function sampleMemory(label) {
  const output = await adbRun(
    ["shell", "dumpsys", "meminfo", "-d", packageName],
    true
  );
  return {
    activities: Number(/\bActivities:\s*(\d+)/.exec(output)?.[1] ?? 0),
    graphicsKb: valueFor(output, "Graphics"),
    javaHeapKb: valueFor(output, "Java Heap"),
    label,
    nativeHeapKb: valueFor(output, "Native Heap"),
    totalPssKb: valueFor(output, "TOTAL PSS"),
    views: Number(/\bViews:\s*(\d+)/.exec(output)?.[1] ?? 0)
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function stats(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    max: finite.length > 0 ? Math.max(...finite) : null,
    p50: percentile(finite, 0.5),
    p90: percentile(finite, 0.9),
    p95: percentile(finite, 0.95)
  };
}

function parseGfx(output) {
  const buckets = [...output.matchAll(/(\d+)ms=(\d+)/g)]
    .map((match) => ({ milliseconds: Number(match[1]), count: Number(match[2]) }))
    .filter((bucket) => bucket.count > 0);
  return {
    jankyFrames: Number(/Janky frames:\s*(\d+)/.exec(output)?.[1] ?? 0),
    jankyPercent: Number(
      /Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(output)?.[1] ?? 0
    ),
    maxFrameBucketMs:
      buckets.length > 0
        ? Math.max(...buckets.map((bucket) => bucket.milliseconds))
        : null,
    p50FrameMs: Number(/50th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    p90FrameMs: Number(/90th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    p95FrameMs: Number(/95th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    totalFrames: Number(/Total frames rendered:\s*(\d+)/.exec(output)?.[1] ?? 0)
  };
}

async function startAtrace() {
  await adbRun([
    "shell",
    "atrace",
    "--async_start",
    "-c",
    "-b",
    "65536",
    "-a",
    packageName,
    "input",
    "am",
    "view"
  ]);
}

async function stopAtrace(name) {
  const trace = await adbRun(["shell", "atrace", "--async_stop"], false, 90_000);
  const path = `${artifactDir}/${name}.atrace.txt`;
  writeFileSync(path, trace);
  return { path, trace };
}

function traceDurations(trace, prefix) {
  const starts = new Map();
  const values = new Map();
  for (const line of trace.split("\n")) {
    const timestamp = Number(
      /\s(\d+\.\d+):\s+tracing_mark_write:/.exec(line)?.[1]
    );
    const marker =
      /tracing_mark_write:\s+([SFE])\|(\d+)\|([^|]+)\|?(\d+)?/.exec(line);
    if (!Number.isFinite(timestamp) || !marker) continue;
    const [, kind, pid, name, cookie = "0"] = marker;
    if (!name.startsWith(prefix)) continue;
    const key = `${pid}:${name}:${cookie}`;
    if (kind === "S") starts.set(key, timestamp);
    if (kind === "F" && starts.has(key)) {
      const current = values.get(name) ?? [];
      current.push((timestamp - starts.get(key)) * 1_000);
      values.set(name, current);
      starts.delete(key);
    }
  }
  return values;
}

function asyncTraceRanges(trace, exactName) {
  const starts = new Map();
  const ranges = [];
  for (const line of trace.split("\n")) {
    const timestamp = Number(
      /\s(\d+\.\d+):\s+tracing_mark_write:/.exec(line)?.[1]
    );
    const marker =
      /tracing_mark_write:\s+([SF])\|(\d+)\|([^|]+)\|?(\d+)?/.exec(line);
    if (!Number.isFinite(timestamp) || !marker || marker[3] !== exactName) continue;
    const [, kind, pid, name, cookie = "0"] = marker;
    const key = `${pid}:${name}:${cookie}`;
    if (kind === "S") starts.set(key, timestamp);
    if (kind === "F" && starts.has(key)) {
      ranges.push({ end: timestamp, start: starts.get(key) });
      starts.delete(key);
    }
  }
  return ranges;
}

function timestampForTraceLine(line) {
  return Number(/\s(\d+\.\d+):\s+tracing_mark_write:/.exec(line)?.[1]);
}

function rangeIndexFor(timestamp, ranges) {
  return ranges.findIndex(({ start, end }) => timestamp >= start && timestamp <= end);
}

function fabricWorkByTransition(trace, transitionName) {
  const ranges = asyncTraceRanges(trace, transitionName);
  const samples = ranges.map(() => ({
    creates: 0,
    deletes: 0,
    inserts: 0,
    layouts: 0,
    nativeViewsCreated: 0,
    removes: 0
  }));
  for (const line of trace.split("\n")) {
    const timestamp = timestampForTraceLine(line);
    if (!Number.isFinite(timestamp)) continue;
    const rangeIndex = rangeIndexFor(timestamp, ranges);
    if (rangeIndex < 0) continue;
    if (line.includes("SurfaceMountingManager::createViewUnsafe(")) {
      samples[rangeIndex].nativeViewsCreated += 1;
    }
    const instruction =
      /mountInstructions::(CREATE|DELETE|INSERT|REMOVE|UPDATE_LAYOUT) numInstructions=(\d+)/.exec(line);
    if (!instruction) continue;
    const count = Number(instruction[2]);
    if (instruction[1] === "CREATE") samples[rangeIndex].creates += count;
    if (instruction[1] === "DELETE") samples[rangeIndex].deletes += count;
    if (instruction[1] === "INSERT") samples[rangeIndex].inserts += count;
    if (instruction[1] === "REMOVE") samples[rangeIndex].removes += count;
    if (instruction[1] === "UPDATE_LAYOUT") samples[rangeIndex].layouts += count;
  }
  return Object.fromEntries(
    Object.keys(samples[0] ?? {
      creates: 0,
      deletes: 0,
      inserts: 0,
      layouts: 0,
      nativeViewsCreated: 0,
      removes: 0
    }).map((key) => [key, stats(samples.map((sample) => sample[key]))])
  );
}

function traceCounterStats(trace, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = [...trace.matchAll(
    new RegExp(`tracing_mark_write:\\s+C\\|\\d+\\|${escaped}\\|(-?\\d+)`, "g")
  )].map((match) => Number(match[1]));
  return {
    count: values.length,
    first: values[0] ?? null,
    last: values.at(-1) ?? null,
    max: values.length > 0 ? Math.max(...values) : null,
    min: values.length > 0 ? Math.min(...values) : null
  };
}

async function ensureRoomOpen() {
  let xml = await uiXml();
  if (pointFor(xml, ["Table"]) && pointFor(xml, ["Chat"])) return;
  let memories = pointFor(xml, ["Memories"]);
  if (!memories) {
    const profile = pointFor(xml, ["Profile"]);
    if (profile) {
      await tap(profile);
      await delay(1_000);
      xml = await uiXml();
      memories = pointFor(xml, ["Memories"]);
    }
  }
  if (memories) {
    await tap(memories);
    await delay(1_000);
    xml = await uiXml();
  }
  const room = pointFor(xml, [`Open ${roomTitle} room`, roomTitle]);
  assert.ok(room, "profiling_room_not_visible");
  await tap(room);
  await waitForPoint(["Table"], "room_table");
  await delay(prepareWaitMs);
}

async function runPair({ from, to }) {
  assert.ok(tabMode[from] && tabMode[to] && from !== to, "invalid_transition_pair");
  await switchTab(from);
  await switchTab(to);
  await switchTab(from);
  const before = await sampleMemory(`${from}_to_${to}_before`);
  await startAtrace();
  const frames = [];
  for (let index = 0; index < repetitions; index += 1) {
    await switchTab(from);
    const xml = await uiXml();
    const point = pointFor(xml, [to]);
    assert.ok(point, `missing_${to}_coordinate`);
    await adbRun(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
    await delay(125);
    await tap(point);
    await delay(450);
    frames.push(parseGfx(
      await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true)
    ));
    const selected = await uiXml();
    assert.ok(tabSelected(selected, to), `${from}_to_${to}_ignored`);
  }
  const after = await sampleMemory(`${from}_to_${to}_after`);
  const traceName = `${from.toLowerCase()}-to-${to.toLowerCase()}`;
  const { path, trace } = await stopAtrace(traceName);
  const durations = traceDurations(trace, "MemoryRoom");
  const suffix = `${tabMode[from]}_to_${tabMode[to]}`;
  const transitionName = `MemoryRoomTabTransition_${suffix}`;
  return {
    after,
    before,
    firstFrameMs: stats(
      durations.get(`MemoryRoomTabFirstFrame_${suffix}`) ?? []
    ),
    fabric: fabricWorkByTransition(trace, transitionName),
    frames: {
      jankPercent: stats(frames.map((frame) => frame.jankyPercent)),
      maxFrameBucketMs: stats(
        frames.map((frame) => frame.maxFrameBucketMs).filter(Number.isFinite)
      ),
      p95FrameMs: stats(frames.map((frame) => frame.p95FrameMs))
    },
    from,
    memoryDeltaKb: after.totalPssKb - before.totalPssKb,
    repetitions,
    resources: {
      activePlayers: traceCounterStats(trace, "MemoryRoomActivePlayers"),
      activeRealtimeChannels: traceCounterStats(
        trace,
        "MemoryRoomActiveRealtimeChannels"
      ),
      chatHosts: traceCounterStats(trace, "MemoryRoomMountedChatHosts"),
      chatInputs: traceCounterStats(trace, "MemoryRoomMountedChatInputs"),
      chatShells: traceCounterStats(trace, "MemoryRoomMountedChatShells")
    },
    settledMs: stats(
      durations.get(`MemoryRoomTabSettled_${suffix}`) ?? []
    ),
    to,
    trace: path,
    usableMs: stats(
      durations.get(transitionName) ?? []
    )
  };
}

async function waitForRoomExit(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const xml = await uiXml();
    if (
      !tabSelected(xml, "Table") &&
      !tabSelected(xml, "Chat") &&
      pointFor(xml, ["Memories"])
    ) {
      return;
    }
    await delay(200);
  }
  throw new Error("timed_out_waiting_for:room_exit");
}

async function captureRoomExit() {
  await switchTab("Chat");
  const before = await sampleMemory("room_exit_before");
  await startAtrace();
  const automationStartedAt = Date.now();
  await adbRun(["shell", "input", "keyevent", "4"]);
  await waitForRoomExit();
  const automationMs = Date.now() - automationStartedAt;
  const after = await sampleMemory("room_exit_after");
  const { path, trace } = await stopAtrace("room-exit");
  const appExit = stats(traceDurations(trace, "MemoryRoomExit").get("MemoryRoomExit") ?? []);
  await delay(10_000);
  const plus10s = await sampleMemory("room_exit_plus_10s");
  await delay(20_000);
  const plus30s = await sampleMemory("room_exit_plus_30s");
  await delay(30_000);
  const plus60s = await sampleMemory("room_exit_plus_60s");
  return {
    after,
    appExitMs: appExit,
    automationMs,
    before,
    plus10s,
    plus30s,
    plus60s,
    trace: path
  };
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  await ensureRoomOpen();
  const start = await sampleMemory("targeted_start");
  const results = [];
  for (const pair of pairs) results.push(await runPair(pair));
  const exit = captureExit ? await captureRoomExit() : null;
  if (!captureExit) await switchTab("Table");
  const end = await sampleMemory("targeted_end");
  const crash = await adbRun(["logcat", "-d", "-b", "crash", "-v", "brief"], true);
  const report = {
    lifecycleCandidate,
    memory: {
      activeGrowthKb: end.totalPssKb - start.totalPssKb,
      end,
      start
    },
    packageName,
    results,
    roomExit: exit,
    runtimeErrors: {
      fatal: (
        crash.match(
          new RegExp(`Process:\\s*${packageName.replaceAll(".", "\\.")}`, "g")
        ) ?? []
      ).length
    },
    status: "MEASURED"
  };
  writeFileSync(
    `${artifactDir}/targeted-report.json`,
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(JSON.stringify(report, null, 2));
}

await main();
