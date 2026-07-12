#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = resolve(rootDir, "mobile");

// Optional local Phase 1A runtime bridge. The temporary file is produced by
// `supabase status -o json`; values stay in the child environment and are never
// printed by this validator.
if (process.env.POST_MEDIA_SUPABASE_STATUS_FILE) {
  const localStatus = JSON.parse(readFileSync(process.env.POST_MEDIA_SUPABASE_STATUS_FILE, "utf8"));
  process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.PHASE1A_ANDROID_SUPABASE_URL ?? localStatus.API_URL;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = localStatus.ANON_KEY;
}

const args = new Set(process.argv.slice(2));
const noMetro = args.has("--no-metro");
const keepMetro = args.has("--keep-metro");
const timeoutMs = numberFromArg("--timeout-ms", 90_000);

const localEnv = loadEnvFiles([
  resolve(rootDir, ".env.local"),
  resolve(mobileDir, ".env.local"),
  resolve(mobileDir, ".env")
]);

const artifactDir = envValue("ANDROID_PROFILE_ARTIFACT_DIR", "/private/tmp/profile-android-validation");
const metroPort = envValue("EXPO_PORT", "8081");
const apiBaseUrl = envValue("EXPO_PUBLIC_API_BASE_URL");
const supabaseUrl = envValue("EXPO_PUBLIC_SUPABASE_URL", envValue("NEXT_PUBLIC_SUPABASE_URL", ""));
const supabaseAnonKey = envValue("EXPO_PUBLIC_SUPABASE_ANON_KEY", envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""));
const autoLoginEmail = envValue("EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL", "");
const autoLoginPassword = envValue("EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD", "");
const expoPackage = envValue("EXPO_ANDROID_PACKAGE", "host.exp.exponent");
const launchUrl = envValue("EXPO_ANDROID_URL", `exp://127.0.0.1:${metroPort}`);
const metroLogPath = resolve(artifactDir, "metro.log");
const successTerms = splitList(envValue("ANDROID_PROFILE_SUCCESS_TEXT", "Rahul,Posts,Memories"));
const shellTerms = splitList(envValue("ANDROID_APP_SHELL_TEXT", "Circle,Explore,Profile"));
const failureTerms = splitList(
  envValue(
    "ANDROID_PROFILE_FAILURE_TEXT",
    "CircleBites can't be reached,Unable to reach,auth_unavailable,automatic sign-in failed,Network request failed,TypeError,PostgREST,Supabase,permission denied,JWT,relation,violates"
  )
);
const runtimeFailureTerms = splitList(
  envValue(
    "ANDROID_RUNTIME_FAILURE_TEXT",
    "VirtualizedLists should never be nested,FATAL EXCEPTION,ReactNativeJS: TypeError,Network request failed,automatic sign-in failed"
  )
);

const runtimeEnv = {
  ...process.env,
  EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
  EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
  EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL: autoLoginEmail,
  EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD: autoLoginPassword
};

let metroProcess = null;

main().catch(async (error) => {
  console.error(`\nAndroid Profile login automation failed: ${userSafeMessage(error)}`);
  await writeFailureArtifacts().catch(() => {});
  cleanupMetro();
  process.exit(1);
});

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  validateConfiguration();

  const adb = await resolveAdb();
  const serial = await resolveDevice(adb);
  console.log(`Using Android device: ${serial}`);

  await ensureLocalService("Next API", apiBaseUrl);
  await ensureLocalService("Supabase API", supabaseUrl);
  await ensureMetro();

  await adbExec(adb, ["-s", serial, "logcat", "-c"], { allowFailure: true });

  await reverseLocalPort(adb, serial, metroPort, "Metro");
  await reverseUrlPort(adb, serial, apiBaseUrl, "Next API");
  await reverseUrlPort(adb, serial, supabaseUrl, "Supabase API");

  console.log(`Force-stopping ${expoPackage} to clear stale overlays.`);
  await adbExec(adb, ["-s", serial, "shell", "am", "force-stop", expoPackage], { allowFailure: true });
  await delay(750);

  console.log(`Launching Expo Go: ${launchUrl}`);
  await adbExec(adb, [
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    launchUrl,
    expoPackage
  ]);

  await waitForUiText(adb, serial, shellTerms, "app shell");
  await dismissExpoDeveloperMenu(adb, serial);
  await tapProfileTab(adb, serial);
  await delay(1_500);

  const xml = await waitForProfileUi(adb, serial);
  assertNoBlockingOverlay(xml);
  writeFileSync(resolve(artifactDir, "profile-ui.xml"), xml);
  await captureScreenshot(adb, serial, resolve(artifactDir, "profile-success.png"));
  const logcat = await captureLogcat(adb, serial, resolve(artifactDir, "profile-logcat.txt"));
  assertRuntimeLogClean(logcat, "Android logcat");
  if (metroProcess && existsSync(metroLogPath)) {
    assertRuntimeLogClean(readFileSync(metroLogPath, "utf8"), "Metro log");
  }

  console.log("Android Profile login automation passed.");
  console.log(`Artifacts: ${artifactDir}`);
  cleanupMetro();
}

function validateConfiguration() {
  const missing = [];
  if (!apiBaseUrl) missing.push("EXPO_PUBLIC_API_BASE_URL");
  if (!supabaseUrl) missing.push("EXPO_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("EXPO_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!autoLoginEmail) missing.push("EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL");
  if (!autoLoginPassword) missing.push("EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`Missing required local env: ${missing.join(", ")}`);
  }
  if (autoLoginPassword !== autoLoginPassword.trim()) {
    throw new Error("EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD has leading or trailing whitespace");
  }
}

async function ensureMetro() {
  if (await isPortOpen("127.0.0.1", Number(metroPort))) {
    console.log(`Metro already listening on ${metroPort}.`);
    return;
  }

  if (noMetro) {
    throw new Error(`Metro is not listening on ${metroPort}; remove --no-metro or start Expo first`);
  }

  writeFileSync(metroLogPath, "");
  console.log(`Starting Expo Metro on ${metroPort}. Logs: ${metroLogPath}`);
  metroProcess = spawn("npx", ["expo", "start", "--clear", "--host", "localhost", "--port", metroPort], {
    cwd: mobileDir,
    env: runtimeEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const appendLog = (chunk) => writeFileSync(metroLogPath, chunk, { flag: "a" });
  metroProcess.stdout.on("data", appendLog);
  metroProcess.stderr.on("data", appendLog);
  metroProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Expo Metro exited with code ${code}. See ${metroLogPath}`);
    }
  });

  await waitForPort("127.0.0.1", Number(metroPort), 45_000, "Metro");
}

async function ensureLocalService(label, value) {
  const port = localUrlPort(value);
  if (!port) return;
  if (await isPortOpen("127.0.0.1", Number(port))) {
    console.log(`${label} reachable on localhost:${port}.`);
    return;
  }
  throw new Error(`${label} is not reachable on localhost:${port}. Start it before Android validation.`);
}

async function reverseLocalPort(adb, serial, port, label) {
  await adbExec(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
  console.log(`ADB reverse configured for ${label}: ${port}`);
}

async function reverseUrlPort(adb, serial, value, label) {
  const port = localUrlPort(value);
  if (!port) return;
  await reverseLocalPort(adb, serial, port, label);
}

async function waitForProfileUi(adb, serial) {
  return waitForUiText(adb, serial, successTerms, "Profile UI");
}

async function waitForUiText(adb, serial, terms, label) {
  const started = Date.now();
  let lastXml = "";

  while (Date.now() - started < timeoutMs) {
    lastXml = await readUiXml(adb, serial).catch(() => "");
    const normalized = decodeXml(lastXml).toLowerCase();

    const matchedFailure = failureTerms.find((term) => normalized.includes(term.toLowerCase()));
    if (matchedFailure) {
      throw new Error(`App showed failure text: ${matchedFailure}`);
    }

    const hasTerms = terms.every((term) => normalized.includes(term.toLowerCase()));
    if (hasTerms) return lastXml;

    await delay(1_500);
  }

  writeFileSync(resolve(artifactDir, `${label.replaceAll(" ", "-").toLowerCase()}-timeout-ui.xml`), lastXml);
  throw new Error(`Timed out waiting for ${label} text: ${terms.join(", ")}`);
}

async function readUiXml(adb, serial) {
  await adbExec(adb, ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/profile-window.xml"], {
    allowFailure: true
  });
  return adbExec(adb, ["-s", serial, "shell", "cat", "/sdcard/profile-window.xml"]);
}

async function dismissExpoDeveloperMenu(adb, serial) {
  const started = Date.now();

  while (Date.now() - started < 12_000) {
    const xml = await readUiXml(adb, serial).catch(() => "");
    if (!findBlockingOverlayTerm(xml)) return;

    const bounds =
      findBoundsForUiValue(xml, "content-desc", "Continue") ?? findBoundsForUiValue(xml, "text", "Continue");
    const point = bounds ? centerOfBounds(bounds) : fallbackExpoContinuePoint(await screenSize(adb, serial));
    console.log(`Dismissing Expo Go developer menu with tap at ${point.x},${point.y}.`);
    await adbExec(adb, ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)]);
    await delay(1_500);
  }

  const xml = await readUiXml(adb, serial).catch(() => "");
  const term = findBlockingOverlayTerm(xml);
  if (term) throw new Error(`Blocking overlay remained visible: ${term}`);
}

async function tapProfileTab(adb, serial) {
  const xml = await readUiXml(adb, serial).catch(() => "");
  const bounds = findBoundsForUiValue(xml, "content-desc", "Profile") ?? findBoundsForUiValue(xml, "text", "Profile");
  const point = bounds ? centerOfBounds(bounds) : fallbackProfilePoint(await screenSize(adb, serial));
  const { x, y } = point;
  console.log(`Opening Profile tab with tap at ${x},${y}.`);
  await adbExec(adb, ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
}

async function screenSize(adb, serial) {
  const output = await adbExec(adb, ["-s", serial, "shell", "wm", "size"], { allowFailure: true });
  const match = output.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!match) return { width: 1080, height: 2400 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function captureScreenshot(adb, serial, path) {
  const image = await adbExecBuffer(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 8_000_000 });
  writeFileSync(path, image);
}

async function captureLogcat(adb, serial, path) {
  const log = await adbExec(adb, ["-s", serial, "logcat", "-d", "-t", "1500"], {
    allowFailure: true,
    maxBuffer: 4_000_000
  });
  writeFileSync(path, log);
  return log;
}

function assertNoBlockingOverlay(xml) {
  const term = findBlockingOverlayTerm(xml);
  if (term) throw new Error(`Blocking overlay is visible above Profile: ${term}`);
}

function findBlockingOverlayTerm(xml) {
  const normalized = decodeXml(xml).toLowerCase();
  return ["this is the developer menu", "sdk version:", "runtime version: exposdk", "bottom sheet"].find((term) =>
    normalized.includes(term)
  );
}

function assertRuntimeLogClean(log, label) {
  const normalized = log.toLowerCase();
  const matchedTerm = runtimeFailureTerms.find((term) => normalized.includes(term.toLowerCase()));
  if (matchedTerm) throw new Error(`${label} showed failure text: ${matchedTerm}`);
}

function findBoundsForUiValue(xml, attribute, value) {
  const valuePattern = escapeRegExp(xmlEncodeAttribute(value));
  const pattern = new RegExp(`${attribute}="${valuePattern}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const match = xml.match(pattern);
  if (!match) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4])
  };
}

function centerOfBounds(bounds) {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2)
  };
}

function fallbackExpoContinuePoint({ width, height }) {
  return { x: Math.round(width * 0.5), y: Math.round(height * 0.93) };
}

function fallbackProfilePoint({ width, height }) {
  return { x: Math.round(width * 0.875), y: Math.round(height * 0.935) };
}

function xmlEncodeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeFailureArtifacts() {
  const adb = await resolveAdb().catch(() => null);
  if (!adb) return;
  const serial = await resolveDevice(adb).catch(() => null);
  if (!serial) return;
  mkdirSync(artifactDir, { recursive: true });
  await readUiXml(adb, serial)
    .then((xml) => writeFileSync(resolve(artifactDir, "profile-failure-ui.xml"), xml))
    .catch(() => {});
  await captureScreenshot(adb, serial, resolve(artifactDir, "profile-failure.png")).catch(() => {});
  await captureLogcat(adb, serial, resolve(artifactDir, "profile-failure-logcat.txt")).catch(() => {});
}

async function resolveAdb() {
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME ? resolve(process.env.ANDROID_HOME, "platform-tools/adb") : "",
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
    "adb"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await exec(candidate, ["version"], { timeout: 5_000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("adb was not found. Install Android platform-tools or set ADB=/path/to/adb.");
}

async function resolveDevice(adb) {
  if (process.env.ANDROID_SERIAL) {
    await exec(adb, ["-s", process.env.ANDROID_SERIAL, "get-state"], { timeout: 5_000 });
    return process.env.ANDROID_SERIAL;
  }

  const output = await exec(adb, ["devices"], { timeout: 5_000 });
  const devices = output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);

  if (devices.length === 0) {
    throw new Error("No online Android device found. Start an emulator or connect a device.");
  }
  if (devices.length > 1) {
    throw new Error(`Multiple Android devices found. Set ANDROID_SERIAL to one of: ${devices.join(", ")}`);
  }
  return devices[0];
}

function exec(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      commandArgs,
      {
        cwd: options.cwd ?? rootDir,
        env: options.env ?? process.env,
        timeout: options.timeout ?? 30_000,
        maxBuffer: options.maxBuffer ?? 1_000_000
      },
      (error, stdout, stderr) => {
        if (error) {
          if (options.allowFailure) {
            resolvePromise(`${stdout}${stderr}`);
            return;
          }
          reject(new Error(stderr.trim() || stdout.trim() || error.message));
          return;
        }
        resolvePromise(stdout.toString());
      }
    );
  });
}

function adbExec(adb, commandArgs, options = {}) {
  return exec(adb, commandArgs, options);
}

function adbExecBuffer(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      commandArgs,
      {
        cwd: rootDir,
        env: process.env,
        timeout: options.timeout ?? 30_000,
        maxBuffer: options.maxBuffer ?? 8_000_000,
        encoding: "buffer"
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.toString().trim() || error.message));
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

function loadEnvFiles(paths) {
  const values = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const contents = readFileSync(path, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      values[key] = unquote(rawValue);
    }
  }
  return values;
}

function envValue(name, fallback = "") {
  return process.env[name] ?? localEnv[name] ?? fallback;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromArg(name, fallback) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function localUrlPort(value) {
  try {
    const url = new URL(value);
    if (!["localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2"].includes(url.hostname)) return "";
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return "";
  }
}

function isPortOpen(host, port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port, timeout: 1_000 });
    socket.on("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.on("error", () => resolvePromise(false));
  });
}

async function waitForPort(host, port, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await isPortOpen(host, port)) return;
    await delay(1_000);
  }
  throw new Error(`${label} did not start on ${host}:${port}`);
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function cleanupMetro() {
  if (!metroProcess || keepMetro) return;
  metroProcess.kill("SIGTERM");
  metroProcess = null;
}

function userSafeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
