#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ID = "com.circlebites.mobile";
const SCHEME = "circlebites";
const DEFAULT_PORT = 8081;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, "..");
const androidRoot = join(mobileRoot, "android");
const gradlew = join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const debugApk = join(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

function parseArgs(argv) {
  const options = {
    device: "",
    host: "",
    launch: true,
    port: DEFAULT_PORT
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
  --host <ip>        Metro host IP. Defaults to EXPO_DEV_HOST or local LAN IP.
  --port <port>      Metro port. Defaults to ${DEFAULT_PORT}.
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

function lanHost() {
  if (process.env.EXPO_DEV_HOST) return process.env.EXPO_DEV_HOST;

  const interfaces = networkInterfaces();
  const preferredNames = Object.keys(interfaces).filter((name) => /^en\d+$/i.test(name));
  const remainingNames = Object.keys(interfaces).filter((name) => !preferredNames.includes(name));

  for (const name of [...preferredNames, ...remainingNames]) {
    if (/^(awdl|bridge|llw|lo|utun|vbox|vmnet)/i.test(name)) continue;
    const entries = interfaces[name];
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        return entry.address;
      }
    }
  }

  return "127.0.0.1";
}

function devClientUrl(host, port) {
  const metroUrl = `http://${host}:${port}`;
  return `${SCHEME}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const adb = adbPath();
  const device = selectDevice(adb, options.device);
  const host = options.host || lanHost();
  const javaHome = javaHomePath();
  const buildEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, "bin")}:${process.env.PATH ?? ""}`
  };

  console.log(`Using Android device: ${device}`);
  console.log(`Using Metro URL: http://${host}:${options.port}`);
  console.log(`Using JAVA_HOME: ${javaHome}`);

  if (!existsSync(gradlew)) {
    throw new Error(`Gradle wrapper not found at ${gradlew}`);
  }

  run(gradlew, [":app:assembleDebug"], { cwd: androidRoot, env: buildEnv });

  if (!existsSync(debugApk)) {
    throw new Error(`Debug APK was not created at ${debugApk}`);
  }

  run(adb, ["-s", device, "install", "-r", "-d", debugApk]);

  if (options.launch) {
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
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
