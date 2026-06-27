#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = resolve(rootDir, "mobile");

const args = new Set(process.argv.slice(2));
const noMetro = args.has("--no-metro");
const keepMetro = args.has("--keep-metro");
const timeoutMs = numberFromArg("--timeout-ms", 120_000);
const settleMs = numberFromArg("--settle-ms", 24_000);

const localEnv = loadEnvFiles([
  resolve(rootDir, ".env.local"),
  resolve(mobileDir, ".env.local"),
  resolve(mobileDir, ".env")
]);

const artifactDir = envValue("IOS_PROFILE_ARTIFACT_DIR", "/private/tmp/profile-ios-validation");
const metroPort = envValue("EXPO_PORT", "8081");
const apiBaseUrl = envValue("EXPO_PUBLIC_API_BASE_URL");
const supabaseUrl = envValue("EXPO_PUBLIC_SUPABASE_URL", envValue("NEXT_PUBLIC_SUPABASE_URL", ""));
const supabaseAnonKey = envValue("EXPO_PUBLIC_SUPABASE_ANON_KEY", envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""));
const autoLoginEmail = envValue("EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL", "");
const autoLoginPassword = envValue("EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD", "");
const simulatorName = envValue("IOS_SIMULATOR_NAME", "iPhone 17");
const launchUrl = withQueryParam(
  envValue("EXPO_IOS_URL", `exp://127.0.0.1:${metroPort}/--/profile`),
  "disableOnboarding",
  "1"
);
const expoPackage = envValue("EXPO_IOS_PACKAGE", "host.exp.Exponent");
const expoGoIosUrl = envValue(
  "EXPO_GO_IOS_URL",
  "https://github.com/expo/expo-go-releases/releases/download/Expo-Go-54.0.7/Expo-Go-54.0.7.tar.gz"
);
const logWindow = envValue("IOS_PROFILE_LOG_WINDOW", "4m");
const metroLogPath = resolve(artifactDir, "metro.log");
const simulatorLogPath = resolve(artifactDir, "profile-simulator.log");
const successScreenshotPath = resolve(artifactDir, "profile-success.png");
const failureScreenshotPath = resolve(artifactDir, "profile-failure.png");
const runtimeFailureTerms = splitList(
  envValue(
    "IOS_RUNTIME_FAILURE_TEXT",
    "VirtualizedLists should never be nested,Network request failed,automatic sign-in failed,CircleBites can't be reached,Unable to reach,auth_unavailable,PostgREST,permission denied,JWT,relation,violates,Unhandled JS Exception,Invariant Violation"
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
let activeSimulator = null;

main().catch(async (error) => {
  console.error(`\niOS Profile login automation failed: ${userSafeMessage(error)}`);
  await writeFailureArtifacts().catch(() => {});
  cleanupMetro();
  process.exit(1);
});

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  validateConfiguration();

  activeSimulator = await ensureSimulator();
  console.log(`Using iOS Simulator: ${activeSimulator.name} (${activeSimulator.udid})`);

  await ensureLocalService("Next API", apiBaseUrl);
  await ensureResolveEmail();
  await ensureExpoGoInstalled(activeSimulator.udid);

  console.log(`Terminating ${expoPackage} to clear stale screens.`);
  await simctl(["terminate", activeSimulator.udid, expoPackage], { allowFailure: true, timeout: 15_000 });
  await delay(750);

  await suppressExpoDeveloperMenu(activeSimulator.udid);
  await ensureMetro();

  console.log(`Opening Profile route in Expo Go: ${launchUrl}`);
  await simctl(["openurl", activeSimulator.udid, launchUrl], { timeout: 30_000 });

  await waitForProfileScreenshot(activeSimulator.udid, successScreenshotPath);

  const simulatorLog = await captureSimulatorLog(activeSimulator.udid, simulatorLogPath);
  assertRuntimeLogClean(simulatorLog, "iOS Simulator log");
  if (existsSync(metroLogPath)) {
    assertRuntimeLogClean(readFileSync(metroLogPath, "utf8"), "Metro log");
  }

  console.log("iOS Profile login automation passed.");
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

async function ensureSimulator() {
  if (process.env.IOS_SIMULATOR_UDID) {
    await simctl(["boot", process.env.IOS_SIMULATOR_UDID], { allowFailure: true, timeout: 30_000 });
    await simctl(["bootstatus", process.env.IOS_SIMULATOR_UDID, "-b"], { timeout: 180_000 });
    return { name: process.env.IOS_SIMULATOR_NAME ?? "configured simulator", udid: process.env.IOS_SIMULATOR_UDID };
  }

  const booted = parseSimctlDevices(await simctl(["list", "devices", "booted"], { timeout: 15_000 }));
  const bootedPhone = chooseSimulator(booted);
  if (bootedPhone) return bootedPhone;

  const available = parseSimctlDevices(await simctl(["list", "devices", "available"], { timeout: 15_000 }));
  const target =
    available.find((device) => device.name === simulatorName) ??
    available.find((device) => device.name.startsWith("iPhone"));

  if (!target) {
    throw new Error(`No available iOS Simulator found. Install an iOS runtime or set IOS_SIMULATOR_UDID.`);
  }

  console.log(`Booting iOS Simulator: ${target.name} (${target.udid})`);
  await simctl(["boot", target.udid], { allowFailure: true, timeout: 30_000 });
  await simctl(["bootstatus", target.udid, "-b"], { timeout: 180_000 });
  await exec("open", ["/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app"], {
    allowFailure: true,
    timeout: 10_000
  });
  return target;
}

function chooseSimulator(devices) {
  return devices.find((device) => device.name === simulatorName) ?? devices.find((device) => device.name.startsWith("iPhone"));
}

function parseSimctlDevices(output) {
  const devices = [];
  const pattern = /^\s{4}(.+?) \(([0-9A-F-]{36})\) \(([^)]+)\)/gm;
  let match;
  while ((match = pattern.exec(output))) {
    devices.push({ name: match[1], udid: match[2], state: match[3] });
  }
  return devices;
}

async function ensureLocalService(label, value) {
  const port = localUrlPort(value);
  if (!port) return;
  if (await isPortOpen("127.0.0.1", Number(port))) {
    console.log(`${label} reachable on localhost:${port}.`);
    return;
  }
  throw new Error(`${label} is not reachable on localhost:${port}. Start it before iOS validation.`);
}

async function ensureResolveEmail() {
  const response = await fetchWithTimeout(new URL("/api/mobile/auth/resolve-email", apiBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: autoLoginEmail })
  });

  if (!response.ok) {
    throw new Error(`/api/mobile/auth/resolve-email returned HTTP ${response.status}`);
  }

  const body = await response.json().catch(() => null);
  if (!body || body.mode !== "sign_in") {
    throw new Error("/api/mobile/auth/resolve-email did not return mode=sign_in for the validation account");
  }
  console.log("Login API preflight returned mode=sign_in.");
}

async function ensureExpoGoInstalled(udid) {
  if (await isExpoGoInstalled(udid)) {
    console.log("Expo Go is installed on the iOS Simulator.");
    return;
  }

  const cacheDir = resolve(artifactDir, "expo-go");
  const archiveName = expoGoIosUrl.split("/").pop() || "Expo-Go.tar.gz";
  const archivePath = resolve(cacheDir, archiveName);
  const appName = archiveName.replace(/\.tar\.gz$/, "").replace(/\.tgz$/, "") || "Expo-Go";
  const appPath = resolve(cacheDir, `${appName}.app`);

  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(archivePath) || statSync(archivePath).size < 1_000_000) {
    console.log(`Downloading Expo Go for iOS Simulator: ${expoGoIosUrl}`);
    await exec("curl", ["-L", expoGoIosUrl, "-o", archivePath], { timeout: 180_000, maxBuffer: 2_000_000 });
  }

  if (!existsSync(resolve(appPath, "Info.plist"))) {
    rmSync(appPath, { force: true, recursive: true });
    mkdirSync(appPath, { recursive: true });
    console.log(`Extracting Expo Go to ${appPath}`);
    await exec("tar", ["-xzf", archivePath, "-C", appPath], { timeout: 120_000, maxBuffer: 2_000_000 });
  }

  console.log("Installing Expo Go on the iOS Simulator.");
  await simctl(["install", udid, appPath], { timeout: 180_000, maxBuffer: 2_000_000 });

  if (!(await isExpoGoInstalled(udid))) {
    throw new Error("Expo Go install completed, but the app container was not found on the simulator");
  }
}

async function isExpoGoInstalled(udid) {
  const output = await simctl(["get_app_container", udid, expoPackage, "data"], {
    allowFailure: true,
    timeout: 15_000
  });
  return output.includes("/Containers/Data/Application/");
}

async function suppressExpoDeveloperMenu(udid) {
  const container = (await simctl(["get_app_container", udid, expoPackage, "data"], { timeout: 15_000 })).trim();
  const preferencesDir = resolve(container, "Library/Preferences");
  const preferencesPath = resolve(preferencesDir, "host.exp.Exponent.plist");

  mkdirSync(preferencesDir, { recursive: true });
  if (!existsSync(preferencesPath)) {
    writeFileSync(
      preferencesPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict/>",
        "</plist>"
      ].join("\n")
    );
  }

  await setPlistBool(preferencesPath, "EXDevMenuIsOnboardingFinished", true);
  await setPlistBool(preferencesPath, "EXDevMenuShowsAtLaunch", false);
  await setPlistBool(preferencesPath, "EXDevMenuDisableAutoLaunch", true);
  await simctl(["spawn", udid, "defaults", "write", expoPackage, "EXDevMenuIsOnboardingFinished", "-bool", "true"], {
    allowFailure: true,
    timeout: 15_000
  });
  await simctl(["spawn", udid, "defaults", "write", expoPackage, "EXDevMenuShowsAtLaunch", "-bool", "false"], {
    allowFailure: true,
    timeout: 15_000
  });
  await simctl(["spawn", udid, "defaults", "write", expoPackage, "EXDevMenuDisableAutoLaunch", "-bool", "true"], {
    allowFailure: true,
    timeout: 15_000
  });
  rmSync(resolve(container, "Library/Saved Application State/host.exp.Exponent.savedState"), {
    force: true,
    recursive: true
  });
}

async function setPlistBool(path, key, value) {
  const stringValue = value ? "true" : "false";
  const setOutput = await exec("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${stringValue}`, path], {
    allowFailure: true,
    timeout: 10_000
  });
  if (!/Does Not Exist|Entry Does Not Exist|does not exist/i.test(setOutput)) return;
  await exec("/usr/libexec/PlistBuddy", ["-c", `Add :${key} bool ${stringValue}`, path], {
    allowFailure: true,
    timeout: 10_000
  });
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
  console.log(`Starting Expo Metro for iOS on ${metroPort}. Logs: ${metroLogPath}`);
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

  await waitForPort("127.0.0.1", Number(metroPort), 60_000, "Metro");
}

async function waitForProfileScreenshot(udid, path) {
  const started = Date.now();
  let lastStats = null;
  let developerMenuSeenAt = 0;
  let attemptedDeveloperMenuDismiss = false;

  while (Date.now() - started < timeoutMs) {
    if (existsSync(metroLogPath)) assertRuntimeLogClean(readFileSync(metroLogPath, "utf8"), "Metro log");
    await delay(Math.min(2_000, settleMs));
    await captureScreenshot(udid, path);

    lastStats = pngColorStats(path);
    if (looksLikeExpoDeveloperMenu(lastStats)) {
      if (!developerMenuSeenAt) {
        developerMenuSeenAt = Date.now();
        console.log("Expo developer menu overlay detected; dismissing with Maestro.");
      }
      if (!attemptedDeveloperMenuDismiss) {
        attemptedDeveloperMenuDismiss = true;
        await dismissExpoDeveloperMenuWithMaestro(udid, looksLikeExpoDeveloperOnboarding(lastStats));
        await delay(2_000);
        continue;
      }
      if (Date.now() - developerMenuSeenAt < 12_000) continue;
      throw new Error("Blocking Expo developer menu overlay is visible above Profile");
    }
    developerMenuSeenAt = 0;
    if (looksLikeProfileContent(lastStats)) {
      console.log(
        `Profile screenshot captured after ${Math.round((Date.now() - started) / 1000)}s ` +
          `(non-white ${(lastStats.nonWhiteRatio * 100).toFixed(1)}%).`
      );
      return;
    }
  }

  const detail = lastStats
    ? ` Last screenshot ratios: non-white ${(lastStats.nonWhiteRatio * 100).toFixed(1)}%, ` +
      `strong ${(lastStats.strongNonWhiteRatio * 100).toFixed(1)}%, orange ${(lastStats.orangeRatio * 100).toFixed(1)}%.`
    : "";
  throw new Error(`Timed out waiting for iOS Profile content to render beyond loading/menu shell.${detail}`);
}

async function dismissExpoDeveloperMenuWithMaestro(udid, isOnboardingSheet) {
  const flowPath = resolve(artifactDir, "dismiss-expo-dev-menu.yaml");
  const javaHome = process.env.JAVA_HOME || "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home";
  const closeMenuStep = ['- tapOn:', '    point: "93%,33%"'];
  const flow = [
    `appId: ${expoPackage}`,
    "---",
    ...(isOnboardingSheet ? ['- tapOn:', '    point: "50%,90%"', "- waitForAnimationToEnd"] : []),
    ...closeMenuStep
  ];

  writeFileSync(flowPath, `${flow.join("\n")}\n`);

  const maestroEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
    MAESTRO_CLI_NO_ANALYTICS: "1"
  };

  await exec("maestro", ["--device", udid, "test", flowPath], {
    env: maestroEnv,
    timeout: 90_000,
    maxBuffer: 4_000_000
  }).catch((error) => {
    throw new Error(
      `Could not dismiss Expo developer menu with Maestro. ` +
        `Install/verify Maestro and Java, then retry. Details: ${error.message}`
    );
  });
}

async function captureScreenshot(udid, path) {
  await simctl(["io", udid, "screenshot", path], { timeout: 30_000, maxBuffer: 1_000_000 });
  const { size } = statSync(path);
  if (size < 50_000) {
    throw new Error(`Simulator screenshot looked empty or truncated: ${path}`);
  }
}

async function captureSimulatorLog(udid, path) {
  const predicate = [
    'process CONTAINS[c] "Expo"',
    'process CONTAINS[c] "Exponent"',
    'process CONTAINS[c] "CircleBites"',
    'eventMessage CONTAINS[c] "ReactNative"',
    'eventMessage CONTAINS[c] "Network request failed"',
    'eventMessage CONTAINS[c] "automatic sign-in failed"',
    'eventMessage CONTAINS[c] "VirtualizedLists should never be nested"',
    'eventMessage CONTAINS[c] "Unhandled JS Exception"',
    'eventMessage CONTAINS[c] "Invariant Violation"'
  ].join(" OR ");
  const log = await simctl(
    ["spawn", udid, "log", "show", "--style", "compact", "--last", logWindow, "--predicate", predicate],
    { allowFailure: true, timeout: 45_000, maxBuffer: 4_000_000 }
  );
  writeFileSync(path, log);
  return log;
}

function pngColorStats(path) {
  const file = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    }
    offset += length + 12;
  }

  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!width || !height || !bytesPerPixel || idatChunks.length === 0) {
    throw new Error("Unsupported Simulator screenshot PNG format");
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  let readOffset = 0;
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);
  let sampled = 0;
  let nonWhite = 0;
  let strongNonWhite = 0;
  let orange = 0;
  let topLuminance = 0;
  let topSamples = 0;
  let bottomWhite = 0;
  let bottomSamples = 0;
  let middleStrongNonWhite = 0;
  let middleSamples = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset++];
    const raw = inflated.subarray(readOffset, readOffset + stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let value = raw[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      current[x] = value & 255;
    }
    readOffset += stride;

    if (y % 8 === 0) {
      for (let x = 0; x < width; x += 8) {
        const index = x * bytesPerPixel;
        const red = current[index];
        const green = bytesPerPixel === 1 ? red : current[index + 1];
        const blue = bytesPerPixel === 1 ? red : current[index + 2];
        sampled += 1;
        if (red < 245 || green < 245 || blue < 245) nonWhite += 1;
        if (red < 225 || green < 225 || blue < 225) strongNonWhite += 1;
        if (red > 150 && red > green * 1.25 && red > blue * 1.6 && green > 35 && green < 180 && blue < 130) {
          orange += 1;
        }
        const luminance = (red + green + blue) / 3;
        if (y < height * 0.55) {
          topLuminance += luminance;
          topSamples += 1;
        }
        if (y > height * 0.58) {
          bottomSamples += 1;
          if (red > 245 && green > 245 && blue > 245) bottomWhite += 1;
        }
        if (y > height * 0.18 && y < height * 0.86) {
          middleSamples += 1;
          if (red < 225 || green < 225 || blue < 225) middleStrongNonWhite += 1;
        }
      }
    }

    [previous, current] = [current, previous];
  }

  return {
    bottomWhiteRatio: bottomSamples ? bottomWhite / bottomSamples : 0,
    middleStrongNonWhiteRatio: middleSamples ? middleStrongNonWhite / middleSamples : 0,
    nonWhiteRatio: nonWhite / sampled,
    orangeRatio: orange / sampled,
    strongNonWhiteRatio: strongNonWhite / sampled,
    topAverageLuminance: topSamples ? topLuminance / topSamples : 255
  };
}

function looksLikeExpoDeveloperMenu(stats) {
  return (
    (stats.bottomWhiteRatio > 0.45 && stats.topAverageLuminance < 190) ||
    (stats.nonWhiteRatio > 0.5 &&
      stats.strongNonWhiteRatio < 0.1 &&
      stats.orangeRatio < 0.002 &&
      stats.bottomWhiteRatio > 0.08)
  );
}

function looksLikeExpoDeveloperOnboarding(stats) {
  return stats.strongNonWhiteRatio > 0.45 && stats.topAverageLuminance < 150 && stats.bottomWhiteRatio > 0.65;
}

function looksLikeProfileContent(stats) {
  return stats.strongNonWhiteRatio >= 0.12 && stats.middleStrongNonWhiteRatio >= 0.12 && stats.orangeRatio >= 0.003;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function assertRuntimeLogClean(log, label) {
  const normalized = log.toLowerCase();
  const matchedTerm = runtimeFailureTerms.find((term) => normalized.includes(term.toLowerCase()));
  if (matchedTerm) throw new Error(`${label} showed failure text: ${matchedTerm}`);
}

async function writeFailureArtifacts() {
  if (!activeSimulator) return;
  mkdirSync(artifactDir, { recursive: true });
  await captureScreenshot(activeSimulator.udid, failureScreenshotPath).catch(() => {});
  await captureSimulatorLog(activeSimulator.udid, simulatorLogPath).catch(() => {});
}

function simctl(commandArgs, options = {}) {
  return exec("xcrun", ["simctl", ...commandArgs], options);
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

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

function withQueryParam(value, key, paramValue) {
  try {
    const url = new URL(value);
    url.searchParams.set(key, paramValue);
    return url.toString();
  } catch {
    const separator = value.includes("?") ? "&" : "?";
    return value.includes(`${key}=`) ? value : `${value}${separator}${key}=${paramValue}`;
  }
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
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return "";
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
