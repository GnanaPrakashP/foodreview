import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MEDIA_WORKER_SECRET"];
for (const name of required) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || (name !== "NEXT_PUBLIC_SUPABASE_URL" && process.env.NODE_ENV === "production" && value.length < 32)) {
    console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: `${name.toLowerCase()}_invalid` }));
    process.exit(1);
  }
}
try {
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
} catch {
  console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: "supabase_url_invalid" }));
  process.exit(1);
}

const tempRoot = process.env.MEDIA_WORKER_TEMP_DIR || "/tmp/circlebites-media-worker";
await mkdir(tempRoot, { mode: 0o700, recursive: true });

const next = spawn(process.execPath, [
  "node_modules/next/dist/bin/next",
  "start",
  "-H",
  "127.0.0.1",
  "-p",
  process.env.PORT || "3000"
], {
  env: { ...process.env, HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
  stdio: "inherit"
});

let worker = null;
let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  worker?.kill(signal);
  next.kill(signal);
  setTimeout(() => {
    worker?.kill("SIGKILL");
    next.kill("SIGKILL");
  }, 30_000).unref();
}

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
next.on("exit", (code) => {
  if (!stopping) {
    console.error(JSON.stringify({ component: "media-worker", event: "server_exited", exitCode: code ?? -1 }));
    worker?.kill("SIGTERM");
    process.exitCode = code || 1;
  }
});

const healthUrl = `http://127.0.0.1:${process.env.PORT || "3000"}/api/internal/media/health`;
for (let attempt = 0; attempt < 60 && !stopping; attempt += 1) {
  try {
    const response = await fetch(healthUrl, {
      headers: { Authorization: `Bearer ${process.env.MEDIA_WORKER_SECRET}` }
    });
    if (response.ok) break;
  } catch {
    // The private local server is still starting.
  }
  if (attempt === 59) {
    console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: "health_check_failed" }));
    stop("SIGTERM");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!stopping) {
  worker = spawn(process.execPath, ["scripts/media-worker.mjs"], {
    env: {
      ...process.env,
      MEDIA_WORKER_BASE_URL: `http://127.0.0.1:${process.env.PORT || "3000"}`,
      NODE_ENV: "production"
    },
    stdio: "inherit"
  });
  worker.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      next.kill("SIGTERM");
    }
  });
}

await new Promise((resolve) => {
  next.on("exit", resolve);
  worker?.on("exit", resolve);
});
