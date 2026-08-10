#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_ROOT = path.join(ROOT, "mobile");
const ANDROID_REINSTALL = path.join(MOBILE_ROOT, "scripts/reinstall-android-phone.mjs");
const EXPO = path.join(MOBILE_ROOT, "node_modules/.bin/expo");
const DEFAULT_API_PORT = 3035;
const DEFAULT_METRO_PORT = 8081;
const LOCAL_SUPABASE_PORT = 54321;

function printHelp() {
  console.log(`Dedicated local-device environment for Witoh.

The normal hosted .env/.env.local files are never edited.

Android over USB/adb reverse:
  npm run mobile:reinstall:phone:local -- --device ZA223JVWG7

iPhone over the same Wi-Fi/LAN:
  npm run mobile:ios:device:local -- --host 192.168.1.25
  npm run mobile:ios:device:local -- --host 192.168.1.25 --device "My iPhone"

Options:
  --host <private-ip>   Required for iPhone; use the Mac's Wi-Fi IPv4 address.
  --device <id/name>   Android serial or iPhone device name/UDID.
  --api-port <port>    Dedicated local Next API port. Defaults to ${DEFAULT_API_PORT}.
  --metro-port <port>  Expo Metro port. Defaults to ${DEFAULT_METRO_PORT}.
  --clear-data         Android only; clear app data after installation.
  --no-launch          Android only; install without opening the app.
`);
}

function parseModeAndOptions(argv) {
  const args = [...argv];
  const mode = args.shift();
  if (!mode || mode === "--help" || mode === "-h") {
    printHelp();
    process.exit(0);
  }
  if (!new Set(["android-usb", "ios-lan"]).has(mode)) throw new Error(`Unknown local-device mode: ${mode}`);
  const options = { apiPort: DEFAULT_API_PORT, clearData: false, device: "", host: "", launch: true, metroPort: DEFAULT_METRO_PORT };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--host" && next) {
      options.host = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length).trim();
      continue;
    }
    if (arg === "--device" && next) {
      options.device = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--device=")) {
      options.device = arg.slice("--device=".length).trim();
      continue;
    }
    if (arg === "--api-port" && next) {
      options.apiPort = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--api-port=")) {
      options.apiPort = Number(arg.slice("--api-port=".length));
      continue;
    }
    if (arg === "--metro-port" && next) {
      options.metroPort = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--metro-port=")) {
      options.metroPort = Number(arg.slice("--metro-port=".length));
      continue;
    }
    if (arg === "--clear-data") {
      options.clearData = true;
      continue;
    }
    if (arg === "--no-launch") {
      options.launch = false;
      continue;
    }
    throw new Error(`Unknown local-device argument: ${arg}`);
  }
  for (const [name, value] of [["api-port", options.apiPort], ["metro-port", options.metroPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`Invalid --${name}: ${value}`);
  }
  return { mode, options };
}

function isLoopbackUrl(value) {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isPrivateIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

function localSupabaseStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error("Local Supabase is not running. Start it with: npm run db:start");
  const status = JSON.parse(result.stdout);
  if (!isLoopbackUrl(status.API_URL) || !isLoopbackUrl(status.DB_URL)) {
    throw new Error("Refusing local-device launch: Supabase status is not entirely loopback/non-production");
  }
  const apiUrl = new URL(status.API_URL);
  if (Number(apiUrl.port) !== LOCAL_SUPABASE_PORT) {
    throw new Error(`Expected local Supabase API port ${LOCAL_SUPABASE_PORT}, received a different local port`);
  }
  return status;
}

function localDeviceEnv(status, advertisedHost, apiPort) {
  const supabaseUrl = `http://${advertisedHost}:${LOCAL_SUPABASE_PORT}`;
  const apiUrl = `http://${advertisedHost}:${apiPort}`;
  return {
    ...process.env,
    WITOH_LOCAL_DEVICE: "1",
    EXPO_PUBLIC_API_BASE_URL: apiUrl,
    EXPO_PUBLIC_APP_ENVIRONMENT: "local",
    EXPO_PUBLIC_RELEASE_CHANNEL: "local-device",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl
  };
}

function localApiEnv(clientEnv, status) {
  return {
    ...clientEnv,
    API_RATE_LIMIT_HMAC_SECRET: randomBytes(32).toString("hex"),
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with status ${result.status ?? "unknown"}`);
}

function listeningPids(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
}

function startDetached(label, command, args, cwd, env, port) {
  const occupied = listeningPids(port);
  if (occupied.length > 0) {
    throw new Error(`${label} port ${port} is already in use by pid ${occupied.join(", ")}. Stop it before starting the dedicated local-device environment.`);
  }
  const logPath = path.join(tmpdir(), `witoh-local-device-${label.toLowerCase()}-${port}.log`);
  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn(command, args, { cwd, detached: true, env, stdio: ["ignore", out, err] });
  child.unref();
  closeSync(out);
  closeSync(err);
  console.log(`${label} started on port ${port}. Log: ${logPath}`);
}

async function waitFor(label, url, accept, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      const body = await response.text();
      if (accept(response, body)) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function runAndroidUsb(status, options) {
  if (options.host) throw new Error("Android USB mode uses adb reverse; omit --host. Use the LAN workflow only when intentionally testing over Wi-Fi.");
  const env = localApiEnv(localDeviceEnv(status, "127.0.0.1", options.apiPort), status);
  const args = [ANDROID_REINSTALL, "--port", String(options.metroPort)];
  if (options.device) args.push("--device", options.device);
  if (options.clearData) args.push("--clear-data");
  if (!options.launch) args.push("--no-launch");
  console.log(`Dedicated Android local-device environment: API 127.0.0.1:${options.apiPort}, Supabase 127.0.0.1:${LOCAL_SUPABASE_PORT}, Metro 127.0.0.1:${options.metroPort}`);
  console.log("The installer will adb-reverse all three ports. Hosted environment files are not changed.");
  run(process.execPath, args, { cwd: ROOT, env });
}

async function runIosLan(status, options) {
  if (!isPrivateIpv4(options.host)) {
    throw new Error("iPhone LAN mode requires --host with this Mac's private Wi-Fi IPv4 address (10.x, 172.16-31.x, or 192.168.x).");
  }
  if (!existsSync(EXPO)) throw new Error("Expo CLI is not installed under mobile/node_modules. Run npm install first.");
  const clientEnv = {
    ...localDeviceEnv(status, options.host, options.apiPort),
    EXPO_DEV_HOST: options.host,
    REACT_NATIVE_PACKAGER_HOSTNAME: options.host
  };
  const apiEnv = localApiEnv(clientEnv, status);
  await waitFor("Supabase LAN", `http://${options.host}:${LOCAL_SUPABASE_PORT}/auth/v1/health`, (response) => response.status < 500, 10_000);
  startDetached("API", "npm", ["run", "dev", "--", "-H", "0.0.0.0", "-p", String(options.apiPort)], ROOT, apiEnv, options.apiPort);
  await waitFor("Local API", `http://127.0.0.1:${options.apiPort}/api/health`, (response) => response.status < 500);
  startDetached("Metro", EXPO, ["start", "--dev-client", "--host", "lan", "--port", String(options.metroPort), "--clear"], MOBILE_ROOT, clientEnv, options.metroPort);
  await waitFor("Metro", `http://127.0.0.1:${options.metroPort}/status`, (_response, body) => body.includes("packager-status:running"));

  console.log(`Dedicated iPhone local-device environment: API http://${options.host}:${options.apiPort}, Supabase http://${options.host}:${LOCAL_SUPABASE_PORT}, Metro http://${options.host}:${options.metroPort}`);
  console.log("Keep the Mac and iPhone on the same Wi-Fi and allow the Local Network prompt on the iPhone.");
  const args = ["run:ios", "--no-bundler", "--port", String(options.metroPort)];
  if (options.device) args.push("--device", options.device);
  else args.push("--device");
  run(EXPO, args, { cwd: MOBILE_ROOT, env: clientEnv });
}

const { mode, options } = parseModeAndOptions(process.argv.slice(2));
const status = localSupabaseStatus();
if (mode === "android-usb") await runAndroidUsb(status, options);
else await runIosLan(status, options);
