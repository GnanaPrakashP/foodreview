#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ID = "com.circlebites.mobile.dev";
const SCHEME = "circlebites-dev";
const DEFAULT_PORT = 8081;
const DEFAULT_HOST = "127.0.0.1";
const METRO_START_TIMEOUT_MS = 60_000;
const API_START_TIMEOUT_MS = 60_000;
const EXISTING_API_WAIT_TIMEOUT_MS = 10_000;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, "..");
const projectRoot = resolve(mobileRoot, "..");
const androidRoot = join(mobileRoot, "android");
const gradlew = join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const debugApk = join(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

function parseArgs(argv) {
  const options = {
    clearData: false,
    device: "",
    host: "",
    launch: true,
    port: DEFAULT_PORT,
    startApi: true,
    restartMetro: true,
    startMetro: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--device" && next) {
      options.device = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--device=")) {
      options.device = arg.slice("--device=".length);
      continue;
    }
    if (arg === "--host" && next) {
      options.host = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--port" && next) {
      options.port = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--no-launch") {
      options.launch = false;
      continue;
    }
    if (arg === "--no-start-metro") {
      options.startMetro = false;
      continue;
    }
    if (arg === "--no-start-api") {
      options.startApi = false;
      continue;
    }
    if (arg === "--no-restart-metro") {
      options.restartMetro = false;
      continue;
    }
    if (arg === "--clear-data") {
      options.clearData = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid --port value: ${options.port}`);
  }

  return options;
}

function printHelp() {
  console.log(`Rebuild, reinstall, and launch CircleBites on a connected Android phone.

Usage:
  npm run android:reinstall:phone
  npm run android:reinstall:phone -- --device ZA223JVWG7
  npm run android:reinstall:phone -- --host 192.168.0.5 --port 8081

Options:
  --device <serial>  ADB device serial. Defaults to the first physical phone.
  --host <ip>        Metro host/IP for the dev client. Defaults to EXPO_DEV_HOST or ${DEFAULT_HOST} over adb reverse.
  --port <port>      Metro port. Defaults to ${DEFAULT_PORT}.
  --clear-data       Clear Android app data after reinstall. This signs you out and resets local app storage.
  --no-start-api     Do not auto-start the local Next API when EXPO_PUBLIC_API_BASE_URL is loopback.
  --no-start-metro   Do not auto-start Expo Metro when the port is not reachable.
  --no-restart-metro Keep an already-running Metro process instead of restarting it with a cleared cache.
  --no-launch        Install only; do not open the dev client.
`);
}

function commandExists(command) {
  const result = spawnSync(command, ["version"], { encoding: "utf8", stdio: "ignore" });
  return result.status === 0;
}

function adbPath() {
  if (process.env.ADB) return process.env.ADB;
  const homebrewAdb = "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
  if (existsSync(homebrewAdb)) return homebrewAdb;
  if (commandExists("adb")) return "adb";
  throw new Error("Could not find adb. Set ADB=/path/to/adb and try again.");
}

function validJavaHome(path) {
  return Boolean(path) && existsSync(join(path, "bin", process.platform === "win32" ? "java.exe" : "java"));
}

function javaHomePath() {
  if (validJavaHome(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

  const candidates = [
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    "/Applications/Android Studio.app/Contents/jre/Contents/Home",
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
    "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home"
  ];

  for (const candidate of candidates) {
    if (validJavaHome(candidate)) return candidate;
  }

  const javaHome = spawnSync("/usr/libexec/java_home", ["-v", "17"], { encoding: "utf8", stdio: "pipe" });
  const detected = javaHome.status === 0 ? javaHome.stdout.trim() : "";
  if (validJavaHome(detected)) return detected;

  throw new Error([
    "Could not find a Java runtime for Android builds.",
    "Install one with:",
    "  brew install openjdk@17",
    "",
    "Then rerun:",
    "  npm run mobile:reinstall:phone"
  ].join("\n"));
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? mobileRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(output || `${command} exited with status ${result.status}`);
  }

  return result.stdout ?? "";
}

function connectedDevices(adb) {
  const output = run(adb, ["devices"], { capture: true });
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((device) => device.state === "device");
}

function selectDevice(adb, requestedSerial) {
  const devices = connectedDevices(adb);
  if (devices.length === 0) {
    throw new Error("No Android device is connected. Plug in your phone and allow USB debugging.");
  }

  if (requestedSerial) {
    const found = devices.find((device) => device.serial === requestedSerial);
    if (!found) {
      throw new Error(`Device ${requestedSerial} is not connected. Connected: ${devices.map((item) => item.serial).join(", ")}`);
    }
    return found.serial;
  }

  const physicalDevices = devices.filter((device) => !/^emulator-/i.test(device.serial));
  if (physicalDevices.length === 1) return physicalDevices[0].serial;
  if (devices.length === 1) return devices[0].serial;

  throw new Error(
    `Multiple Android devices are connected. Pass one explicitly with --device.\nConnected: ${devices.map((item) => item.serial).join(", ")}`
  );
}

function defaultHost() {
  return process.env.EXPO_DEV_HOST || DEFAULT_HOST;
}

function isLocalhostHost(host) {
  return host === "127.0.0.1" || host === "localhost";
}

function metroHostMode(host) {
  return isLocalhostHost(host) ? "localhost" : "lan";
}

function expoCliCommand() {
  const localExpo = join(mobileRoot, "node_modules", ".bin", process.platform === "win32" ? "expo.cmd" : "expo");
  if (existsSync(localExpo)) return { command: localExpo, args: [] };
  return { command: "npx", args: ["expo"] };
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return values;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) return values;

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) values[key] = value;
      return values;
    }, {});
}

function mobileEnv() {
  return {
    ...parseEnvFile(join(mobileRoot, ".env")),
    ...parseEnvFile(join(mobileRoot, ".env.local")),
    ...process.env
  };
}

function mobileProcessEnv() {
  const env = { ...process.env };
  delete env.API_RATE_LIMIT_HMAC_SECRET;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  return env;
}

function apiBaseUrl() {
  const raw = mobileEnv().EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return null;

  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function supabaseBaseUrl() {
  const raw = mobileEnv().EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;

  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLoopbackApiUrl(url) {
  return url.protocol === "http:" && isLocalhostHost(url.hostname);
}

function apiPort(url) {
  return Number(url.port) || 80;
}

function apiReadinessPath(url) {
  const prefix = url.pathname.replace(/\/$/, "");
  return `${prefix}/api/health`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function metroListenPids(port) {
  if (process.platform === "win32") return [];

  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status !== 0) return [];

  return result.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function metroStatus(host, port, timeoutMs = 1200) {
  return new Promise((resolveStatus) => {
    const req = http.get({
      host,
      path: "/status",
      port,
      timeout: timeoutMs
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolveStatus(body.includes("packager-status:running"));
      });
    });

    req.on("error", () => resolveStatus(false));
    req.on("timeout", () => {
      req.destroy();
      resolveStatus(false);
    });
  });
}

async function waitForMetro(host, port, timeoutMs = METRO_START_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await metroStatus(host, port)) return true;
    await delay(1000);
  }
  return false;
}

function apiStatus(url, timeoutMs = 1200) {
  return new Promise((resolveStatus) => {
    const req = http.get({
      host: url.hostname,
      path: apiReadinessPath(url),
      port: apiPort(url),
      timeout: timeoutMs
    }, (res) => {
      res.resume();
      res.on("end", () => {
        resolveStatus(Boolean(res.statusCode && res.statusCode < 500));
      });
    });

    req.on("error", () => resolveStatus(false));
    req.on("timeout", () => {
      req.destroy();
      resolveStatus(false);
    });
  });
}

async function waitForApi(url, timeoutMs = API_START_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await apiStatus(url)) return true;
    await delay(1000);
  }
  return false;
}

function startApiServer(url) {
  const port = apiPort(url);
  const logPath = join(tmpdir(), `circlebites-next-api-${port}.log`);
  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn("npm", ["run", "dev", "--", "-H", url.hostname, "-p", String(port)], {
    cwd: projectRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", out, err]
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  console.log(`Started Next API in the background (pid ${child.pid}). Logs: ${logPath}`);
}

async function ensureApiServer(url, shouldStart) {
  if (await apiStatus(url)) {
    console.log(`Next API is reachable at ${url.origin}`);
    return true;
  }

  if (!shouldStart) {
    console.log(`Next API is not reachable at ${url.origin}. Start it with: npm run dev -- -p ${apiPort(url)}`);
    return false;
  }

  const existingPids = metroListenPids(apiPort(url));
  if (existingPids.length > 0) {
    console.log(`Port ${apiPort(url)} is already in use; waiting for the existing Next API health check...`);
    if (await waitForApi(url, EXISTING_API_WAIT_TIMEOUT_MS)) {
      console.log(`Next API is reachable at ${url.origin}`);
      return true;
    }
    throw new Error(`Port ${apiPort(url)} is in use, but the Next API did not respond. Stop that process or update EXPO_PUBLIC_API_BASE_URL.`);
  }

  console.log(`Next API is not reachable at ${url.origin}; starting it...`);
  startApiServer(url);
  if (await waitForApi(url)) {
    console.log(`Next API is ready at ${url.origin}`);
    return true;
  }

  throw new Error(`Next API did not become reachable at ${url.origin}. Check /tmp/circlebites-next-api-${apiPort(url)}.log and retry.`);
}

async function stopMetroOnPort(port) {
  const pids = metroListenPids(port);
  if (pids.length === 0) return false;

  console.log(`Stopping existing Metro process on port ${port}: ${pids.join(", ")}`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // It may have exited between lsof and kill.
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(250);
    if (metroListenPids(port).length === 0) return true;
  }

  for (const pid of metroListenPids(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It may have exited after the retry loop.
    }
  }
  await delay(500);
  return metroListenPids(port).length === 0;
}

function startMetro(host, port) {
  const { command, args } = expoCliCommand();
  const expoArgs = [
    ...args,
    "start",
    "--dev-client",
    "--host",
    metroHostMode(host),
    "--port",
    String(port),
    "--clear"
  ];
  const logPath = join(tmpdir(), `circlebites-metro-${port}.log`);
  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn(command, expoArgs, {
    cwd: mobileRoot,
    detached: true,
    env: mobileProcessEnv(),
    stdio: ["ignore", out, err]
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  console.log(`Started Expo Metro in the background (pid ${child.pid}). Logs: ${logPath}`);
}

async function ensureMetro(host, port, shouldStart, shouldRestart) {
  if (await metroStatus(host, port)) {
    if (shouldStart && shouldRestart) {
      console.log(`Metro is reachable at http://${host}:${port}; restarting it with a cleared cache.`);
      const stopped = await stopMetroOnPort(port);
      if (!stopped) {
        throw new Error(`Metro is already running on port ${port}, but it could not be stopped. Stop it manually or rerun with --no-restart-metro.`);
      }
      startMetro(host, port);
      if (await waitForMetro(host, port)) {
        console.log(`Metro is ready at http://${host}:${port}`);
        return;
      }
      throw new Error(`Metro did not become reachable at http://${host}:${port}. Check /tmp/circlebites-metro-${port}.log and retry.`);
    }
    console.log(`Metro is reachable at http://${host}:${port}`);
    return;
  }

  if (!shouldStart) {
    throw new Error(`Metro is not reachable at http://${host}:${port}. Start it with: npm --prefix mobile run start -- --dev-client --host ${metroHostMode(host)} --port ${port}`);
  }

  console.log(`Metro is not reachable at http://${host}:${port}; starting Expo Metro...`);
  startMetro(host, port);
  if (await waitForMetro(host, port)) {
    console.log(`Metro is ready at http://${host}:${port}`);
    return;
  }

  throw new Error(`Metro did not become reachable at http://${host}:${port}. Check /tmp/circlebites-metro-${port}.log and retry.`);
}

function devClientUrl(host, port) {
  const metroUrl = `http://${host}:${port}`;
  return `${SCHEME}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adb = adbPath();
  const device = selectDevice(adb, options.device);
  const host = options.host || defaultHost();
  const mobileApiUrl = apiBaseUrl();
  const mobileSupabaseUrl = supabaseBaseUrl();
  if (process.env.CIRCLEBITES_LOCAL_DEVICE === "1") {
    if (!mobileApiUrl || !isLoopbackApiUrl(mobileApiUrl) || !mobileSupabaseUrl || !isLoopbackApiUrl(mobileSupabaseUrl)) {
      throw new Error("Dedicated Android local-device mode requires loopback API and Supabase URLs");
    }
  }
  const javaHome = javaHomePath();
  const buildEnv = {
    ...mobileProcessEnv(),
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, "bin")}:${process.env.PATH ?? ""}`
  };

  console.log(`Using Android device: ${device}`);
  console.log(`Using Metro URL: http://${host}:${options.port}`);
  if (!options.host && isLocalhostHost(host)) {
    console.log("Using adb reverse for Metro. Pass --host <LAN IP> to use Wi-Fi/LAN instead.");
  }
  if (mobileApiUrl) {
    console.log(`Using API URL: ${mobileApiUrl.origin}`);
  } else {
    console.log("EXPO_PUBLIC_API_BASE_URL is not configured; API-backed mobile features may be unavailable.");
  }
  if (mobileSupabaseUrl) {
    console.log(`Using Supabase URL: ${mobileSupabaseUrl.origin}`);
  } else {
    console.log("EXPO_PUBLIC_SUPABASE_URL is not configured; Supabase-backed mobile features may be unavailable.");
  }
  console.log(`Using JAVA_HOME: ${javaHome}`);

  if (!existsSync(gradlew)) {
    throw new Error(`Gradle wrapper not found at ${gradlew}`);
  }

  run(gradlew, [":app:assembleDebug"], { cwd: androidRoot, env: buildEnv });

  if (!existsSync(debugApk)) {
    throw new Error(`Debug APK was not created at ${debugApk}`);
  }

  run(adb, ["-s", device, "install", "-r", "-d", debugApk]);
  if (options.clearData) {
    run(adb, ["-s", device, "shell", "pm", "clear", APP_ID]);
  }

  if (options.launch) {
    await ensureMetro(host, options.port, options.startMetro, options.restartMetro);
    if (isLocalhostHost(host)) {
      run(adb, ["-s", device, "reverse", `tcp:${options.port}`, `tcp:${options.port}`]);
    }
    if (mobileApiUrl && isLoopbackApiUrl(mobileApiUrl)) {
      await ensureApiServer(mobileApiUrl, options.startApi);
      run(adb, ["-s", device, "reverse", `tcp:${apiPort(mobileApiUrl)}`, `tcp:${apiPort(mobileApiUrl)}`]);
    } else if (mobileApiUrl) {
      console.log(`API URL is not loopback, so it was not auto-started or adb-reversed: ${mobileApiUrl.origin}`);
    }
    if (mobileSupabaseUrl && isLoopbackApiUrl(mobileSupabaseUrl)) {
      run(adb, ["-s", device, "reverse", `tcp:${apiPort(mobileSupabaseUrl)}`, `tcp:${apiPort(mobileSupabaseUrl)}`]);
      console.log(`adb reverse configured for local Supabase port ${apiPort(mobileSupabaseUrl)}.`);
    } else if (process.env.CIRCLEBITES_LOCAL_DEVICE === "1") {
      throw new Error("Dedicated Android local-device mode could not reverse the local Supabase URL");
    }
    run(adb, ["-s", device, "shell", "am", "force-stop", APP_ID]);
    run(adb, [
      "-s",
      device,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      devClientUrl(host, options.port),
      APP_ID
    ]);
  }

  console.log("Android phone reinstall complete.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
