#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const adb = process.env.ADB ?? "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
const serial = process.env.ANDROID_SERIAL ?? "ZA223JVWG7";
const packageName = process.env.ANDROID_APP_PACKAGE ?? "com.circlebites.mobile.dev";
const artifactDir = process.env.MEMORY_RELEASE_ARTIFACT_DIR ??
  "/private/tmp/memory-room-release-acceptance";
const repetitions = Number(process.env.MEMORY_RELEASE_TRANSITION_REPETITIONS ?? 10);
const soakDurationMs = Number(process.env.MEMORY_RELEASE_SOAK_MS ?? 30 * 60_000);
const postExitSettleMs = Number(process.env.MEMORY_RELEASE_POST_EXIT_SETTLE_MS ?? 30_000);
const skipMatrix = process.env.MEMORY_RELEASE_SKIP_MATRIX === "1";
const matrixResumePath = process.env.MEMORY_RELEASE_MATRIX_RESUME_FROM ?? "";
const disconnectEveryCycles = Number(process.env.MEMORY_RELEASE_DISCONNECT_EVERY ?? 6);
const memorySampleEveryCycles = Number(
  process.env.MEMORY_RELEASE_MEMORY_SAMPLE_EVERY ?? 5
);
const exerciseMedia = process.env.MEMORY_RELEASE_EXERCISE_MEDIA !== "0";
const roomATitle = process.env.MEMORY_RELEASE_ROOM_A_TITLE ?? "Release acceptance A";
const roomBTitle = process.env.MEMORY_RELEASE_ROOM_B_TITLE ?? "Release acceptance B";
const reversePorts = (process.env.MEMORY_RELEASE_REVERSE_PORTS ?? "3036,54321")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const tabLabels = ["Table", "Chat", "Media", "Dishes"];
const tabMode = { Chat: "chat", Dishes: "dishes", Media: "media", Table: "overview" };
const directedPairs = tabLabels.flatMap((from) => (
  tabLabels.filter((to) => to !== from).map((to) => ({ from, to }))
));

async function adbRun(args, allowFailure = false, timeout = 30_000) {
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

async function uiXml() {
  await adbRun(["shell", "uiautomator", "dump", "/sdcard/memory-release.xml"], true);
  const xml = await adbRun(["shell", "cat", "/sdcard/memory-release.xml"], true);
  if (xml && !xml.includes(`package="${packageName}"`)) {
    const foregroundPackage = /package="([^"]+)"/.exec(xml)?.[1] ?? "unknown";
    throw new Error(`external_foreground_interruption:${foregroundPackage}`);
  }
  return xml;
}

function decodedXml(xml) {
  return xml.replaceAll("&apos;", "'").replaceAll("&quot;", "\"").replaceAll("&amp;", "&");
}

function nodes(xml) {
  return decodedXml(xml).match(/<node\b[^>]*>/g) ?? [];
}

function nodeFor(xml, labels) {
  for (const label of labels) {
    const lower = label.toLowerCase();
    const exact = nodes(xml).find((node) => {
      const text = /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      const description = /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      return text === lower || description === lower;
    });
    if (exact) return exact;
    const partial = nodes(xml).find((node) => {
      const text = /text="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      const description = /content-desc="([^"]*)"/.exec(node)?.[1]?.toLowerCase() ?? "";
      return text.includes(lower) || description.includes(lower);
    });
    if (partial) return partial;
  }
  return null;
}

function pointFor(xml, labels) {
  const bounds = nodeFor(xml, labels)?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) return null;
  return {
    x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
    y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)
  };
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

async function waitForPoint(labels, name, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const xml = await uiXml();
    const point = pointFor(xml, labels);
    if (point) return { point, xml };
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${name}`);
}

async function tap(point) {
  await adbRun(["shell", "input", "tap", String(point.x), String(point.y)]);
}

function tabSelected(xml, label) {
  return nodeFor(xml, [label])?.includes('selected="true"') ?? false;
}

async function switchTab(label, verify = true) {
  const before = await uiXml();
  if (tabSelected(before, label)) return;
  const point = pointFor(before, [label]);
  if (!point) throw new Error(`Missing ${label} tab`);
  // UIAutomator briefly owns Android's accessibility connection while dumping
  // the hierarchy. Give that connection time to tear down before injecting the
  // press so the harness cannot manufacture a one-tap miss.
  await delay(125);
  await tap(point);
  await delay(450);
  if (verify) {
    const after = await uiXml();
    assert.ok(tabSelected(after, label), `${label} tab did not become selected`);
  }
}

function percentile(values, value) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

function stats(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    max: finite.length ? Math.max(...finite) : null,
    p50: percentile(finite, 0.5),
    p90: percentile(finite, 0.9),
    p95: percentile(finite, 0.95)
  };
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseGfx(output) {
  return {
    jankyFrames: Number(/Janky frames:\s*(\d+)/.exec(output)?.[1] ?? 0),
    jankyPercent: Number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/.exec(output)?.[1] ?? 0),
    maxFrameMs: Number(/HISTOGRAM:[\s\S]*?50ms=(\d+)/.exec(output)?.[1] ?? 0) > 0
      ? 50
      : null,
    p50FrameMs: Number(/50th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    p90FrameMs: Number(/90th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    p95FrameMs: Number(/95th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    p99FrameMs: Number(/99th percentile:\s*(\d+)ms/.exec(output)?.[1] ?? 0),
    totalFrames: Number(/Total frames rendered:\s*(\d+)/.exec(output)?.[1] ?? 0)
  };
}

function memoryValue(output, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Number(new RegExp(`${escaped}:\\s+([\\d,]+)`, "i")
    .exec(output)?.[1]?.replaceAll(",", "") ?? 0);
}

async function sampleMemory(label) {
  const output = await adbRun(["shell", "dumpsys", "meminfo", packageName], true);
  return {
    graphicsKb: memoryValue(output, "Graphics"),
    javaHeapKb: memoryValue(output, "Java Heap"),
    label,
    nativeHeapKb: memoryValue(output, "Native Heap"),
    sampledAt: new Date().toISOString(),
    totalPssKb: memoryValue(output, "TOTAL PSS")
  };
}

async function deviceInfo() {
  const [
    manufacturer,
    model,
    android,
    memory,
    size,
    display,
    keyboard,
    battery,
    thermal
  ] = await Promise.all([
    adbRun(["shell", "getprop", "ro.product.manufacturer"]),
    adbRun(["shell", "getprop", "ro.product.model"]),
    adbRun(["shell", "getprop", "ro.build.version.release"]),
    adbRun(["shell", "cat", "/proc/meminfo"]),
    adbRun(["shell", "wm", "size"]),
    adbRun(["shell", "dumpsys", "display"]),
    adbRun(["shell", "settings", "get", "secure", "default_input_method"]),
    adbRun(["shell", "dumpsys", "battery"]),
    adbRun(["shell", "dumpsys", "thermalservice"], true)
  ]);
  return {
    android: android.trim(),
    battery: {
      level: Number(/level:\s*(\d+)/.exec(battery)?.[1] ?? 0),
      powered: /AC powered:\s*true|USB powered:\s*true/.test(battery),
      temperatureC: Number(/temperature:\s*(\d+)/.exec(battery)?.[1] ?? 0) / 10
    },
    keyboard: keyboard.trim(),
    manufacturer: manufacturer.trim(),
    model: model.trim(),
    ramKb: Number(/MemTotal:\s*(\d+)/.exec(memory)?.[1] ?? 0),
    refreshRateHz: Number(/mRefreshRateOverride=([\d.]+)/.exec(display)?.[1] ??
      /renderFrameRate\s+([\d.]+)/.exec(display)?.[1] ??
      /refreshRate=([\d.]+)/.exec(display)?.[1] ?? 0),
    resolution: [...size.matchAll(/(\d+)x(\d+)/g)].at(-1)?.[0] ?? "unknown",
    thermalThrottling: /SEVERE|CRITICAL|EMERGENCY|SHUTDOWN/.test(thermal)
  };
}

async function startAtrace() {
  // Gfx/View/Scheduler categories can wrap even a large ftrace buffer during
  // ten UIAutomator-verified repetitions. FrameTimeline and CPU evidence live
  // in Perfetto; this stream is intentionally marker/input-only so no directed
  // pair loses its first samples.
  const categories = ["input", "am"];
  const output = await adbRun([
    "shell", "atrace", "--async_start", "-c", "-b", "8192", "-a", packageName,
    ...categories
  ], true);
  if (/unknown tracing category|error/i.test(output)) {
    throw new Error(`atrace start failed: ${output.slice(-1_000)}`);
  }
}

async function stopAtrace(name) {
  const output = await adbRun(["shell", "atrace", "--async_stop"], true, 90_000);
  writeFileSync(`${artifactDir}/${name}.atrace.txt`, output);
  return output;
}

function perfettoConfig(durationMs) {
  return `buffers {
  size_kb: 65536
  fill_policy: RING_BUFFER
}
data_sources {
  config {
    name: "linux.ftrace"
    ftrace_config {
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_wakeup"
      ftrace_events: "power/cpu_frequency"
      ftrace_events: "power/cpu_idle"
      atrace_categories: "gfx"
      atrace_categories: "input"
      atrace_categories: "view"
      atrace_categories: "wm"
      atrace_categories: "am"
      atrace_categories: "binder_driver"
      atrace_categories: "dalvik"
      atrace_categories: "camera"
      atrace_categories: "audio"
      atrace_categories: "video"
      atrace_apps: "${packageName}"
    }
  }
}
data_sources {
  config {
    name: "android.surfaceflinger.frametimeline"
  }
}
data_sources {
  config {
    name: "android.process_stats"
    process_stats_config {
      scan_all_processes_on_start: true
      proc_stats_poll_ms: 1000
    }
  }
}
data_sources {
  config {
    name: "linux.sys_stats"
    sys_stats_config {
      meminfo_period_ms: 1000
      cpufreq_period_ms: 1000
    }
  }
}
duration_ms: ${Math.max(5_000, Math.round(durationMs))}
flush_period_ms: 5000
write_into_file: true
file_write_period_ms: 5000
max_file_size_bytes: 536870912
`;
}

async function startPerfetto() {
  const localConfig = `${artifactDir}/memory-room-soak-perfetto.pbtxt`;
  const localTrace = `${artifactDir}/memory-room-soak.perfetto-trace`;
  const remoteConfig = "/data/misc/perfetto-configs/memory-room-soak.pbtxt";
  const remoteTrace = "/data/misc/perfetto-traces/memory-room-soak.perfetto-trace";
  writeFileSync(localConfig, perfettoConfig(soakDurationMs));
  await adbRun(["push", localConfig, remoteConfig], false, 60_000);
  const output = await adbRun([
    "shell", "perfetto", "--background", "--txt", "-c", remoteConfig, "-o", remoteTrace
  ], true);
  const pid = Number(output.trim().match(/\d+/)?.[0] ?? 0);
  assert.ok(pid > 0, `Perfetto did not start: ${output}`);
  return { localConfig, localTrace, pid, remoteTrace };
}

async function collectPerfetto(capture) {
  await adbRun(["pull", capture.remoteTrace, capture.localTrace], false, 180_000);
  return {
    config: capture.localConfig,
    trace: capture.localTrace
  };
}

function traceDurations(trace, prefix) {
  const starts = new Map();
  const durations = new Map();
  const lines = trace.split("\n");
  for (const line of lines) {
    const timestamp = Number(/\s(\d+\.\d+):\s+tracing_mark_write:/.exec(line)?.[1]);
    const payload = /tracing_mark_write:\s+([SFE])\|(\d+)\|([^|]+)\|?(\d+)?/.exec(line);
    if (!Number.isFinite(timestamp) || !payload) continue;
    const [, kind, pid, name, cookie = "0"] = payload;
    if (!name.startsWith(prefix)) continue;
    const key = `${pid}:${name}:${cookie}`;
    if (kind === "S") starts.set(key, timestamp);
    if (kind === "F" && starts.has(key)) {
      const values = durations.get(name) ?? [];
      values.push((timestamp - starts.get(key)) * 1_000);
      durations.set(name, values);
      starts.delete(key);
    }
  }
  return durations;
}

async function navigateToRoom(title) {
  const memories = await waitForPoint(["Memories"], "Profile Memories tab");
  await tap(memories.point);
  const room = await waitForPoint([title], title);
  await tap(room.point);
  await waitForPoint(["Table"], "room Table tab");
  await delay(500);
}

async function exitRoom() {
  await adbRun(["shell", "input", "keyevent", "4"]);
  await waitForPoint(["Memories"], "Memories after room exit");
}

async function ensureProfileMemories() {
  let xml = await uiXml();
  if (pointFor(xml, ["Table"]) && pointFor(xml, ["Chat"])) {
    await exitRoom();
    return;
  }
  if (pointFor(xml, ["Memories"])) return;
  const profile = pointFor(xml, ["Profile"]);
  assert.ok(profile, "Profile navigation is not visible");
  await tap(profile);
  await waitForPoint(["Memories"], "Profile Memories tab");
}

async function runEntrySamples() {
  const samples = [];
  await startAtrace();
  for (let index = 0; index < 6; index += 1) {
    const room = await waitForPoint([roomATitle], "room A card");
    const startedAt = performance.now();
    await tap(room.point);
    await waitForPoint(["Table"], "room Table");
    samples.push(performance.now() - startedAt);
    await exitRoom();
  }
  const trace = await stopAtrace("room-entry-samples");
  const tracedEntries = traceDurations(trace, "MemoryRoomEntry")
    .get("MemoryRoomEntry") ?? [];
  const tracedWarmup = tracedEntries.shift() ?? null;
  return {
    discardedWarmupMs: samples.shift(),
    hostTapToUsableMs: stats(samples),
    traceDiscardedWarmupMs: tracedWarmup,
    traceTapToUsableMs: stats(tracedEntries)
  };
}

async function runDirectedMatrix() {
  const results = matrixResumePath
    ? JSON.parse(readFileSync(matrixResumePath, "utf8"))
    : [];
  assert.ok(Array.isArray(results), "matrix resume checkpoint must be an array");
  for (const pair of directedPairs) {
    if (results.some((result) => result.from === pair.from && result.to === pair.to)) continue;
    await switchTab(pair.from);
    await switchTab(pair.to);
    await switchTab(pair.from);
    const pairMemoryBefore = await sampleMemory(`${pair.from}_to_${pair.to}_before`);
    await startAtrace();
    const gfxRuns = [];
    for (let index = 0; index < repetitions; index += 1) {
      await switchTab(pair.from);
      const xml = await uiXml();
      const point = pointFor(xml, [pair.to]);
      assert.ok(point, `missing ${pair.to} coordinate`);
      await adbRun(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
      await delay(125);
      await tap(point);
      // Fixed window: no UIAutomator or polling is allowed before it ends.
      await delay(450);
      gfxRuns.push(parseGfx(await adbRun(["shell", "dumpsys", "gfxinfo", packageName], true)));
      const verified = await uiXml();
      assert.ok(tabSelected(verified, pair.to), `${pair.from} -> ${pair.to} was ignored`);
    }
    const pairMemoryAfter = await sampleMemory(`${pair.from}_to_${pair.to}_after`);
    const traceName = `directed-tab-${pair.from.toLowerCase()}-to-${pair.to.toLowerCase()}`;
    const trace = await stopAtrace(traceName);
    const durations = traceDurations(trace, "MemoryRoomTab");
    const suffix = `${tabMode[pair.from]}_to_${tabMode[pair.to]}`;
    results.push({
      atrace: `${artifactDir}/${traceName}.atrace.txt`,
      firstCorrectFrameMs: stats(
        durations.get(`MemoryRoomTabFirstFrame_${suffix}`) ?? []
      ),
      from: pair.from,
      gfx: {
        jankPercent: stats(gfxRuns.map((run) => run.jankyPercent)),
        p50FrameMs: stats(gfxRuns.map((run) => run.p50FrameMs)),
        p90FrameMs: stats(gfxRuns.map((run) => run.p90FrameMs)),
        p95FrameMs: stats(gfxRuns.map((run) => run.p95FrameMs)),
        p99FrameMs: stats(gfxRuns.map((run) => run.p99FrameMs))
      },
      memoryDeltaKb: pairMemoryAfter.totalPssKb - pairMemoryBefore.totalPssKb,
      repetitions,
      settledMs: stats(durations.get(`MemoryRoomTabSettled_${suffix}`) ?? []),
      usableMs: stats(durations.get(`MemoryRoomTabTransition_${suffix}`) ?? []),
      to: pair.to
    });
    writeFileSync(
      `${artifactDir}/directed-matrix-partial.json`,
      `${JSON.stringify(results, null, 2)}\n`
    );
  }
  return results;
}

async function scrollSurface() {
  await adbRun(["shell", "input", "swipe", "630", "2100", "630", "650", "220"]);
  await delay(180);
  await adbRun(["shell", "input", "swipe", "630", "700", "630", "2050", "220"]);
  await delay(250);
}

async function findWithDownwardScroll(labels, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const xml = await uiXml();
    const point = pointFor(xml, labels);
    if (point) return point;
    await adbRun(["shell", "input", "swipe", "630", "2150", "630", "650", "260"]);
    await delay(250);
  }
  return null;
}

async function exerciseViewer(kind) {
  const label = kind === "image" ? "Open photo" : `Open ${kind}`;
  const media = await findWithDownwardScroll([label]);
  if (!media) return false;
  await tap(media);
  const close = await waitForPoint(["Close media viewer"], `${kind} viewer`, 10_000);
  if (kind === "image") {
    await adbRun(["shell", "input", "swipe", "1000", "1300", "250", "1300", "260"]);
  } else if (kind === "video") {
    await adbRun(["shell", "input", "tap", "636", "1300"]);
    await delay(350);
    await adbRun(["shell", "input", "tap", "636", "1300"]);
    await delay(1_000);
    await adbRun(["shell", "input", "tap", "636", "1300"]);
  } else {
    const play = await waitForPoint(["Play audio"], "audio play", 5_000);
    await tap(play.point);
    await delay(1_000);
  }
  await delay(350);
  await tap(close.point);
  await waitForPoint(["Media"], "Media after viewer close", 10_000);
  return true;
}

async function sendText(value) {
  const input = await waitForPoint(["Type a message"], "chat composer");
  await tap(input.point);
  await adbRun(["shell", "input", "text", value]);
  const send = await waitForPoint(["Send message"], "send button");
  await tap(send.point);
  await delay(300);
}

async function sendReply(target, value) {
  await delay(900);
  const xml = await uiXml();
  const bounds = boundsFor(xml, [target]);
  if (!bounds) return false;
  const startX = Math.max(bounds.left + 12, Math.round((bounds.left + bounds.right) / 2));
  const y = Math.round((bounds.top + bounds.bottom) / 2);
  await adbRun([
    "shell", "input", "swipe",
    String(startX), String(y), String(Math.min(1220, startX + 360)), String(y), "320"
  ]);
  try {
    await waitForPoint(["Cancel reply"], "reply composer", 4_000);
  } catch {
    return false;
  }
  await sendText(value);
  return true;
}

async function rateVisibleDish() {
  const xml = await uiXml();
  const rating = pointFor(xml, ["5 out of 5"]);
  if (!rating) return false;
  await tap(rating);
  await delay(500);
  return true;
}

async function backgroundForeground() {
  await adbRun(["shell", "input", "keyevent", "3"]);
  await delay(1_000);
  await adbRun(["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
  await delay(1_500);
}

async function setNetwork(enabled) {
  if (!enabled) {
    for (const port of reversePorts) {
      await adbRun(["reverse", "--remove", `tcp:${port}`], true);
    }
  }
  await adbRun(["shell", "svc", "wifi", enabled ? "enable" : "disable"], true);
  await adbRun(["shell", "svc", "data", enabled ? "enable" : "disable"], true);
  if (enabled) {
    for (const port of reversePorts) {
      await adbRun(["reverse", `tcp:${port}`, `tcp:${port}`], true);
    }
  }
  await delay(enabled ? 3_000 : 800);
}

async function runSoak() {
  const startedAt = Date.now();
  const counts = {
    audioPlaybackSessions: 0,
    backgroundForeground: 0,
    chatSends: 0,
    disconnectReconnect: 0,
    dishRatings: 0,
    imageViewerOpens: 0,
    replyAttempts: 0,
    replySends: 0,
    roomEntries: 0,
    roomExits: 0,
    tabTransitions: 0,
    videoPlaybackSessions: 0
  };
  const memory = [await sampleMemory("soak_start")];
  let cycle = 0;
  let currentRoom = roomATitle;
  while (Date.now() - startedAt < soakDurationMs) {
    cycle += 1;
    for (const label of ["Table", "Media", "Dishes", "Chat"]) {
      await switchTab(label);
      counts.tabTransitions += 1;
      if (label !== "Chat") await scrollSurface();
      if (exerciseMedia && label === "Media" && currentRoom === roomATitle) {
        if (counts.imageViewerOpens < 10 && await exerciseViewer("image")) {
          counts.imageViewerOpens += 1;
        }
        if (counts.videoPlaybackSessions < 5 && await exerciseViewer("video")) {
          counts.videoPlaybackSessions += 1;
        }
        if (counts.audioPlaybackSessions < 5 && await exerciseViewer("audio")) {
          counts.audioPlaybackSessions += 1;
        }
      }
      if (label === "Dishes" && counts.dishRatings < 10 && await rateVisibleDish()) {
        counts.dishRatings += 1;
      }
    }
    const sentBody = `release_soak_${String(cycle).padStart(2, "0")}`;
    await sendText(sentBody);
    counts.chatSends += 1;
    if (counts.replySends < 10) {
      counts.replyAttempts += 1;
      if (await sendReply(sentBody, `release_reply_${String(cycle).padStart(2, "0")}`)) {
        counts.replySends += 1;
        counts.chatSends += 1;
      }
    }
    if (cycle % 3 === 0) {
      await backgroundForeground();
      counts.backgroundForeground += 1;
    }
    if (disconnectEveryCycles > 0 && cycle % disconnectEveryCycles === 0) {
      await setNetwork(false);
      counts.disconnectReconnect += 1;
      await switchTab("Table");
      await switchTab("Chat");
      counts.tabTransitions += 2;
      await setNetwork(true);
    }
    await switchTab("Table");
    await exitRoom();
    counts.roomExits += 1;
    const title = cycle % 2 === 0 ? roomATitle : roomBTitle;
    const room = await waitForPoint([title], title);
    await tap(room.point);
    await waitForPoint(["Table"], "Table after room switch");
    currentRoom = title;
    counts.roomEntries += 1;
    if (
      memorySampleEveryCycles > 0 &&
      cycle % memorySampleEveryCycles === 0
    ) {
      memory.push(await sampleMemory(`soak_cycle_${cycle}`));
    }
  }
  await switchTab("Table");
  await exitRoom();
  counts.roomExits += 1;
  memory.push(await sampleMemory("soak_final_exit"));
  await delay(postExitSettleMs);
  memory.push(await sampleMemory("soak_exit_plus_30s"));
  await delay(postExitSettleMs);
  memory.push(await sampleMemory("soak_exit_plus_60s"));
  return { counts, durationMs: Date.now() - startedAt, memory };
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  assert.equal(directedPairs.length, 12);
  const device = await deviceInfo();
  await adbRun(["logcat", "-c"], true);
  await ensureProfileMemories();
  const memory = [await sampleMemory("authenticated_profile")];
  const memories = await waitForPoint(["Memories"], "Profile Memories tab");
  await tap(memories.point);
  await waitForPoint([roomATitle], "room A card before entry sampling");
  const entry = skipMatrix ? null : await runEntrySamples();
  await navigateToRoom(roomATitle);
  memory.push(await sampleMemory("before_matrix"));
  const matrix = skipMatrix ? [] : await runDirectedMatrix();
  memory.push(await sampleMemory("after_matrix"));
  const perfettoCapture = await startPerfetto();
  const soak = await runSoak();
  const perfetto = await collectPerfetto(perfettoCapture);
  const crashLog = await adbRun(["logcat", "-d", "-b", "crash", "-v", "brief"], true);
  const systemLog = await adbRun(["logcat", "-d", "-b", "system", "-v", "brief"], true);
  const escapedPackage = regexEscape(packageName);
  const report = {
    build: {
      developmentChecks: false,
      hermes: true,
      journeyDiagnostics: false,
      minified: true,
      packageName,
      type: "signed minified Android release/profile"
    },
    device,
    directedMatrix: matrix,
    entry,
    memory: [...memory, ...soak.memory],
    perfetto,
    runtimeErrors: {
      anr: (systemLog.match(new RegExp(`ANR in ${escapedPackage}`, "g")) ?? []).length,
      fatal: (crashLog.match(new RegExp(`Process:\\s*${escapedPackage}`, "g")) ?? []).length,
      oom: new RegExp(
        `(?:${escapedPackage}[\\s\\S]{0,2000}OutOfMemoryError|OutOfMemoryError[\\s\\S]{0,2000}${escapedPackage})`,
        "i"
      ).test(crashLog) ? 1 : 0
    },
    soak,
    status: "MEASURED"
  };
  writeFileSync(`${artifactDir}/release-runtime-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

await main();
