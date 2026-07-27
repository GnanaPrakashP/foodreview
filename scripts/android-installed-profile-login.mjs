#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = resolve(rootDir, "mobile");
const localEnv = loadEnvFiles([
  resolve(rootDir, ".env.local"),
  resolve(rootDir, ".env"),
  resolve(mobileDir, ".env.local"),
  resolve(mobileDir, ".env")
]);
const args = new Set(process.argv.slice(2));
const artifactDir = envValue("ANDROID_PROFILE_ARTIFACT_DIR", "/private/tmp/profile-android-validation");
const apiBaseUrl = envValue("EXPO_PUBLIC_API_BASE_URL");
const apiPort = localUrlPort(apiBaseUrl);
const loginEmail = envValue("ANDROID_LOGIN_EMAIL", "");
const configuredOtp = envValue("ANDROID_LOGIN_OTP", "");
const mailpitUrl = envValue("ANDROID_MAILPIT_URL", "http://127.0.0.1:54324");
const appPackage = envValue("ANDROID_APP_PACKAGE", "com.circlebites.mobile");
const appActivity = envValue("ANDROID_APP_ACTIVITY", ".MainActivity");
const appLaunchUrl = envValue("ANDROID_APP_LAUNCH_URL", "");
const grantLocation = envValue("ANDROID_PROFILE_GRANT_LOCATION", "") === "1";
const apkPath = envValue("ANDROID_APK_PATH", "");
const timeoutMs = numberFromArg("--timeout-ms", 90_000);
const serverLogPath = resolve(artifactDir, "installed-profile-next.log");
const restartServer = args.has("--restart-server");
const keepServer = !args.has("--stop-server-after");
const clearAppData = !args.has("--keep-app-data");

const failureTerms = [
  "We can't reach CircleBites right now",
  "Sign in is unavailable right now",
  "Network request failed",
  "auth_unavailable",
  "PostgREST",
  "Supabase",
  "permission denied",
  "JWT",
  "relation",
  "violates",
  "VirtualizedLists should never be nested",
  "FATAL EXCEPTION",
  "ReactNativeJS: TypeError"
];
const logFailureTerms = failureTerms.filter((term) => term !== "Supabase");
const profileTerms = splitList(envValue("ANDROID_PROFILE_SUCCESS_TEXT", "Rahul,Posts,Memories"));

let startedServer = null;

main().catch(async (error) => {
  console.error(`\nInstalled Android Profile automation failed: ${safeMessage(error)}`);
  await writeFailureArtifacts().catch(() => {});
  cleanupServer();
  process.exit(1);
});

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  validateConfiguration();

  const existingMailIds = configuredOtp ? new Set() : await mailIds();
  await ensureNextServer();

  const adb = await resolveAdb();
  const serial = await resolveDevice(adb);
  console.log(`Using Android device: ${serial}`);

  if (apkPath) {
    console.log(`Installing APK: ${apkPath}`);
    await adbExec(adb, ["-s", serial, "uninstall", appPackage], { allowFailure: true, timeout: 60_000 });
    await adbExec(adb, ["-s", serial, "install", "-r", apkPath], { timeout: 120_000 });
  }

  if (apiPort) {
    await adbExec(adb, ["-s", serial, "reverse", `tcp:${apiPort}`, `tcp:${apiPort}`], { allowFailure: true });
  }
  await adbExec(adb, ["-s", serial, "logcat", "-c"], { allowFailure: true });

  if (clearAppData) {
    console.log(`Clearing ${appPackage} data.`);
    await adbExec(adb, ["-s", serial, "shell", "pm", "clear", appPackage], { allowFailure: true });
  }
  // This automation validates login/profile behavior, not notification consent.
  // Avoid leaving the Android 13+ runtime dialog over the logged-in shell.
  await adbExec(adb, [
    "-s", serial, "shell", "pm", "grant", appPackage, "android.permission.POST_NOTIFICATIONS"
  ], { allowFailure: true });
  if (grantLocation) {
    await adbExec(adb, [
      "-s", serial, "shell", "pm", "grant", appPackage, "android.permission.ACCESS_COARSE_LOCATION"
    ], { allowFailure: true });
    await adbExec(adb, [
      "-s", serial, "shell", "pm", "grant", appPackage, "android.permission.ACCESS_FINE_LOCATION"
    ], { allowFailure: true });
  }

  // Keep installed-build automation from silently polling behind an ambient or
  // non-secure keyguard. A secure device still has to be unlocked by its owner.
  await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "224"], { allowFailure: true });
  await adbExec(adb, ["-s", serial, "shell", "wm", "dismiss-keyguard"], { allowFailure: true });
  console.log(`Launching ${appPackage}/${appActivity}.`);
  await adbExec(adb, ["-s", serial, "shell", "am", "force-stop", appPackage], { allowFailure: true });
  if (appLaunchUrl) {
    await adbExec(adb, [
      "-s", serial, "shell", "am", "start",
      "-a", "android.intent.action.VIEW",
      "-d", appLaunchUrl,
      "-p", appPackage
    ]);
  } else {
    await adbExec(adb, ["-s", serial, "shell", "am", "start", "-n", `${appPackage}/${appActivity}`]);
  }
  if (appLaunchUrl) await dismissDevClientWelcome(adb, serial);

  await openEmailLogin(adb, serial);
  await fillEmailAndSendCode(adb, serial);
  await fillOtpAndContinue(adb, serial, await verificationCode(existingMailIds));
  await openProfile(adb, serial);

  const xml = await waitForUiText(adb, serial, profileTerms, "Profile");
  writeFileSync(resolve(artifactDir, "installed-profile-success-ui.xml"), xml);
  await captureScreenshot(adb, serial, resolve(artifactDir, "installed-profile-success.png"));
  const logcat = await captureLogcat(adb, serial, resolve(artifactDir, "installed-profile-logcat.txt"));
  assertLogClean(logcat);

  console.log("Installed Android Profile automation passed.");
  console.log(`Artifacts: ${artifactDir}`);
  cleanupServer();
}

function validateConfiguration() {
  if (!apiBaseUrl) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
  if (!loginEmail.trim()) throw new Error("Missing ANDROID_LOGIN_EMAIL");
  if (configuredOtp && !/^\d{6}$/.test(configuredOtp)) throw new Error("ANDROID_LOGIN_OTP must contain exactly six digits");
  if (apkPath && !existsSync(apkPath)) throw new Error(`ANDROID_APK_PATH does not exist: ${apkPath}`);
}

async function ensureNextServer() {
  if (restartServer && apiPort) {
    await stopPort(apiPort);
  }

  if (await emailOtpWorks()) {
    console.log(`Next API ready on ${apiBaseUrl}.`);
    return;
  }

  if (!apiPort) {
    throw new Error("Configured EXPO_PUBLIC_API_BASE_URL did not pass /api/mobile/auth/email-otp preflight");
  }

  writeFileSync(serverLogPath, "");
  console.log(`Starting Next API on port ${apiPort}. Logs: ${serverLogPath}`);
  startedServer = spawn("npm", ["run", "dev", "--", "-p", apiPort], {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const appendLog = (chunk) => writeFileSync(serverLogPath, chunk, { flag: "a" });
  startedServer.stdout.on("data", appendLog);
  startedServer.stderr.on("data", appendLog);

  await waitForPort("127.0.0.1", Number(apiPort), 45_000, "Next API");
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (await emailOtpWorks()) return;
    await delay(1_000);
  }
  throw new Error("Next API started, but /api/mobile/auth/email-otp did not accept the request");
}

async function emailOtpWorks() {
  try {
    const response = await fetch(new URL("/api/mobile/auth/email-otp", apiBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The endpoint deliberately returns the same accepted response for an
      // invalid address, which makes this a side-effect-free readiness probe.
      // Using the fixture email here would issue and then supersede its OTP.
      body: JSON.stringify({ email: "invalid-readiness-probe" })
    });
    const payload = await response.json().catch(() => null);
    return response.ok && payload?.ok === true;
  } catch {
    return false;
  }
}

async function stopPort(port) {
  const pids = await exec("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { allowFailure: true });
  for (const pid of pids.split(/\s+/).filter(Boolean)) {
    console.log(`Stopping stale process on port ${port}: ${pid}`);
    await exec("kill", [pid], { allowFailure: true });
  }
  await delay(1_000);
}

async function openEmailLogin(adb, serial) {
  const xml = await waitForAnyUiText(adb, serial, ["Continue with Email", "Continue with email"], "auth entry");
  if (normalizedXml(xml).includes("continue with email") && normalizedXml(xml).includes("name@example.com")) return;
  await tapText(adb, serial, xml, "Continue with Email", fallbackPoint(await screenSize(adb, serial), 0.5, 0.75));
  await waitForUiText(adb, serial, ["name@example.com", "Send code"], "email form");
  await captureScreenshot(adb, serial, resolve(artifactDir, "installed-email-form.png"));
}

async function dismissDevClientWelcome(adb, serial) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const xml = await readUiXml(adb, serial).catch(() => "");
    const normalized = normalizedXml(xml);
    if (
      normalized.includes("this is the developer menu") &&
      normalized.includes("continue")
    ) {
      await tapText(
        adb,
        serial,
        xml,
        "Continue",
        fallbackPoint(await screenSize(adb, serial), 0.5, 0.94)
      );
      await delay(1_000);
      // The one-time sheet reveals the regular developer menu underneath.
      // Android Back closes that menu and returns to the loaded application.
      await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "4"], { allowFailure: true });
      await delay(1_000);
      return;
    }
    if (
      normalized.includes("continue with email") ||
      normalized.includes("name@example.com")
    ) return;
    await delay(500);
  }
}

async function fillEmailAndSendCode(adb, serial) {
  let xml = await readUiXml(adb, serial);
  await tapText(adb, serial, xml, "name@example.com", fallbackPoint(await screenSize(adb, serial), 0.5, 0.79));
  await clearFocusedText(adb, serial, 48);
  await adbExec(adb, ["-s", serial, "shell", "input", "text", loginEmail]);
  await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "111"], { allowFailure: true });

  xml = await readUiXml(adb, serial);
  await tapText(adb, serial, xml, "Send code", fallbackPoint(await screenSize(adb, serial), 0.5, 0.88));
  await waitForUiText(adb, serial, ["Enter verification code", "Verify and continue"], "verification code form");
  await captureScreenshot(adb, serial, resolve(artifactDir, "installed-otp-form.png"));
}

async function fillOtpAndContinue(adb, serial, otp) {
  let xml = await readUiXml(adb, serial);
  await tapText(adb, serial, xml, "Verification code", fallbackPoint(await screenSize(adb, serial), 0.5, 0.58));
  await adbExec(adb, ["-s", serial, "shell", "input", "text", otp]);
  await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "111"], { allowFailure: true });

  xml = await readUiXml(adb, serial);
  await tapText(adb, serial, xml, "Verify and continue", fallbackPoint(await screenSize(adb, serial), 0.5, 0.75));
  await waitForLoggedInShell(adb, serial);
}

async function mailIds() {
  const response = await fetch(`${mailpitUrl}/api/v1/messages`);
  if (!response.ok) throw new Error("Mailpit is unavailable; set ANDROID_LOGIN_OTP for a non-local email provider");
  const payload = await response.json();
  return new Set((payload.messages ?? []).map((message) => message.ID));
}

async function verificationCode(existingMailIds) {
  if (configuredOtp) return configuredOtp;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    if (!response.ok) throw new Error("Mailpit is unavailable; set ANDROID_LOGIN_OTP for a non-local email provider");
    const payload = await response.json();
    for (const message of payload.messages ?? []) {
      if (existingMailIds.has(message.ID)) continue;
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
      if (!detailResponse.ok) continue;
      const content = allStrings(await detailResponse.json()).join("\n");
      if (!content.toLowerCase().includes(loginEmail.toLowerCase())) continue;
      const otp = content.match(/\b\d{6}\b/)?.[0];
      if (otp) return otp;
    }
    await delay(300);
  }
  throw new Error("Timed out waiting for the CircleBites verification code in Mailpit");
}

function allStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) allStrings(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) allStrings(item, output);
  return output;
}

async function openProfile(adb, serial) {
  const size = await screenSize(adb, serial);
  await waitForLoggedInShell(adb, serial);
  await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "111"], { allowFailure: true });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const xml = await readUiXml(adb, serial);
    if (isProfileScreen(xml)) return;

    const bounds = findBottomNavBounds(xml, size, "Profile");
    const point = profileTapPoint(bounds, size, attempt);
    console.log(`Opening Profile tab attempt ${attempt + 1} with tap at ${point.x},${point.y}.`);
    await adbExec(adb, ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)]);

    const afterTap = await waitForProfileScreen(adb, serial, 4_000);
    if (isProfileScreen(afterTap)) return;
  }

  const xml = await readUiXml(adb, serial).catch(() => "");
  writeFileSync(resolve(artifactDir, "profile-navigation-failed-ui.xml"), xml);
  throw new Error(`Could not open Profile tab after retries. Expected Profile terms: ${profileTerms.join(", ")}`);
}

async function waitForLoggedInShell(adb, serial) {
  const size = await screenSize(adb, serial);
  const started = Date.now();
  let lastXml = "";
  while (Date.now() - started < timeoutMs) {
    lastXml = await readUiXml(adb, serial).catch(() => "");
    const normalized = normalizedXml(lastXml);
    if (await dismissBlockingSystemDialog(adb, serial, lastXml, normalized)) {
      await delay(1_000);
      continue;
    }
    const failure = failureTermForXml(lastXml);
    if (failure) throw new Error(`App showed failure text: ${failure}`);
    if (findBottomNavBounds(lastXml, size, "Profile") || normalized.includes("set up your profile")) return lastXml;
    await delay(1_000);
  }
  writeFileSync(resolve(artifactDir, "post-login-shell-timeout-ui.xml"), lastXml);
  throw new Error("Timed out waiting for logged-in shell with Profile tab");
}

async function waitForProfileScreen(adb, serial, timeout) {
  const started = Date.now();
  let lastXml = "";
  while (Date.now() - started < timeout) {
    lastXml = await readUiXml(adb, serial).catch(() => "");
    const normalized = normalizedXml(lastXml);
    if (await dismissBlockingSystemDialog(adb, serial, lastXml, normalized)) {
      await delay(500);
      continue;
    }
    const failure = failureTermForXml(lastXml);
    if (failure) throw new Error(`App showed failure text: ${failure}`);
    if (isProfileScreen(lastXml)) return lastXml;
    await delay(500);
  }
  return lastXml;
}

async function waitForUiText(adb, serial, terms, label) {
  const started = Date.now();
  let lastXml = "";
  while (Date.now() - started < timeoutMs) {
    lastXml = await readUiXml(adb, serial).catch(() => "");
    const normalized = normalizedXml(lastXml);
    if (await dismissBlockingSystemDialog(adb, serial, lastXml, normalized)) {
      await delay(1_000);
      continue;
    }
    const failure = failureTermForXml(lastXml);
    if (failure) throw new Error(`App showed failure text: ${failure}`);
    if (hasAllTerms(lastXml, terms)) return lastXml;
    await delay(1_000);
  }
  writeFileSync(resolve(artifactDir, `${safeName(label)}-timeout-ui.xml`), lastXml);
  throw new Error(`Timed out waiting for ${label}: ${terms.join(", ")}`);
}

async function waitForAnyUiText(adb, serial, terms, label) {
  const started = Date.now();
  let lastXml = "";
  while (Date.now() - started < timeoutMs) {
    lastXml = await readUiXml(adb, serial).catch(() => "");
    const normalized = normalizedXml(lastXml);
    if (await dismissBlockingSystemDialog(adb, serial, lastXml, normalized)) {
      await delay(1_000);
      continue;
    }
    const failure = failureTermForXml(lastXml);
    if (failure) throw new Error(`App showed failure text: ${failure}`);
    if (hasAnyTerm(lastXml, terms)) return lastXml;
    await delay(1_000);
  }
  writeFileSync(resolve(artifactDir, `${safeName(label)}-timeout-ui.xml`), lastXml);
  throw new Error(`Timed out waiting for ${label}: ${terms.join(" or ")}`);
}

async function dismissBlockingSystemDialog(adb, serial, xml, normalized) {
  const isNotificationPrompt = normalized.includes("allow circlebites to send you notifications");
  const isLocationPrompt =
    normalized.includes("allow circlebites dev to access this device’s location") ||
    normalized.includes("allow circlebites dev to access this device's location");
  if (!isNotificationPrompt && !isLocationPrompt) return false;

  const bounds =
    (isLocationPrompt ? findBounds(xml, "text", "While using the app") : null) ??
    findBounds(xml, "text", "Don’t allow") ??
    findBounds(xml, "text", "Don't allow") ??
    findBounds(xml, "text", "Deny") ??
    findBounds(xml, "text", "Allow");
  if (!bounds) return false;

  const point = centerOfBounds(bounds);
  await adbExec(adb, ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)]);
  return true;
}

async function tapText(adb, serial, xml, text, fallback) {
  const bounds = findBounds(xml, "text", text) ?? findBounds(xml, "content-desc", text);
  await tapBounds(adb, serial, bounds, fallback);
}

async function tapBounds(adb, serial, bounds, fallback) {
  const point = bounds ? centerOfBounds(bounds) : fallback;
  await adbExec(adb, ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)]);
  await delay(650);
}

async function clearFocusedText(adb, serial, count) {
  await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "123"], { allowFailure: true });
  for (let i = 0; i < count; i += 1) {
    await adbExec(adb, ["-s", serial, "shell", "input", "keyevent", "67"], { allowFailure: true });
  }
}

async function readUiXml(adb, serial) {
  await adbExec(adb, ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/installed-profile-window.xml"], {
    allowFailure: true
  });
  return adbExec(adb, ["-s", serial, "shell", "cat", "/sdcard/installed-profile-window.xml"]);
}

async function captureScreenshot(adb, serial, path) {
  const image = await adbExecBuffer(adb, ["-s", serial, "exec-out", "screencap", "-p"], { maxBuffer: 8_000_000 });
  writeFileSync(path, image);
}

async function captureLogcat(adb, serial, path) {
  const log = await adbExec(adb, ["-s", serial, "logcat", "-d", "-t", "2000"], {
    allowFailure: true,
    maxBuffer: 5_000_000
  });
  writeFileSync(path, log);
  return log;
}

function assertLogClean(log) {
  const normalized = log.toLowerCase();
  const failure = logFailureTerms.find((term) => normalized.includes(term.toLowerCase()));
  if (failure) throw new Error(`Android logcat showed failure text: ${failure}`);
}

async function writeFailureArtifacts() {
  const adb = await resolveAdb().catch(() => null);
  if (!adb) return;
  const serial = await resolveDevice(adb).catch(() => null);
  if (!serial) return;
  mkdirSync(artifactDir, { recursive: true });
  await readUiXml(adb, serial)
    .then((xml) => writeFileSync(resolve(artifactDir, "installed-profile-failure-ui.xml"), xml))
    .catch(() => {});
  await captureScreenshot(adb, serial, resolve(artifactDir, "installed-profile-failure.png")).catch(() => {});
  await captureLogcat(adb, serial, resolve(artifactDir, "installed-profile-failure-logcat.txt")).catch(() => {});
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
      // Keep searching.
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

  if (devices.length === 0) throw new Error("No online Android device found.");
  if (devices.length > 1) throw new Error(`Multiple Android devices found. Set ANDROID_SERIAL to one of: ${devices.join(", ")}`);
  return devices[0];
}

async function screenSize(adb, serial) {
  const output = await adbExec(adb, ["-s", serial, "shell", "wm", "size"], { allowFailure: true });
  const match = output.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!match) return { width: 1080, height: 2400 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function findBounds(xml, attribute, value) {
  return findAllBounds(xml, attribute, value)[0] ?? null;
}

function findAllBounds(xml, attribute, value) {
  const encodedValue = xmlEncodeAttribute(value);
  const nodePattern = new RegExp(`<node\\b[^>]*${attribute}="${escapeRegExp(encodedValue)}"[^>]*>`, "g");
  const bounds = [];
  let nodeMatch;
  while ((nodeMatch = nodePattern.exec(xml))) {
    const boundsMatch = nodeMatch[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) continue;
    bounds.push({
      left: Number(boundsMatch[1]),
      top: Number(boundsMatch[2]),
      right: Number(boundsMatch[3]),
      bottom: Number(boundsMatch[4])
    });
  }
  return bounds;
}

function findBottomNavBounds(xml, size, value) {
  const minTop = size.height * 0.75;
  const candidates = [
    ...findAllBounds(xml, "content-desc", value),
    ...findAllBounds(xml, "text", value)
  ].filter((bounds) => bounds.top >= minTop && bounds.bottom <= size.height);
  return candidates.sort((a, b) => b.bottom - a.bottom)[0] ?? null;
}

function centerOfBounds(bounds) {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2)
  };
}

function fallbackPoint({ width, height }, xRatio, yRatio) {
  return { x: Math.round(width * xRatio), y: Math.round(height * yRatio) };
}

function profileTapPoint(bounds, size, attempt) {
  if (bounds) return centerOfBounds(bounds);
  const fallbacks = [
    fallbackPoint(size, 0.875, 0.945),
    fallbackPoint(size, 0.875, 0.935),
    fallbackPoint(size, 0.91, 0.935),
    fallbackPoint(size, 0.84, 0.935)
  ];
  return fallbacks[attempt % fallbacks.length];
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
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      values[trimmed.slice(0, index).trim()] = unquote(trimmed.slice(index + 1).trim());
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

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromArg(name, fallback) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedXml(xml) {
  return decodeXml(xml).toLowerCase();
}

function failureTermForXml(xml) {
  const normalized = normalizedXml(xml);
  return failureTerms.find((term) => normalized.includes(term.toLowerCase()));
}

function hasAllTerms(xml, terms) {
  const normalized = normalizedXml(xml);
  return terms.every((term) => normalized.includes(term.toLowerCase()));
}

function hasAnyTerm(xml, terms) {
  const normalized = normalizedXml(xml);
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function isProfileScreen(xml) {
  return hasAllTerms(xml, profileTerms);
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
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

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function cleanupServer() {
  if (!startedServer || keepServer) return;
  startedServer.kill("SIGTERM");
  startedServer = null;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
